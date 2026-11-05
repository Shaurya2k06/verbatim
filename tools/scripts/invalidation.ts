// §16.6: prepare N signed transactions, refresh trust, revoke one descriptor; only the dependents should stop validating.
// Validation is re-run through ethrex's simulator, the same call the sidecar makes for admission and revalidation. All
// transactions share a sender, so they are measured one at a time rather than held pending together; see docs/ALTMEMPOOL.md.
import { PAYMASTER_ABI } from "@verbatim/client";
import { keccak256, type Address, type Hex } from "viem";
import { simulate } from "@verbatim/frames-sdk";
import { addr, key, readState, writeState } from "./lib/env";
import { deploy, pub } from "./lib/chain";
import { prepareTx, sign, transferCall } from "./lib/verbatim";
import { attest, descriptorsFor, emptyUpdate } from "./lib/trust-update";
import { record } from "./lib/proofs";
import { decodeRevert } from "./lib/results";

let s = readState();
if (!s.noop) {
  const n = await deploy(key("DEPLOYER_KEY"), "EvilVault.sol", "Noop", { gas: 3_000_000n });
  writeState({ noop: n.address });
  s = readState();
}
const noopCode = keccak256((await pub.getCode({ address: s.noop })) as Hex);
const ping = { target: s.noop as Address, value: 0n, data: "0x5c36b186" as Hex };
const EPOCH = BigInt(await pub.readContract({ address: s.paymaster, abi: PAYMASTER_ABI, functionName: "trustEpoch" }));

const attestTx = await attest(s.paymaster, { ...emptyUpdate(EPOCH + 1n), descriptors: await descriptorsFor("noop.json", noopCode) });
console.log("attested noop", attestTx.transactionHash);
await new Promise((r) => setTimeout(r, 7000));

const valid = async (tx: any) => {
  const r = await simulate(tx);
  return { ok: !r.executionError && !!r.frames, why: r.executionError ? decodeRevert(String(r.revertData ?? r.executionError)) : "" };
};
// Same signedAtBlock, so nothing but the trust store moves between measurements.
const validUntil = (await pub.getBlock()).timestamp + 280n;
const dependent = await sign(await prepareTx([ping], { validUntil }));
const others = await Promise.all([1n, 2n, 3n, 4n].map(async (n) => sign(await prepareTx([transferCall(s.tokenA, addr("OWNER3_KEY"), n)], { validUntil, skipTickets: true }))));

const before = { dependent: await valid(dependent), others: await Promise.all(others.map(valid)) };

// An unrelated refresh first: nothing may change.
const unrelated = emptyUpdate(EPOCH + 2n);
const bump = await attest(s.paymaster, unrelated);
await new Promise((r) => setTimeout(r, 7000));
const afterBump = { dependent: await valid(dependent), others: await Promise.all(others.map(valid)) };

// Now revoke the one descriptor.
const rev = emptyUpdate(EPOCH + 3n);
rev.revocations = [{ codehash: noopCode, selector: "0x5c36b186" }];
const revoke = await attest(s.paymaster, rev);
await new Promise((r) => setTimeout(r, 7000));
const after = { dependent: await valid(dependent), others: await Promise.all(others.map(valid)) };

const pass = before.dependent.ok && before.others.every((o) => o.ok) && afterBump.dependent.ok && afterBump.others.every((o) => o.ok) && !after.dependent.ok && after.others.every((o) => o.ok);
record({
  id: "A15",
  title: "Revoking one descriptor stops only the transactions that use it",
  expected: "an unrelated refresh invalidates nothing; the revocation invalidates 1 of 5",
  pass,
  outcome: "rejected-at-mempool",
  message: after.dependent.why,
  extra: { before: [before.dependent.ok, ...before.others.map((o) => o.ok)], afterUnrelatedRefresh: [afterBump.dependent.ok, ...afterBump.others.map((o) => o.ok)], afterRevocation: [after.dependent.ok, ...after.others.map((o) => o.ok)], unrelatedRefreshTx: bump.transactionHash, revokeTx: revoke.transactionHash },
});
