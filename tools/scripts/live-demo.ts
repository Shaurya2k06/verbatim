// The whole demo, live on Sepolia, narrated in the terminal: an ordinary wallet losing to a skim hook, Verbatim refusing the same
// swap, the honest swap landing, the attack kit, and ENS as the trust root. Owner keys come from the git-ignored .env and sign
// here, standing in for the offline signer; the device's own refusal rules (packages/signer) are applied to every sentence.
//
//   npx tsx live-demo.ts          everything, including 3 mined transactions (about 0.002 Sepolia ETH plus gas)
//   npx tsx live-demo.ts --dry    only what is refused before the mempool: nothing is mined, nothing is paid
//   npx tsx live-demo.ts --only=B14,A1   just those steps (EOA A2 A2b SWAP A1 A4 A5 A16 A17 A13 B14 ENS)
//
// It does not write docs/proofs.json: `legb-run.ts` records proofs. This is for watching.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, decodeAbiParameters, decodeErrorResult, encodeFunctionData, formatEther, formatUnits, http, keccak256, namehash, parseAbi, parseEther, toHex, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { decodeTree, formatForDevice, packStr } from "@verbatim/displayvm-ts";
import { review } from "@verbatim/signer";
import { snapshotTypedData, type PublishedSnapshot } from "@verbatim/snapshot-cli";
import { CMD, executeData, v4ExactInSingleInput, v4SwapCall } from "@verbatim/urrender";
import { ROOT, key, loadEnv } from "./lib/env";
import { artifact } from "./lib/chain";
import { RESOLVER_ABI, dnsName, pub } from "./lib/sepolia";
import { buildOp, sendOp, validationRevert, waitOp, type Built } from "./lib/userop";

const DRY = process.argv.includes("--dry");
/** --only=B14,A1 runs just those; the step headers still print. */
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",") ?? null;
const want = (id: string) => !ONLY || ONLY.includes(id);
const env = loadEnv();
const dep = JSON.parse(readFileSync(resolve(ROOT, "deployments/sepolia.json"), "utf8"));
const account: Address = dep.account;
const BUNDLER = env.BUNDLER_URL;

// ---- terminal output ------------------------------------------------------------------------------------------------------
const c = (n: number) => (s: string) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = c(1), dim = c(2), red = c(31), green = c(32), yellow = c(33), cyan = c(36);
const tx = (h: string) => cyan(`https://sepolia.etherscan.io/tx/${h}`);
const say = (s = "") => console.log(s);
const step = (n: string, title: string, expect: string) => say(`\n${bold(`── ${n} · ${title}`)}\n${dim(`   expected: ${expect}`)}`);
function device(tree: Hex, title = "The offline signer shows") {
  say(dim(`   ┌ ${title}`));
  for (const l of formatForDevice(decodeTree(tree))) {
    const text = `${"  ".repeat(l.indent)}${l.text}`;
    say(`   │ ${l.risk ? red(bold(text)) : l.guarantee ? bold(text) : dim(text)}`);
  }
  say(dim("   └"));
}
const results: { id: string; title: string; ok: boolean; got: string; link?: string }[] = [];
const verdict = (id: string, title: string, ok: boolean, got: string, link?: string) => {
  results.push({ id, title, ok, got, link });
  say(`   ${ok ? green("✓") : red("✗")} ${got}${link ? `\n     ${tx(link)}` : ""}`);
};

// ---- chain helpers --------------------------------------------------------------------------------------------------------
const ACCOUNT_ABI = artifact("VerbatimAccount4337.sol", "VerbatimAccount4337").abi as Abi;
const ANCHOR_ERRORS = parseAbi(["error AttestorNotListed(address attestor)", "error LeafRevokedInEns(bytes32 leafHash)"]);
const ERRORS = [...ACCOUNT_ABI, ...ANCHOR_ERRORS] as Abi;
const CHECKER = artifact("EnsTrustChecker.sol", "EnsTrustChecker").abi as Abi;
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256)", "function transfer(address,uint256)"]);
const PERMIT2 = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const QUOTER = parseAbi(["struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }", "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }", "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)"]);
const VERBATIM_RESULT = keccak256(toHex("VerbatimResult(bool,bytes)"));
const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));

