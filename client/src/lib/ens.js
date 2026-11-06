// Live ENSv2 reads on Sepolia. Every address comes from the deployment's anchor and checker contracts, which pin them as immutables.
import { BaseError, ContractFunctionRevertedError, decodeFunctionResult, encodeFunctionData, hexToBigInt, keccak256, namehash, parseAbi, toHex, zeroAddress } from "viem";
import { packStr } from "@verbatim/displayvm-ts";
import { sepoliaPublic } from "./networks";

export const REG = parseAbi([
  "struct State { uint8 status; uint64 expiry; address latestOwner; uint256 tokenId; uint256 resource; }",
  "function getResolver(string) view returns (address)",
  "function getSubregistry(string) view returns (address)",
  "function getState(uint256) view returns (State)",
  "function roleCount(uint256) view returns (uint256)",
]);
export const RES = parseAbi(["function roleCount(uint256) view returns (uint256)", "function hasRoles(uint256,uint256,address) view returns (bool)", "function resolve(bytes,bytes) view returns (bytes)"]);
const RECORDS = parseAbi(["function text(bytes32,string) view returns (string)", "function addr(bytes32) view returns (address)"]);
const UR = parseAbi(["function reverse(bytes lookupAddress, uint256 coinType) view returns (string name, address resolver, address reverseResolver)"]);
export const CHECKER = parseAbi([
  "function ROOT_REGISTRY() view returns (address)",
  "function ETH_REGISTRY() view returns (address)",
  "function UNIVERSAL_RESOLVER() view returns (address)",
  "function RESOLVER_CODEHASH() view returns (bytes32)",
  "function COUNCIL() view returns (address)",
  "function HORIZON() view returns (uint256)",
  "function check(bytes32 packedName, bytes32 descHash) view",
  "function checkName(address a, bytes32 packedName, address resolver) view",
  "error BadName()",
  "error WrongEthRegistry(address found)",
  "error NoResolver()",
  "error WrongResolverCode(bytes32 found)",
  "error RecordMissing(bytes32 descHash)",
  "error RootRolesHeld(uint256 roleCount)",
  "error SetterNotExclusive(uint256 roleCount)",
  "error RegistryRolesHeld(uint256 roleCount)",
  "error ExpiresTooSoon(uint64 expiry)",
  "error ForwardMismatch(address found)",
  "error ReverseMismatch(string found)",
]);
export const ANCHOR = parseAbi([
  "function ROOT_REGISTRY() view returns (address)",
  "function ETH_REGISTRY() view returns (address)",
  "function RESOLVER_CODEHASH() view returns (bytes32)",
  "function GOVERNANCE() view returns (address)",
  "function CHECKER() view returns (address)",
]);
const ACCOUNT = parseAbi(["function attestorThreshold() view returns (uint8)", "function threshold() view returns (uint8)"]);

// ENSv2 roles (docs.ens.domains/ensv2): each role's holders are counted in one nybble; its admin is `role << 128`.
export const ROLE = { SET_TEXT: 1n << 4n, LINK: 1n << 28n, UPGRADE: 1n << 124n, SET_SUBREGISTRY: 1n << 20n, SET_RESOLVER: 1n << 24n };
export const holders = (bitmap, role) => (bitmap >> BigInt(role.toString(2).length - 1)) & 0xfn;
export const admin = (role) => role << 128n;

export function dns(name) {
  const b = [];
  for (const p of name.split(".")) {
    const e = new TextEncoder().encode(p);
    b.push(e.length, ...e);
  }
  b.push(0);
  return toHex(new Uint8Array(b));
}

const c = () => sepoliaPublic();
const read = (address, abi, functionName, args = []) => c().readContract({ address, abi, functionName, args });

/** The contract's own revert, decoded, or null if the call succeeded. */
export async function simulateCheck(address, functionName, args) {
  try {
    await read(address, CHECKER, functionName, args);
    return null;
  } catch (e) {
    const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    if (r?.data?.errorName) return { name: r.data.errorName, args: (r.data.args ?? []).map(String) };
    return { name: "CallFailed", args: [e.shortMessage ?? e.message] };
  }
}

