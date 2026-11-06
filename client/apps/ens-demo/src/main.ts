// Live ENSv2 exclusivity proof for any name, read straight from Sepolia. Nothing here is hard-coded but the protocol's addresses.
import "@verbatim/app-kit/style.css";
import { createPublicClient, decodeFunctionResult, encodeFunctionData, hexToBigInt, http, keccak256, namehash, parseAbi, toHex, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import deployment from "../../../../contracts/deployments/sepolia.json";

const dep = deployment as any;
const client = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });
const REG = parseAbi(["struct State { uint8 status; uint64 expiry; address latestOwner; uint256 tokenId; uint256 resource; }", "function getResolver(string) view returns (address)", "function getSubregistry(string) view returns (address)", "function getState(uint256) view returns (State)", "function roleCount(uint256) view returns (uint256)"]);
const RES = parseAbi(["function roleCount(uint256) view returns (uint256)", "function hasRoles(uint256,uint256,address) view returns (bool)", "function resolve(bytes,bytes) view returns (bytes)"]);
const TEXT = parseAbi(["function text(bytes32,string) view returns (string)"]);
const CHECK = parseAbi(["function check(bytes32,bytes32) view", "function COUNCIL() view returns (address)", "function RESOLVER_CODEHASH() view returns (bytes32)"]);
const NYBBLE = 0xfn;
const count = (bitmap: bigint, role: bigint) => (bitmap >> BigInt(role.toString(2).length - 1)) & NYBBLE;
const SET_TEXT = 1n << 4n;
const LINK = 1n << 28n;
const UPGRADE = 1n << 124n;
const SET_RESOLVER = 1n << 24n;
const SET_SUBREGISTRY = 1n << 20n;

const el = <K extends keyof HTMLElementTagNameMap>(t: K, p: Record<string, unknown> = {}, ...k: (Node | string)[]) => {
  const e = document.createElement(t);
  for (const [a, v] of Object.entries(p)) a === "class" ? (e.className = v as string) : ((e as any)[a] = v);
  e.append(...k);
  return e;
};

const out = el("div");
const input = el("input", { value: dep.ens.name }) as HTMLInputElement;

