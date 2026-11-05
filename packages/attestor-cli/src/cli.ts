#!/usr/bin/env tsx
// verbatim-attest compile <descriptor.json>                 VDesc bytes and hashes
// verbatim-attest record <descriptor.json>...               the ENS `clear-signing` record value
// verbatim-attest hash <update.json> --chain N --paymaster 0x...   the hash attestors sign
// verbatim-attest sign <hash>                               signs with ATTESTOR_KEY from the environment
// verbatim-attest calldata <update.json> <sig>...           refreshTrust calldata, signatures sorted by signer
import { readFileSync } from "node:fs";
import { recoverAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileFile } from "@verbatim/vdesc-compiler";
import { encodeRefresh, ensRecordValue, updateHash, type TrustUpdate } from "./update";

const [cmd, ...args] = process.argv.slice(2);
const json = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const flag = (n: string) => args[args.indexOf(`--${n}`) + 1];
/** bigints arrive as strings in update.json */
const loadUpdate = (f: string): TrustUpdate => {
  const u = json(f);
  return { ...u, epoch: BigInt(u.epoch), issuedAt: BigInt(u.issuedAt), expiry: BigInt(u.expiry) };
};

switch (cmd) {
  case "compile":
    for (const d of compileFile(json(args[0]))) console.log(JSON.stringify(d));
    break;
  case "record":
    console.log(ensRecordValue(args.map(json)));
    break;
  case "hash":
    console.log(updateHash(BigInt(flag("chain")), flag("paymaster") as Address, loadUpdate(args[0])));
    break;
  case "sign": {
    const k = process.env.ATTESTOR_KEY as Hex | undefined;
    if (!k) throw new Error("set ATTESTOR_KEY");
    const a = privateKeyToAccount(k);
    console.log(JSON.stringify({ attestor: a.address, signature: await a.sign({ hash: args[0] as Hex }) }));
    break;
  }
  case "calldata": {
    const u = loadUpdate(args[0]);
    const sigs = args.slice(1).filter((x) => !x.startsWith("--") && x.startsWith("0x")) as Hex[];
    const h = updateHash(BigInt(flag("chain")), flag("paymaster") as Address, u);
    const withAddr = await Promise.all(sigs.map(async (s) => ({ s, a: BigInt(await recoverAddress({ hash: h, signature: s })) })));
    withAddr.sort((x, y) => (x.a < y.a ? -1 : 1));
    console.log(encodeRefresh(u, withAddr.map((x) => x.s)));
    break;
  }
  default:
    console.error("usage: verbatim-attest compile|record|hash|sign|calldata ...");
    process.exit(1);
}