export async function config(dep) {
  const anchor = dep.ensTrustAnchor;
  const checker = dep.ensTrustChecker;
  const [rootRegistry, ethRegistry, anchorCodehash, governance, universalResolver, publisherCodehash, council, horizon] = await Promise.all([
    read(anchor, ANCHOR, "ROOT_REGISTRY"),
    read(anchor, ANCHOR, "ETH_REGISTRY"),
    read(anchor, ANCHOR, "RESOLVER_CODEHASH"),
    read(anchor, ANCHOR, "GOVERNANCE"),
    read(checker, CHECKER, "UNIVERSAL_RESOLVER"),
    read(checker, CHECKER, "RESOLVER_CODEHASH"),
    read(checker, CHECKER, "COUNCIL"),
    read(checker, CHECKER, "HORIZON"),
  ]);
  return { anchor, checker, rootRegistry, ethRegistry, anchorCodehash, governance, universalResolver, publisherCodehash, council, horizon };
}

export async function textRecord(resolver, name, key) {
  try {
    const data = encodeFunctionData({ abi: RECORDS, functionName: "text", args: [namehash(name), key] });
    const raw = await read(resolver, RES, "resolve", [dns(name), data]);
    return decodeFunctionResult({ abi: RECORDS, functionName: "text", data: raw });
  } catch {
    return "";
  }
}

export async function codehashOf(a) {
  const code = await c().getCode({ address: a });
  return { hasCode: !!code && code !== "0x", codehash: code && code !== "0x" ? keccak256(code) : null };
}

export const labelOf = (name) => {
  const m = name.trim().toLowerCase().match(/^([a-z0-9-]+)\.eth$/);
  if (!m) throw new Error("These checks cover second-level .eth names only.");
  return m[1];
};

/** The record that decides who may attest, and who may write it. */
export async function attestors(cfg, dep) {
  const name = dep.ens.anchor;
  const label = labelOf(name);
  const resolver = await read(cfg.ethRegistry, REG, "getResolver", [label]);
  const [record, keyCount, govHolds, gov, threshold] = await Promise.all([
    textRecord(resolver, name, "attestors"),
    read(resolver, RES, "roleCount", [hexToBigInt(keccak256(toHex("attestors")))]),
    read(resolver, RES, "hasRoles", [hexToBigInt(keccak256(toHex("attestors"))), ROLE.SET_TEXT, cfg.governance]),
    codehashOf(cfg.governance),
    read(dep.account, ACCOUNT, "attestorThreshold").catch(() => null),
  ]);
  return {
    name,
    resolver,
    list: record ? record.split(",").filter(Boolean) : [],
    threshold,
    setters: holders(keyCount, ROLE.SET_TEXT),
    adminSetters: keyCount >> 128n,
    governance: cfg.governance,
    governanceHolds: govHolds,
    governanceIsContract: gov.hasCode,
  };
}

