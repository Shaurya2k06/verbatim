import { createPublicClient, http, parseAbiItem, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { DYNAMIC_FEE, FLAGS, parseInput, poolId, xray } from "./xray";

// Where a pool ID can be looked up: the PoolManager's Initialize event holds its key.
const NETWORKS: Record<string, { rpc: string; manager: Address; from: bigint; chain?: typeof sepolia }> = {
  "Ethereum Sepolia": { rpc: "https://ethereum-sepolia-rpc.publicnode.com", manager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543", from: 7_000_000n, chain: sepolia },
  "EF frames devnet": { rpc: "https://altmempool.forshtat.com", manager: "0x6bF9Aa9c04fd001385742d61f6818C3236429848", from: 0n },
};
const INITIALIZE = parseAbiItem("event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)");

const app = document.getElementById("app")!;
app.innerHTML = `
  <h1>Hook X-ray</h1>
  <p>What a Uniswap v4 hook is allowed to do is written in the low bits of its address. Paste a PoolKey, a pool ID or a hook address.</p>
  <label for="input">PoolKey JSON, pool ID or hook address</label>
  <textarea id="input" spellcheck="false" placeholder='{"currency0":"0x...","currency1":"0x...","fee":3000,"tickSpacing":60,"hooks":"0x..."}'></textarea>
  <label for="net">Network, for pool ID lookups</label>
  <select id="net">${Object.keys(NETWORKS).map((n) => `<option>${n}</option>`).join("")}</select>
  <button id="go">X-ray</button>
  <div id="out"></div>
`;
const out = document.getElementById("out")!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function show(hook: Address, fee?: number, id?: Hex) {
  const x = xray(hook, fee);
  const zero = hook === "0x0000000000000000000000000000000000000000";
  out.innerHTML = `
    ${id ? `<div class="mono" style="margin-top:16px">Pool ID ${esc(id)}</div>` : ""}
    <div class="mono" style="margin-top:8px">Hook ${esc(hook)}</div>
    ${zero ? `<div class="ok">No hook on this pool.</div>` : x.risks.length ? x.risks.map((r) => `<div class="risk">! ${esc(r)}</div>`).join("") : `<div class="ok">This hook cannot take your input or output through a return delta.</div>`}
    ${zero ? "" : `<table>${FLAGS.map(([n, b]) => `<tr><td>${n}</td><td class="${x.on.includes(n) ? "on" : ""}">${x.on.includes(n) ? "on" : "off"} (bit ${b})</td></tr>`).join("")}</table>`}
    <p style="margin-top:16px">These flags say what the hook may do, not what it will. Verbatim also checks its code hash against attested hooks: an unattested one shows <b>UNVERIFIED HOOK</b>, and the default policy refuses that together with the flags above.</p>`;
}

document.getElementById("go")!.addEventListener("click", async () => {
  try {
    const parsed = parseInput((document.getElementById("input") as HTMLTextAreaElement).value);
    if (parsed.hook) return show(parsed.hook);
    if (parsed.key) return show(parsed.key.hooks, parsed.key.fee, poolId(parsed.key));
    const net = NETWORKS[(document.getElementById("net") as HTMLSelectElement).value];
    out.innerHTML = `<p style="margin-top:16px">Looking the pool up...</p>`;
    const client = createPublicClient({ chain: net.chain, transport: http(net.rpc) });
    const logs = await client.getLogs({ address: net.manager, event: INITIALIZE, args: { id: parsed.id }, fromBlock: net.from, toBlock: "latest" });
    if (!logs.length) throw new Error("No pool with that ID on this network.");
    show(logs[0].args.hooks as Address, logs[0].args.fee, parsed.id);
  } catch (e) {
    out.innerHTML = `<div class="risk">${esc((e as Error).message)}</div>`;
  }
});
void DYNAMIC_FEE;
