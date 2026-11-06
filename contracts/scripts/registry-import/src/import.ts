// Runs the LedgerHQ ERC-7730 registry through our compiler and reports exactly what came through.
// Usage: tsx src/import.ts <path to clear-signing-erc7730-registry>. Writes contracts/docs/REGISTRY.md and contracts/docs/registry-failures.json.
// This answers "who writes descriptors?" for display. ERC-7730 has no effects, so an imported descriptor renders a sentence
// and gets the default assertions (no tracked asset decreases, no allowance grows). Declared effects are a separate step.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, type FieldSpec, type FunctionSpec } from "@verbatim/vdesc-compiler";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const REG = process.argv[2];
if (!REG) throw new Error("usage: import.ts <registry path>");

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (f === "tests" || f === "testsv2" ? [] : walk(join(d, f))) : [join(d, f)]));

function deepMerge(base: any, over: any): any {
  if (Array.isArray(base) || Array.isArray(over) || typeof base !== "object" || typeof over !== "object" || !base || !over) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

function load(path: string): any {
  const j = JSON.parse(readFileSync(path, "utf8"));
  if (!j.includes) return j;
  const inc = resolve(dirname(path), j.includes);
  if (!existsSync(inc)) throw new Error("missing include");
  const { includes, ...rest } = j;
  void includes;
  return deepMerge(load(inc), rest);
}

// ---- ABI signature to word layout
interface Param {
  name: string;
  type: string;
  components?: Param[];
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function parseParam(s: string): Param {
  const t = s.trim();
  if (t.startsWith("(")) {
    let depth = 0;
    let end = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "(") depth++;
      if (t[i] === ")" && --depth === 0) {
        end = i;
        break;
      }
    }
    const rest = t.slice(end + 1).trim().split(/\s+/);
    const array = rest[0]?.startsWith("[") ? rest.shift()! : "";
    return { name: rest[0] ?? "", type: `tuple${array}`, components: splitTop(t.slice(1, end)).map(parseParam) };
  }
  const [type, name] = t.split(/\s+/);
  return { type, name: name ?? "" };
}

const isDynamic = (p: Param): boolean => p.type === "bytes" || p.type === "string" || p.type.endsWith("[]") || (p.type === "tuple" && p.components!.some(isDynamic));
const headWords = (p: Param): number => (isDynamic(p) ? 1 : p.type === "tuple" ? p.components!.reduce((a, c) => a + headWords(c), 0) : /\[\d+\]$/.test(p.type) ? -1 : 1);

class Unsupported extends Error {}

/** `params.tokenIn` to our path syntax, plus the leaf. */
function resolvePath(path: string, params: Param[]): { path: string; leaf: Param } {
  const parts = path.replace(/^#\./, "").split(".");
  let scope = params;
  let prefix = "";
  let base = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (/\[/.test(part)) throw new Unsupported("array element path");
    let idx = base;
    let found: Param | undefined;
    for (const p of scope) {
      if (p.name === part) {
        found = p;
        break;
      }
      const w = headWords(p);
      if (w < 0) throw new Unsupported("fixed array before field");
      idx += w;
    }
    if (!found) throw new Unsupported("path not in the signature");
    if (i === parts.length - 1) return { path: `${prefix}${idx}`, leaf: found };
    if (found.type !== "tuple") throw new Unsupported("path through a non-tuple");
    if (isDynamic(found)) {
      prefix += `${idx}>`;
      base = 0;
    } else {
      base = idx;
    }
    scope = found.components!;
  }
  throw new Unsupported("empty path");
}

function constAddress(j: any, ref: string): `0x${string}` | null {
  const m = String(ref).match(/^\$\.metadata\.constants\.(.+)$/);
  const v = m ? j.metadata?.constants?.[m[1]] : ref;
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as `0x${string}`) : null;
}

const cleanLabel = (s: string) => {
  const t = String(s).replace(/[^\x20-\x5b\x5d-\x7e]/g, "").slice(0, 48);
  if (!t) throw new Unsupported("empty label");
  return t;
};

