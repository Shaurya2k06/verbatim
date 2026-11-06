// The devnet has no faucet any more. Its docs say to fund your own key once from the throwaway account whose key the
// sidecar repo publishes on purpose (deploy/devnet/genesis.values.env). Pass that key as SHARED_KEY; it never enters this repo.
import { parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pub, send } from "./lib/chain";
import { addr } from "./lib/env";

const k = process.env.SHARED_KEY as Hex;
if (!k) throw new Error("set SHARED_KEY");
const me = addr("DEPLOYER_KEY");
const shared = privateKeyToAccount(k).address;
console.log("shared", shared, Number(await pub.getBalance({ address: shared })) / 1e18, "deployer", me, Number(await pub.getBalance({ address: me })) / 1e18);
const r = await send(k, me, "0x", parseEther(process.argv[2] ?? "10"), 300_000n);
console.log(r.status, "deployer now", Number(await pub.getBalance({ address: me })) / 1e18);