/** The exclusivity proof for a descriptor publisher, step by step, then the checker's own verdict. */
export async function publisherProof(cfg, name) {
  const label = labelOf(name);
  const steps = [];
  const resolver = await read(cfg.ethRegistry, REG, "getResolver", [label]);
  if (resolver === zeroAddress) return { name, steps: [{ ok: false, label: "Has a resolver in the ENSv2 .eth registry", detail: "No resolver: not a publisher." }], verdict: { name: "NoResolver", args: [] } };
  const { codehash } = await codehashOf(resolver);
  steps.push({ ok: codehash === cfg.publisherCodehash, label: "The resolver is the pinned PermissionedResolver code", detail: `${resolver}\ncode hash ${codehash}\npinned    ${cfg.publisherCodehash}` });

  const root = await read(resolver, RES, "roleCount", [0n]);
  const roots = [ROLE.SET_TEXT, ROLE.LINK, ROLE.UPGRADE].flatMap((r) => [holders(root, r), holders(root, admin(r))]);
  steps.push({ ok: roots.every((x) => x === 0n), label: "Nobody holds the resolver's root roles", detail: `roleCount(0): SET_TEXT ${roots[0]} (admin ${roots[1]}), LINK ${roots[2]} (admin ${roots[3]}), UPGRADE ${roots[4]} (admin ${roots[5]})` });

  const key = hexToBigInt(keccak256(toHex("clear-signing")));
  const [keyCount, councilHolds] = await Promise.all([read(resolver, RES, "roleCount", [key]), read(resolver, RES, "hasRoles", [key, ROLE.SET_TEXT, cfg.council])]);
  steps.push({ ok: holders(keyCount, ROLE.SET_TEXT) === 1n && keyCount >> 128n === 0n && councilHolds, label: "Only the council can set the clear-signing record", detail: `${holders(keyCount, ROLE.SET_TEXT)} holder(s) of the argument-scoped setter, ${keyCount >> 128n} admin(s). Council ${cfg.council} holds it: ${councilHolds}` });

  const [ethRoot, rootRoot, st] = await Promise.all([read(cfg.ethRegistry, REG, "roleCount", [0n]), read(cfg.rootRegistry, REG, "roleCount", [0n]), read(cfg.ethRegistry, REG, "getState", [hexToBigInt(keccak256(toHex(label)))])]);
  const parent = ethRoot | rootRoot;
  steps.push({ ok: holders(parent, ROLE.SET_RESOLVER) === 0n && holders(parent, ROLE.SET_SUBREGISTRY) === 0n, label: "Parent registries hold no direct right to repoint names", detail: `.eth and root roleCount(0): SET_RESOLVER ${holders(parent, ROLE.SET_RESOLVER)}, SET_SUBREGISTRY ${holders(parent, ROLE.SET_SUBREGISTRY)}. Their admin roles stay with ENS.` });
  const nameCount = await read(cfg.ethRegistry, REG, "roleCount", [st.resource]);
  const n = [ROLE.SET_RESOLVER, ROLE.SET_SUBREGISTRY].flatMap((r) => [holders(nameCount, r), holders(nameCount, admin(r))]);
  steps.push({ ok: n.every((x) => x === 0n), label: "The name itself cannot be repointed", detail: `SET_RESOLVER ${n[0]} (admin ${n[1]}), SET_SUBREGISTRY ${n[2]} (admin ${n[3]})` });
  const left = Number(st.expiry) - Date.now() / 1000;
  steps.push({ ok: left > Number(cfg.horizon), label: `Registered beyond the ${Math.round(Number(cfg.horizon) / 86400)}-day horizon`, detail: `Expires ${new Date(Number(st.expiry) * 1000).toISOString().slice(0, 10)}; owner ${st.latestOwner}` });

  const record = await textRecord(resolver, name, "clear-signing");
  const hashes = record ? record.split(",").filter(Boolean) : [];
  steps.push({ ok: hashes.length ? null : false, label: "Descriptors this publisher stands behind", detail: hashes.length ? hashes.join("\n") : "No clear-signing record." });

  // The authority: the deployed checker's own view call, the one execution makes.
  const verdict = await simulateCheck(cfg.checker, "check", [packStr(name), hashes[0] ?? `0x${"00".repeat(32)}`]);
  return { name, resolver, steps, hashes, verdict };
}

/** Forward and reverse resolution, then the checker's checkName, which is what decides whether a sentence may show the name. */
export async function resolveName(cfg, input) {
  const s = input.trim();
  let name;
  let addr;
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) {
    addr = s;
    const [primary] = await read(cfg.universalResolver, UR, "reverse", [addr, 60n]).catch(() => [""]);
    name = primary || null;
  } else name = s.toLowerCase();
  let resolver = zeroAddress;
  let forward = null;
  if (name) {
    try {
      resolver = await read(cfg.ethRegistry, REG, "getResolver", [labelOf(name)]);
      if (resolver !== zeroAddress) {
        const raw = await read(resolver, RES, "resolve", [dns(name), encodeFunctionData({ abi: RECORDS, functionName: "addr", args: [namehash(name)] })]);
        forward = decodeFunctionResult({ abi: RECORDS, functionName: "addr", data: raw });
      }
    } catch {
      /* reported as unresolved */
    }
  }
  addr ??= forward;
  let reverse = null;
  if (addr) {
    const r = await read(cfg.universalResolver, UR, "reverse", [addr, 60n]).catch(() => null);
    reverse = r?.[0] || null;
  }
  const verdict = name && addr ? await simulateCheck(cfg.checker, "checkName", [addr, packStr(name), resolver]) : { name: "NoName", args: [] };
  return { input: s, name, addr, resolver, forward, reverse, verdict };
}

export async function revocations(cfg, dep) {
  const name = dep.ens.anchor;
  const resolver = await read(cfg.ethRegistry, REG, "getResolver", [labelOf(name)]);
  const record = await textRecord(resolver, name, "revoked");
  return { name, list: record ? record.split(",").filter(Boolean) : [] };
}
