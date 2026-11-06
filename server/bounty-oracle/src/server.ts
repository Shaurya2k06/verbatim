// A policy-bounded signing oracle. POST {tree, txCommit}: if the sentence meets the policy, it signs D_owner with its one owner key.
// Refuses to start without its key and policy. It holds no funds; on its own one key cannot meet the threshold (see contracts/docs/BOUNTY.md).
import { createServer } from "node:http";
import { hashTypedData, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeTree, specOf } from "@verbatim/displayvm-ts";
import { check, type Policy } from "./policy";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`set ${k}`);
  return v;
};
const key = privateKeyToAccount(need("ORACLE_KEY") as Hex);
const policy: Policy = { account: need("ORACLE_ACCOUNT") as Address, chainId: BigInt(need("ORACLE_CHAIN_ID")), output: need("ORACLE_OUTPUT") as Address, pricePerEth: BigInt(need("ORACLE_PRICE")), maxIn: BigInt(need("ORACLE_MAX_IN")), minOutBps: 9800n, maxValidity: 240n };
const stats = { attempts: 0, signed: 0, refused: 0 };

createServer((req, res) => {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/stats") return send(200, stats);
  if (req.method !== "POST") return send(404, {});
  let raw = "";
  req.on("data", (c) => {
    raw += c;
    if (raw.length > 200_000) req.destroy();
  });
  req.on("end", async () => {
    stats.attempts++;
    try {
      const { tree, txCommit } = JSON.parse(raw) as { tree: Hex; txCommit: Hex };
      const v = check(tree, policy, BigInt(Math.floor(Date.now() / 1000)));
      if (!v.ok) {
        stats.refused++;
        return send(403, { refused: v.why });
      }
      const t = decodeTree(tree);
      const typed = {
        domain: { name: "Verbatim", version: "11", chainId: t.chainId, verifyingContract: t.account },
        types: { Tx: [{ name: "treeHash", type: "bytes32" }, { name: "specHash", type: "bytes32" }, { name: "expiry", type: "uint64" }, { name: "snapshotRoot", type: "bytes32" }, { name: "path", type: "uint8" }, { name: "txCommit", type: "bytes32" }] },
        primaryType: "Tx" as const,
        message: { treeHash: keccak256(tree), specHash: keccak256(specOf(t)), expiry: t.expiry, snapshotRoot: t.snapshotRoot, path: t.path, txCommit },
      };
      const sig = await key.signTypedData(typed);
      stats.signed++;
      send(200, { signer: key.address, sig, digest: hashTypedData(typed) });
    } catch (e) {
      stats.refused++;
      send(400, { refused: (e as Error).message.slice(0, 120) });
    }
  });
}).listen(Number(process.env.PORT ?? 5180), () => console.log("oracle", key.address));