const decode = (data: Hex | null | undefined) => {
  if (!data || data === "0x") return "";
  try {
    const e = decodeErrorResult({ abi: ERRORS, data });
    return `${e.errorName}(${(e.args ?? []).map((a) => (typeof a === "bigint" ? `0x${a.toString(16)}` : String(a))).join(", ")})`;
  } catch {
    return data.slice(0, 74);
  }
};
const received = (logs: { address: string; topics: Hex[]; data: Hex }[], token: Address, to: Address) =>
  logs.filter((l) => l.address.toLowerCase() === token.toLowerCase() && l.topics[0] === TRANSFER && `0x${l.topics[2].slice(26)}`.toLowerCase() === to.toLowerCase()).reduce((a, l) => a + BigInt(l.data), 0n);
const ONE = parseEther("0.001");
const swap = (k: unknown, min: bigint) => ({ target: dep.uniswap.router as Address, value: ONE, data: v4SwapCall({ key: k as never, zeroForOne: true, amountIn: ONE, amountOutMinimum: min, legacyParams: true }, BigInt(Math.floor(Date.now() / 1000) + 3600)) });
const transfer = (to: Address, n: bigint) => ({ target: dep.tokens.dUSDC as Address, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, n] }) });

/** The published snapshot, re-signed by the attestors with fresh timestamps if it is about to expire. Root and leaves unchanged. */
async function freshSnapshot(): Promise<PublishedSnapshot> {
  const snap: PublishedSnapshot = JSON.parse(readFileSync(resolve(ROOT, "deployments/snapshot-sepolia.json"), "utf8"));
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(snap.expiry) - now > 20n * 60n) return snap;
  const listed = new Set(snap.attestors.map((a) => a.toLowerCase()));
  const signers = ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map((k) => privateKeyToAccount(key(k))).filter((a) => listed.has(a.address.toLowerCase())).sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1)).slice(0, 2);
  const issuedAt = now - 60n;
  const expiry = issuedAt + 6n * 3600n;
  const signatures = await Promise.all(signers.map(async (a) => ({ signer: a.address, sig: await a.signTypedData(snapshotTypedData(BigInt(snap.chainId), snap.root as Hex, issuedAt, expiry) as never) })));
  say(yellow(`   the published snapshot expires soon; re-signed its root with fresh timestamps (valid to ${new Date(Number(expiry) * 1000).toISOString().slice(11, 16)} UTC)`));
  return { ...snap, issuedAt: issuedAt.toString(), expiry: expiry.toString(), signatures };
}

let snapshot: PublishedSnapshot;
const build = (calls: Parameters<typeof buildOp>[1], opts: Parameters<typeof buildOp>[4] = {}) => buildOp(account, calls, BUNDLER, snapshot, opts);

