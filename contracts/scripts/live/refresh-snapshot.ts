// A snapshot lasts six hours. This re-signs the published Sepolia root, unchanged, with fresh timestamps: it attests nothing new.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { snapshotTypedData, type PublishedSnapshot } from "@verbatim/snapshot-cli";
import { ROOT, loadEnv } from "./lib/env";

const env = loadEnv();
const file = resolve(ROOT, "contracts/deployments/snapshot-sepolia.json");
const snap: PublishedSnapshot = JSON.parse(readFileSync(file, "utf8"));
const issuedAt = BigInt(Math.floor(Date.now() / 1000)) - 60n;
const expiry = issuedAt + 6n * 3600n;
const signers = ["ATTESTOR1_KEY", "ATTESTOR2_KEY"].map((k) => privateKeyToAccount(env[k] as Hex)).sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
const typed = snapshotTypedData(BigInt(snap.chainId), snap.root as Hex, issuedAt, expiry, snap.schema);
const signatures = await Promise.all(signers.map(async (a) => ({ signer: a.address, sig: await a.signTypedData(typed as never) })));
writeFileSync(file, JSON.stringify({ ...snap, issuedAt: issuedAt.toString(), expiry: expiry.toString(), signatures }, null, 1) + "\n");
console.log("snapshot", snap.root, "good until", new Date(Number(expiry) * 1000).toISOString());
