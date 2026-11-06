import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ENV = resolve(ROOT, ".env");
export const STATE = resolve(ROOT, process.env.VERBATIM_STATE ?? "contracts/.state/devnet.json");

const KEYS = ["DEPLOYER_KEY", "OWNER1_KEY", "OWNER2_KEY", "OWNER3_KEY", "ATTESTOR1_KEY", "ATTESTOR2_KEY", "ATTESTOR3_KEY", "ATTACKER_KEY"];

/** Devnet-only keys, generated on first use into the git-ignored .env. */
export function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (existsSync(ENV)) for (const l of readFileSync(ENV, "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  let dirty = false;
  for (const k of KEYS) if (!env[k]) { env[k] = generatePrivateKey(); dirty = true; }
  if (dirty) writeFileSync(ENV, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  return env;
}

export const key = (name: string) => loadEnv()[name] as Hex;
export const addr = (name: string): Address => privateKeyToAccount(key(name)).address;

export function readState(): Record<string, any> {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
}
export function writeState(patch: Record<string, unknown>) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify({ ...readState(), ...patch }, null, 2) + "\n");
}
