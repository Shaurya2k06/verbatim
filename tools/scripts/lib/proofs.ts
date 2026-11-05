import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./env";

const FILE = resolve(ROOT, "docs/proofs.json");

export interface Proof {
  id: string;
  title: string;
  expected: string;
  /** true when what happened is what the spec requires */
  pass: boolean;
  outcome: "rejected-at-mempool" | "mined" | "reverted-in-batch" | "not-run";
  message?: string;
  txHash?: string;
  block?: number;
  frameGas?: { execution: number; state: number }[];
  extra?: Record<string, unknown>;
  at?: string;
}

/** Node errors quote the RPC URL, which holds the API key. Nothing with a key in it reaches a committed file. */
const scrub = (t?: string) => t?.replace(/(apikey=|\/v2\/)[A-Za-z0-9_-]+/g, "$1***");

export function record(raw: Proof) {
  const p = { ...raw, message: scrub(raw.message) };
  const all: Record<string, Proof> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
  all[p.id] = { ...p, at: new Date().toISOString() };
  writeFileSync(FILE, JSON.stringify(all, null, 2) + "\n");
  console.log(`${p.pass ? "PASS" : "FAIL"} ${p.id}: ${p.title} -> ${p.outcome}${p.txHash ? ` ${p.txHash}` : ""}${p.message ? ` | ${p.message.slice(0, 200)}` : ""}`);
}