function flatten(fields: any[], j: any, prefix = ""): any[] {
  return fields.flatMap((f: any) => {
    if (f.$ref) {
      const name = String(f.$ref).split(".").pop()!;
      const def = j.display?.definitions?.[name];
      if (!def) throw new Unsupported("unresolved $ref");
      return flatten([{ ...def, ...f, $ref: undefined }], j, prefix);
    }
    if (f.fields) return flatten(f.fields, j, f.path ? `${prefix}${f.path}.` : prefix);
    return [{ ...f, path: f.path ? (f.path.startsWith("@.") || f.path.startsWith("$.") ? f.path : `${prefix}${f.path}`) : f.path }];
  });
}

function toSpec(sig: string, fmt: any, j: any): FunctionSpec {
  const open = sig.indexOf("(");
  const params = splitTop(sig.slice(open + 1, sig.lastIndexOf(")"))).map(parseParam);
  const typeSig = `${sig.slice(0, open)}(${params.map(canon).join(",")})`;
  const fields: FieldSpec[] = [];
  const statics = params.every((p) => !isDynamic(p));
  for (const f of flatten(fmt.fields ?? [], j)) {
    // A hidden or conditional field is shown anyway: we never display less than ERC-7730 asks for.
    if (!f.path) throw new Unsupported(f.value !== undefined ? "static note or constant, no calldata field to bind" : "field without a path");
    if (f.path === "@.value") {
      fields.push({ label: cleanLabel(f.label ?? "Value"), format: "ethValue" });
      continue;
    }
    // Every call node already carries its target, and the header its account, so these lose nothing.
    if (f.path === "@.to" || f.path === "@.from") continue;
    if (String(f.path).startsWith("@.") || String(f.path).startsWith("$.")) throw new Unsupported(`container path ${String(f.path).split(".")[1]}`);
    if (/\[|\.\[/.test(f.path)) throw new Unsupported("array field");
    const { path, leaf } = resolvePath(f.path, params);
    if (leaf.type.endsWith("]")) throw new Unsupported("array field");
    const label = cleanLabel(f.label ?? leaf.name ?? "Field");
    switch (f.format) {
      case "tokenAmount": {
        const tp = f.params?.tokenPath;
        const tok = f.params?.token;
        if (tp) {
          if (String(tp).startsWith("@.to")) fields.push({ path, label, format: "tokenAmount", token: { kind: "target" } });
          else if (String(tp).startsWith("$.") || /^0x/.test(tp)) {
            const a = constAddress(j, tp);
            if (!a) throw new Unsupported("token constant not an address");
            fields.push({ path, label, format: "tokenAmount", token: { kind: "const", address: a } });
          } else fields.push({ path, label, format: "tokenAmount", token: { kind: "field", path: resolvePath(tp, params).path } });
        } else if (tok) {
          const a = constAddress(j, tok);
          if (!a) throw new Unsupported("token constant not an address");
          fields.push({ path, label, format: "tokenAmount", token: { kind: "const", address: a } });
        } else fields.push({ path, label, format: "tokenAmount", token: { kind: "target" } });
        break;
      }
      case "amount":
        fields.push({ path, label, format: "uint" });
        break;
      case "addressName":
      case "address":
        fields.push({ path, label, format: "address", role: /recipient|receiver|to$/i.test(leaf.name) ? "recipient" : "other" });
        break;
      case "date":
        fields.push({ path, label, format: "uint", unit: f.params?.encoding === "timestamp" ? "timestamp" : "none" });
        break;
      case "calldata":
        throw new Unsupported("nested calldata with an unmapped callee");
      case "enum":
        throw new Unsupported("enum table by reference");
      case "raw":
      case "duration":
      case "unit":
      case "nftName":
      case undefined:
      default:
        if (leaf.type === "bool") fields.push({ path, label, format: "bool" });
        else if (leaf.type === "address") fields.push({ path, label, format: "address" });
        else if (leaf.type === "bytes" || leaf.type === "string") fields.push({ path, label, format: "bytes" });
        else if (/^(u?int|bytes)\d*$/.test(leaf.type)) fields.push({ path, label, format: "uint" });
        else throw new Unsupported(`format ${f.format} on ${leaf.type}`);
    }
  }
  const words = params.reduce((a, p) => a + (headWords(p) < 0 ? NaN : headWords(p)), 0);
  return { signature: typeSig, intent: cleanLabel(typeof fmt.intent === "string" ? fmt.intent : (fmt.$id ?? sig.slice(0, open))), exactWords: statics && Number.isFinite(words) ? words : undefined, fields };
}

function canon(p: Param): string {
  if (p.type.startsWith("tuple")) return `(${p.components!.map(canon).join(",")})${p.type.slice(5)}`;
  return p.type === "uint" ? "uint256" : p.type === "int" ? "int256" : p.type;
}

const files = walk(join(REG, "registry")).filter((f) => /calldata-[^/]*\.json$/.test(f));
let ok = 0;
let filesOk = 0;
const failures: { file: string; fn: string; reason: string }[] = [];
const reasons = new Map<string, number>();
const fail = (file: string, fn: string, reason: string) => {
  failures.push({ file, fn, reason });
  reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
};
const protocols = new Set<string>();
for (const path of files) {
  const rel = path.slice(REG.length + 1);
  let j: any;
  try {
    j = load(path);
  } catch (e) {
    fail(rel, "(file)", `unreadable: ${(e as Error).message.slice(0, 40)}`);
    continue;
  }
  let any = false;
  for (const [sig, fmt] of Object.entries<any>(j.display?.formats ?? {})) {
    try {
      if (!sig.includes("(")) throw new Unsupported("selector-only key, no signature");
      compile(toSpec(sig, fmt, j));
      ok++;
      any = true;
    } catch (e) {
      const m = e instanceof Unsupported ? e.message : /bad descriptor string/.test((e as Error).message) ? "string outside the charset" : /path index too large|bad path/.test((e as Error).message) ? "path too deep or too large" : `other: ${(e as Error).message.slice(0, 50)}`;
      fail(rel, sig.slice(0, 60), m);
    }
  }
  if (any) {
    filesOk++;
    protocols.add(rel.split("/")[1]);
  }
}
const total = ok + failures.length;
const lines = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `| ${r} | ${n} |`);
writeFileSync(resolve(ROOT, "contracts/docs/registry-failures.json"), JSON.stringify(failures, null, 1) + "\n");
writeFileSync(resolve(ROOT, "contracts/docs/REGISTRY.md"), `# ERC-7730 registry import

Who writes descriptors? Mostly, others already have. \`contracts/scripts/registry-import\` runs [LedgerHQ/clear-signing-erc7730-registry](https://github.com/LedgerHQ/clear-signing-erc7730-registry) through our compiler.

**${ok} of ${total} function descriptors compile (${((ok / total) * 100).toFixed(1)}%), from ${filesOk} of ${files.length} files, covering ${protocols.size} protocols.** Every failure is listed in \`registry-failures.json\`.

What "compile" means: the JSON becomes valid VDesc bytes, the same format the chain renders. It does not mean each was attested or tested against its contract. Attestors still decide what to trust.

ERC-7730 says nothing about effects, so an imported descriptor gives a readable sentence plus the default assertions: no tracked asset decreases, no allowance grows. Those defaults fail closed for a call that spends a tracked token, until someone adds an \`x-verbatim\` effects section. That hand-written step is what \`contracts/descriptors/\` holds for ERC-20, WETH, Permit2, an ERC-4626 vault and an Aave-style pool.

## Why the rest failed

| Reason | Functions |
|---|---:|
${lines.join("\n")}

Most are real format gaps rather than bugs: VDesc v1 does not iterate arrays, which is deliberate, because an unbounded loop in validation is a gas and invalidation risk.
`);
console.log(`${ok}/${total} functions, ${filesOk}/${files.length} files, ${protocols.size} protocols`);
console.log(lines.slice(0, 8).join("\n"));
