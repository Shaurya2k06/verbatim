// The second half of the real-interface attack, from the chain's own record of the first half. The transaction the compromised page
// made is public (B-UI-eoa in contracts/docs/proofs.json). This reads its calldata back from Sepolia, hands those exact bytes to
// Verbatim, and reports what the offline device would show and what the account says. Usage: tsx src/verbatim-half.ts <out.json> [txHash]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeErrorResult, formatUnits, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeTree, formatForDevice } from "@verbatim/displayvm-ts";
import { artifact } from "../../live/lib/chain";
import { pub } from "../../live/lib/sepolia";
import { buildOp, validationRevert } from "../../live/lib/userop";
import { ROOT, loadEnv } from "../../live/lib/env";

const env = loadEnv();
const out = process.argv[2];
const proofs = JSON.parse(readFileSync(resolve(ROOT, "contracts/docs/proofs.json"), "utf8"));
const hash = (process.argv[3] ?? proofs["B-UI-eoa"].txHash) as Hex;
const s = JSON.parse(readFileSync(resolve(ROOT, "contracts/.state/sepolia.json"), "utf8"));
const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));

const tx = await pub.getTransaction({ hash });
const rc = await pub.getTransactionReceipt({ hash });
const dUSDC = (s.tokenA as string).toLowerCase();
const hook = privateKeyToAccount(env.ATTACKER_KEY as Hex).address.toLowerCase();
const to = (a: string) => rc.logs.filter((l) => l.address.toLowerCase() === dUSDC && l.topics[0] === TRANSFER && `0x${l.topics[2]!.slice(26)}`.toLowerCase() === a).reduce((n, l) => n + BigInt(l.data), 0n);
const victimGot = to(tx.from.toLowerCase());
const hookTook = to(hook);

const snap = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/snapshot-sepolia.json"), "utf8"));
const built = await buildOp(s.account4337, [{ target: tx.to!, value: tx.value, data: tx.input }], env.BUNDLER_URL, snap);
const lines = formatForDevice(decodeTree(built.tree));
const raw = await validationRevert(built);
const named = raw ? decodeErrorResult({ abi: artifact("VerbatimAccount4337.sol", "VerbatimAccount4337").abi, data: raw }) : null;
const res = {
  hash, block: Number(rc.blockNumber), from: tx.from, to: tx.to, valueEth: formatUnits(tx.value, 18), calldataBytes: (tx.input.length - 2) / 2,
  victimGot: formatUnits(victimGot, 6), hookTook: formatUnits(hookTook, 6), hookShare: Math.round(Number(hookTook * 100n / (hookTook + victimGot || 1n))),
  quoted: proofs["B-UI-eoa"].extra?.quotedUsdc,
  request: { tree: built.tree, txCommit: built.hash },
  lines, refusal: named ? `${named.errorName}(${(named.args ?? []).join(",")})` : null,
};
writeFileSync(out, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ ...res, request: undefined, lines: lines.filter((l) => l.risk).map((l) => l.text) }, null, 1));
