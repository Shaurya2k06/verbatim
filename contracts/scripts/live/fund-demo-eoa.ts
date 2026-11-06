// The "ordinary wallet" the site's /demo sends from: a throwaway Sepolia EOA, created once in .env as DEMO_EOA_KEY and topped up
// from SEPOLIA_KEY. It holds no role in Verbatim. Usage: npx tsx fund-demo-eoa.ts [eth]
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatEther, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ROOT, loadEnv } from "./lib/env";
import { pub, wallet } from "./lib/sepolia";

const env = loadEnv();
let k = env.DEMO_EOA_KEY as Hex | undefined;
if (!k) {
  k = generatePrivateKey();
  appendFileSync(resolve(ROOT, ".env"), `DEMO_EOA_KEY=${k}\n`);
  console.log("created DEMO_EOA_KEY in .env");
}
const eoa = privateKeyToAccount(k).address;
const target = parseEther(process.argv[2] ?? "0.03");
const have = await pub.getBalance({ address: eoa });
if (have < target) {
  const w = wallet();
  const hash = await w.sendTransaction({ to: eoa, value: target - have, account: w.account!, chain: w.chain });
  await pub.waitForTransactionReceipt({ hash });
  console.log("funded", hash);
}
console.log(eoa, formatEther(await pub.getBalance({ address: eoa })), "ETH");