/** Would the offline device sign this? It decodes strictly and checks expiry against its own clock. */
function deviceRefuses(b: Built): string | null {
  try {
    review({ tree: b.tree, txCommit: b.hash });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Submits; on a refusal, asks the account itself why, the way the EntryPoint would. */
async function submit(b: Built): Promise<{ rejected: string } | { txHash: Hex; ok: boolean; err: string; gas: bigint; logs: any[] }> {
  try {
    const h = await sendOp(BUNDLER, b.op);
    say(dim(`   admitted by the bundler as ${h.slice(0, 18)}…, waiting for a block`));
    const r = await waitOp(BUNDLER, h);
    const logs = r.logs ?? [];
    const l = [...logs, ...(r.receipt?.logs ?? [])].find((x: any) => x.address.toLowerCase() === account.toLowerCase() && x.topics?.[0] === VERBATIM_RESULT);
    const ok = l ? BigInt(l.topics[1]) === 1n : r.success === true;
    const err = l ? decode(decodeAbiParameters([{ type: "bytes" }], l.data)[0] as Hex) : "";
    return { txHash: r.receipt.transactionHash, ok, err, gas: BigInt(r.actualGasUsed), logs: r.receipt?.logs ?? [] };
  } catch {
    return { rejected: decode(await validationRevert(b)) || "no named reason" };
  }
}

/** One attack or case that must be refused in validation. */
async function mustReject(id: string, title: string, expect: RegExp, b: Built, shown?: Hex) {
  device(shown ?? b.tree);
  const r = await submit(b);
  if ("rejected" in r) verdict(id, title, expect.test(r.rejected), `rejected in validation, never reached the mempool: ${bold(r.rejected)}`);
  else verdict(id, title, false, `it was mined (${r.ok ? "batch ok" : r.err})`, r.txHash);
}

// ---- the run --------------------------------------------------------------------------------------------------------------
say(bold("\nVerbatim, live on Sepolia") + dim(`  ${DRY ? "dry run: only what is refused before the mempool" : "full run: includes 3 mined transactions"}`));

step("0", "Preflight", "Sepolia and the bundler answer; the snapshot is fresh; the wallets are funded");
const [head, eps, accEth, owners, threshold] = await Promise.all([
  pub.getBlockNumber(),
  fetch(BUNDLER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_supportedEntryPoints", params: [] }) }).then((r) => r.json()),
  pub.getBalance({ address: account }),
  pub.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "owners" }) as Promise<Address[]>,
  pub.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "threshold" }) as Promise<number>,
]);
snapshot = await freshSnapshot();
const eoa = env.DEMO_EOA_KEY ? privateKeyToAccount(env.DEMO_EOA_KEY as Hex) : null;
const eoaEth = eoa ? await pub.getBalance({ address: eoa.address }) : 0n;
say(`   Sepolia head #${head}, bundler supports ${eps.result?.includes(dep.entryPoint) ? "EntryPoint v0.7" : red("not our EntryPoint")}`);
say(`   Verbatim account ${account}: ${threshold}-of-${owners.length} owners, ${formatEther(accEth)} ETH`);
say(`   snapshot ${snapshot.root.slice(0, 14)}…, valid to ${new Date(Number(snapshot.expiry) * 1000).toISOString().slice(11, 16)} UTC`);
say(`   ordinary wallet ${eoa?.address ?? red("DEMO_EOA_KEY missing")}: ${formatEther(eoaEth)} ETH`);
if (!DRY && (accEth < parseEther("0.01") || eoaEth < parseEther("0.002"))) throw new Error("a wallet is too low for a full run: run fund-demo-eoa.ts, or pass --dry");

const hookAttacker = (await pub.readContract({ address: dep.skimHook, abi: parseAbi(["function ATTACKER() view returns (address)"]), functionName: "ATTACKER" })) as Address;
const { result: [quoted] } = await pub.simulateContract({ address: dep.uniswap.quoter, abi: QUOTER, functionName: "quoteExactInputSingle", args: [{ poolKey: dep.pools.eth.key, zeroForOne: true, exactAmount: ONE, hookData: "0x" }] });
const minOut = (quoted * 99n) / 100n;
say(`   the honest pool quotes ${formatUnits(quoted, 6)} dUSDC for 0.001 ETH; a frontend would ask for at least ${formatUnits(minOut, 6)}`);