const dns = (name: string): Hex => {
  const b: number[] = [];
  for (const p of name.split(".")) b.push(p.length, ...new TextEncoder().encode(p));
  b.push(0);
  return `0x${b.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};

function row(label: string, ok: boolean | null, detail: string) {
  return el("div", { class: "panel" }, el("div", { class: ok === null ? "line" : ok ? "ok" : "bad" }, `${ok === null ? "" : ok ? "Pass: " : "Fail: "}${label}`), el("div", { class: "mono" }, detail));
}

async function run() {
  const name = input.value.trim().toLowerCase();
  out.replaceChildren(el("div", { class: "line" }, "Reading Sepolia..."));
  try {
    const m = name.match(/^([a-z0-9-]+)\.eth$/);
    if (!m) throw new Error("This check covers second-level .eth names only.");
    const label = m[1];
    const rows: HTMLElement[] = [];
    const eth = dep.ens.ethRegistry as Address;
    const resolver = await client.readContract({ address: eth, abi: REG, functionName: "getResolver", args: [label] });
    if (resolver === "0x0000000000000000000000000000000000000000") throw new Error(`${name} has no resolver in the ENSv2 .eth registry, so it is not a publisher.`);
    const council = await client.readContract({ address: dep.ensTrustChecker, abi: CHECK, functionName: "COUNCIL" });
    const pinned = await client.readContract({ address: dep.ensTrustChecker, abi: CHECK, functionName: "RESOLVER_CODEHASH" });
    const code = keccak256((await client.getCode({ address: resolver })) as Hex);
    rows.push(row("Resolver is the pinned code", code === pinned, `${resolver}, code hash ${code}`));

    const root = await client.readContract({ address: resolver, abi: RES, functionName: "roleCount", args: [0n] });
    const adminOf = (r: bigint) => r << 128n;
    const rootHolders = [SET_TEXT, adminOf(SET_TEXT), LINK, adminOf(LINK), UPGRADE, adminOf(UPGRADE)].map((r) => count(root, r));
    rows.push(row("Nobody can write text records, relink the name or upgrade the resolver", rootHolders.every((c) => c === 0n), `Holders at the resolver's root: SET_TEXT ${rootHolders[0]}, LINK ${rootHolders[2]}, UPGRADE ${rootHolders[4]}, and their admins ${rootHolders[1]}, ${rootHolders[3]}, ${rootHolders[5]}`));

    const key = hexToBigInt(keccak256(toHex("clear-signing")));
    const keyCount = await client.readContract({ address: resolver, abi: RES, functionName: "roleCount", args: [key] });
    const councilHolds = await client.readContract({ address: resolver, abi: RES, functionName: "hasRoles", args: [key, SET_TEXT, council] });
    rows.push(row("Only the council can set the clear-signing record", count(keyCount, SET_TEXT) === 1n && keyCount >> 128n === 0n && councilHolds, `${count(keyCount, SET_TEXT)} holder(s) of the argument-scoped role; council ${council} holds it: ${councilHolds}`));

    const st = await client.readContract({ address: eth, abi: REG, functionName: "getState", args: [hexToBigInt(keccak256(toHex(label)))] });
    const nameCount = await client.readContract({ address: eth, abi: REG, functionName: "roleCount", args: [st.resource] });
    const nameHolders = [SET_RESOLVER, adminOf(SET_RESOLVER), SET_SUBREGISTRY, adminOf(SET_SUBREGISTRY)].map((r) => count(nameCount, r));
    rows.push(row("The name cannot be repointed", nameHolders.every((c) => c === 0n), `Holders on the name: SET_RESOLVER ${nameHolders[0]}, SET_SUBREGISTRY ${nameHolders[2]}, and admins ${nameHolders[1]}, ${nameHolders[3]}`));

    const horizon = Number(st.expiry) - Date.now() / 1000;
    rows.push(row("Registered past the one-year horizon", horizon > 365 * 86400, `Expires ${new Date(Number(st.expiry) * 1000).toISOString().slice(0, 10)}, owner ${st.latestOwner}`));

    let record = "";
    try {
      // This resolver serves records through resolve(name, data), as the ENSv2 docs describe.
      const data = encodeFunctionData({ abi: TEXT, functionName: "text", args: [namehash(name), "clear-signing"] });
      const raw = await client.readContract({ address: resolver, abi: RES, functionName: "resolve", args: [dns(name), data] });
      record = decodeFunctionResult({ abi: TEXT, functionName: "text", data: raw });
    } catch {
      /* no record: reported below */
    }
    const hashes = record ? record.split(",") : [];
    rows.push(row("Descriptors this publisher stands behind", hashes.length ? null : false, hashes.length ? hashes.join(" ") : "No clear-signing record."));

    const allPass = rows.every((r) => !r.querySelector(".bad"));
    out.replaceChildren(el("div", { class: allPass ? "ok" : "bad", style: "margin-bottom:14px" }, allPass ? `${name} is an exclusive publisher. Its name can appear in signed sentences.` : `${name} fails the exclusivity proof. the trust checks refuses it, and wallets show the raw address.`), ...rows);
  } catch (e) {
    out.replaceChildren(el("div", { class: "bad" }, (e as Error).message));
  }
}

document.getElementById("app")!.append(
  el("h1", {}, "Publisher exclusivity check"),
  el("div", { class: "sub" }, "Could anyone but its council change what this ENSv2 name attests? Read live from Sepolia, using the same rules Verbatim's paymaster enforces before a name can appear in a signed sentence."),
  el("div", { class: "panel" }, el("label", {}, "ENSv2 name"), input, el("div", { class: "row" }, el("button", { class: "primary", onclick: run }, "Check"), el("button", { onclick: () => { input.value = dep.ens.name; run(); } }, dep.ens.name), el("button", { onclick: () => { input.value = dep.ens.lookalike; run(); } }, dep.ens.lookalike))),
  out,
);
run();
