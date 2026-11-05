import { rpc, DEVNET } from "@verbatim/frames-sdk";
const h = process.argv[2];
for (const [name, url] of [["gateway", DEVNET.mempool], ["miner", "https://altmempool.forshtat.com/rpc"]] as const) {
  const st = await rpc<any>(url, "skandha_frameTransactionStatus", [h]).catch((e) => ({ error: String(e.message).slice(0, 120) }));
  const { tx, ...rest } = st as any;
  console.log(name, "status", JSON.stringify(rest).slice(0, 300));
  const ex = await rpc<any>(url, "skandha_explorer_getTransaction", [h]).catch((e) => ({ error: String(e.message).slice(0, 120) }));
  if (ex.error) console.log(name, "explorer", ex.error);
  else {
    console.log(name, "explorer keys", Object.keys(ex));
    console.log(JSON.stringify(ex.lifecycle ?? ex.events ?? ex.timeline ?? "").slice(0, 900));
    console.log(JSON.stringify(ex.admission?.outcome ?? ex.outcome ?? ""), JSON.stringify(ex.includer ?? ""), JSON.stringify(ex.reason ?? ""));
  }
}
const peers = await rpc<any>(DEVNET.mempool, "skandha_connectedPeers", []).catch((e) => String(e.message));
console.log("peers", JSON.stringify(peers).slice(0, 200));
const info = await rpc<any>(DEVNET.mempool, "skandha_explorer_listTransactions", [{ limit: 6 }]).catch((e) => ({ error: String(e.message) }));
console.log(JSON.stringify(info).slice(0, 1200));
