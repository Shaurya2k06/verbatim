import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { REFRESH_ABI, attest8176, descriptorsFromJson, emptyUpdate, encodeRefresh, sortSigs, tokenEntry, updateHash, type TrustUpdate } from "@verbatim/attestor-cli";
import { descriptorHash } from "@verbatim/vdesc-compiler";
import { buildTree, leavesOf, snapshotTypedData, type PublishedSnapshot } from "@verbatim/snapshot-cli";
import { ROOT, key } from "./env";
import { send } from "./chain";

export { REFRESH_ABI, emptyUpdate, tokenEntry, updateHash, type TrustUpdate };

/** What the attestors sign for a snapshot: `D_snapshot`, ascending by signer, for the 2-of-3 demo quorum. */
export async function publishSnapshot(u: TrustUpdate, chainId: bigint, status: number, attestorsAll: Hex[] = ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map((k) => key(k))): Promise<PublishedSnapshot> {
  const accounts = attestorsAll.map((k) => privateKeyToAccount(k));
  const t = buildTree(leavesOf(u as never, chainId, status));
  const signing = sortSigs(accounts).slice(0, 2);
  const signatures = await Promise.all(signing.map(async (a) => ({ signer: a.address, sig: await a.signTypedData(snapshotTypedData(chainId, t.root, u.issuedAt, u.expiry) as never) })));
  return { chainId: chainId.toString(), schema: 1, root: t.root, depth: t.depth, issuedAt: u.issuedAt.toString(), expiry: u.expiry.toString(), leaves: t.leaves, attestors: accounts.map((a) => a.address), signatures };
}

const signers = () => ["ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY"].map((k) => privateKeyToAccount(key(k)));

/** ERC-8176 attestations over a descriptor hash, by the first two attestors. */
export const attestations = (hash: Hex) => attest8176(hash, sortSigs(signers()).slice(0, 2) as never, BigInt(Math.floor(Date.now() / 1000)));

/** A descriptor file with `$NAME` placeholders resolved, attested in ERC-8176 form by the first two attestors. */
export async function descriptorsFor(file: string, codehash: Hex, vars: Record<string, string> = {}, publisher?: string): Promise<TrustUpdate["descriptors"]> {
  let text = readFileSync(resolve(ROOT, "contracts/descriptors", file), "utf8");
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`$${k}`, v);
  const json = JSON.parse(text);
  return descriptorsFromJson(json, codehash, publisher, await attestations(descriptorHash(json)));
}

/** Collects 2 of 3 attestor signatures and submits `refreshTrust`. */
export async function attest(paymaster: `0x${string}`, u: TrustUpdate, chainId = 1337n, submit = (data: Hex) => send(key("DEPLOYER_KEY"), paymaster, data, 0n, 25_000_000n)) {
  const h = updateHash(chainId, paymaster, u);
  const sorted = sortSigs(signers()).slice(0, 2);
  const sigs = await Promise.all(sorted.map((x) => x.sign({ hash: h })));
  return submit(encodeRefresh(u, sigs));
}