// 1. The ordinary wallet
if (want("EOA")) {
step("1", "Ordinary wallet, tampered frontend", "the swap goes through; the hook takes almost all of the output");
say(`   the frontend claims: ${yellow(`Swap 0.001 ETH for at least ${formatUnits(minOut, 6)} dUSDC`)}`);
say(dim("   the calldata it sends: minimum output 0, through SkimHook"));
if (DRY || !eoa) say(dim("   skipped (dry run)"));
else {
  const w = createWalletClient({ account: eoa, chain: sepolia, transport: http(env.SEPOLIA_RPC_URL) });
  const call = swap(dep.pools.ethEvil.key, 0n);
  const hash = await w.sendTransaction({ to: call.target, data: call.data, value: call.value, gas: 2_000_000n });
  const rc = await createPublicClient({ chain: sepolia, transport: http(env.SEPOLIA_RPC_URL) }).waitForTransactionReceipt({ hash, timeout: 180_000 });
  const got = received(rc.logs as never, dep.tokens.dUSDC, eoa.address);
  const took = received(rc.logs as never, dep.tokens.dUSDC, hookAttacker);
  verdict("EOA", "Ordinary wallet, evil route", rc.status === "success" && took > got, `victim got ${red(formatUnits(got, 6))} dUSDC, the hook took ${red(formatUnits(took, 6))} dUSDC`, hash);
}

}
// 2. Verbatim, same tamper
const shown = await build([swap(dep.pools.eth.key, minOut)]);
if (want("A2")) {
step("2", "Verbatim, same tampered frontend", "TreeMismatch: the chain re-renders the calldata and it is not what was signed");
await mustReject("A2", "SkimHook under an honest sentence", /TreeMismatch/, await build([swap(dep.pools.ethEvil.key, 0n)], { expiry: shown.expiry, override: { tree: shown.tree, spec: shown.spec } }), shown.tree);

}
// 3. Verbatim, the truth
if (want("A2b")) {
step("3", "Verbatim, the owners sign the true sentence anyway", "PolicyRefused: three risk lines, and the policy refuses them");
await mustReject("A2b", "SkimHook, true sentence", /PolicyRefused/, await build([swap(dep.pools.ethEvil.key, 0n)]));

}
// 4. Honest swap
if (want("SWAP")) {
step("4", "Verbatim, honest swap", "admitted, mined, minimum output enforced at execution");
if (DRY) {
  device(shown.tree);
  say(dim("   skipped (dry run)"));
} else {
  const b = await build([swap(dep.pools.eth.key, minOut)]);
  device(b.tree);
  const r = await submit(b);
  if ("rejected" in r) verdict("SWAP", "Honest swap", false, `refused: ${r.rejected}`);
  else {
    const got = received(r.logs, dep.tokens.dUSDC, account);
    verdict("SWAP", "Honest swap", r.ok && got >= minOut, `landed: received ${green(formatUnits(got, 6))} dUSDC (signed minimum ${formatUnits(minOut, 6)}), ${r.gas} gas`, r.txHash);
  }
}

}
// 5. The attack kit
if (["A1", "A4", "A5", "A16", "A17", "A13", "B14"].some(want)) step("5", "Attack kit", "every lie about the sentence dies in validation; a lie about effects reverts");
const bob = dep.ens.recipient as Address;
const honestT = await build([transfer(bob, 1_000_000n)]);
if (want("A1")) {
say(bold("   A1 · swap the recipient"));
await mustReject("A1", "Swap the recipient", /TreeMismatch/, await build([transfer(hookAttacker, 1_000_000n)], { expiry: honestT.expiry, override: { tree: honestT.tree, spec: honestT.spec } }), honestT.tree);
}
if (want("A4")) {
say(bold("   A4 · keep the sentence, empty the assertions"));
await mustReject("A4", "Weaker spec", /SignersNotSortedOrUnknown|SpecMismatch|SpecHashMismatch/, await build([transfer(bob, 1_000_000n)], { override: { tree: honestT.tree, spec: "0x565300020000" } }), honestT.tree);
}
if (want("A5")) {
say(bold("   A5 · call a contract nobody attested"));
await mustReject("A5", "Unattested contract", /PolicyRefused/, await build([{ target: dep.skimHook, value: 0n, data: "0xdeadbeef" }]));
}
if (want("A16")) {
say(bold("   A16 · router command allowed to fail silently"));
await mustReject("A16", "Allow-revert command", /PolicyRefused/, await build([{ target: dep.uniswap.router, value: ONE, data: executeData([CMD.V4_SWAP | CMD.FLAG_ALLOW_REVERT], [v4ExactInSingleInput({ key: dep.pools.eth.key, zeroForOne: true, amountIn: ONE, amountOutMinimum: minOut, legacyParams: true })], BigInt(Math.floor(Date.now() / 1000) + 600)) }]));
}
if (want("A17")) {
say(bold("   A17 · router command nobody can read"));
await mustReject("A17", "Unknown router command", /PolicyRefused/, await build([{ target: dep.uniswap.router, value: 0n, data: executeData([0x0a], ["0x1234"], BigInt(Math.floor(Date.now() / 1000) + 600)) }]));
}
if (want("A13")) {
say(bold("   A13 · a signature that stays valid for hours"));
{
  const b = await build([transfer(bob, 1_000_000n)], { expiry: BigInt(snapshot.expiry) - 60n });
  const why = deviceRefuses(b);
  verdict("A13", "Future-dated expiry", !!why, why ? `the device refuses to sign: ${bold(why)}` : "the device would have signed it");
}
}
if (want("B14")) {
say(bold("   B14 · an approval that would outlive the transaction"));
if (DRY) say(dim("   skipped (dry run): it is mined, then its batch reverts"));
else {
  // A Permit2 allowance for the router that would outlive the batch. (An ERC-20 approve *to* Permit2 is a base allowance the
  // account records in its ledger by design; this is the one APPROVALS_CLEARED forbids.)
  const b = await build([{ target: dep.uniswap.permit2, value: 0n, data: encodeFunctionData({ abi: PERMIT2, functionName: "approve", args: [dep.tokens.dUSDC, dep.uniswap.router, 1_000_000n, Math.floor(Date.now() / 1000) + 3600] }) }]);
  device(b.tree);
  const r = await submit(b);
  if ("rejected" in r) verdict("B14", "Approval left standing", false, `refused in validation instead: ${r.rejected}`);
  else verdict("B14", "Approval left standing", !r.ok && /AssertionFailed/.test(r.err), r.ok ? "it landed: the approval stands" : `mined, batch reverted, nothing moved: ${bold(r.err)}`, r.txHash);
}

}
// 6. ENS
if (want("ENS")) {
step("6", "ENS as the trust root", "the publisher is exclusive; the lookalike is refused; the recipient's name checks out");
const desc = snapshot.leaves.find((l) => l.type === 1)!;
const check = async (fn: string, args: unknown[]) => {
  try {
    await pub.readContract({ address: dep.ensTrustChecker, abi: CHECKER, functionName: fn, args });
    return null;
  } catch (e) {
    const r = e instanceof BaseError ? (e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null) : null;
    if (r?.data?.errorName) return `${r.data.errorName}(${(r.data.args ?? []).map((a) => (typeof a === "bigint" ? `0x${a.toString(16)}` : String(a))).join(", ")})`;
    return (e as { shortMessage?: string }).shortMessage ?? "reverted";
  }
};
{
  const r = await check("check", [desc.value[1], desc.value[0]]);
  verdict("ENS-pub", `${dep.ens.publisher} publishes descriptors`, r === null, r === null ? `${dep.ens.publisher} is an exclusive publisher: only its council can change its record` : `refused: ${r}`);
  const l = await check("check", [packStr(dep.ens.lookalike), desc.value[0]]);
  verdict("A8", `${dep.ens.lookalike} lookalike`, !!l && /WrongResolverCode|RootRolesHeld|NoResolver/.test(l), l ? `refused: ${bold(l)}; a sentence shows its address as hex` : "accepted: wrong");
  const n = await check("checkName", [bob, packStr(dep.ens.publisher), dep.ens.publisherResolver]);
  verdict("ENS-name", "Recipient name", n === null, n === null ? `${dep.ens.publisher} resolves to ${bob} and names itself back` : `refused: ${n}`);
  const raw = await pub.readContract({ address: dep.ens.anchorResolver, abi: RESOLVER_ABI, functionName: "resolve", args: [dnsName(dep.ens.anchor), encodeFunctionData({ abi: RESOLVER_ABI, functionName: "text", args: [namehash(dep.ens.anchor), "attestors"] })] }).catch(() => null);
  const listed = raw ? (decodeAbiParameters([{ type: "string" }], raw as Hex)[0] as string) : "";
  say(`   attestors listed in ${dep.ens.anchor}: ${listed ? listed.split(",").length : "?"}; this snapshot was signed by ${snapshot.signatures.length} of them`);
}

}
// Summary
say(`\n${bold("── Summary")}`);
for (const r of results) say(`   ${r.ok ? green("✓") : red("✗")} ${r.id.padEnd(9)} ${r.title}${r.link ? dim(`  ${r.link.slice(0, 12)}…`) : ""}`);
const failed = results.filter((r) => !r.ok);
const attacks = results.filter((r) => !["EOA", "SWAP", "ENS-pub", "ENS-name"].includes(r.id));
say(`\n   ${attacks.filter((r) => r.ok).length} of ${attacks.length} attacks stopped where expected · ${bold(green("$0 stolen from the Verbatim account"))}${DRY ? "" : `\n   ${results.filter((r) => r.link).length} transactions mined this run`}`);
if (failed.length) {
  say(red(`   ${failed.length} step(s) did not go as expected`));
  process.exitCode = 1;
}
