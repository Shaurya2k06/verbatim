// Verbatim as a WalletConnect wallet (§15): any dapp can pair. A transaction request becomes a sentence on the offline device, and the
// production leg's user operation. What the dapp says is never what gets signed: the wallet renders what the calldata does.
import { Core } from "@walletconnect/core";
import { WalletKit, type WalletKitTypes } from "@reown/walletkit";
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { packedUniswap, prepareUserOp, userOpWithSignatures, type OwnerSig, type PreparedUserOp } from "@verbatim/client";
import type { PublishedSnapshot } from "@verbatim/snapshot-cli";

export interface WcConfig {
  projectId: string;
  rpc: string;
  bundler: string;
  account: Address;
  snapshot: PublishedSnapshot;
  permit2: Address;
  weth: Address;
  /** Shows the sentence and collects the owners' signatures. Rejects to refuse. */
  sign(p: PreparedUserOp): Promise<OwnerSig[]>;
  log(line: string): void;
}

const CHAIN = "eip155:11155111";

async function bundlerRpc(url: string, method: string, params: unknown[]) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const b = await res.json();
  if (b.error) throw new Error(b.error.message);
  return b.result;
}

export async function startWallet(c: WcConfig) {
  const client = createPublicClient({ chain: sepolia, transport: http(c.rpc) });
  const kit = await WalletKit.init({ core: new Core({ projectId: c.projectId }), metadata: { name: "Verbatim", description: "The chain is your wallet's screen.", url: location.origin, icons: [] } });

  kit.on("session_proposal", async (e: WalletKitTypes.SessionProposal) => {
    c.log(`${e.params.proposer.metadata.name} asks to connect`);
    try {
      const namespaces = buildApprovedNamespaces({ proposal: e.params, supportedNamespaces: { eip155: { chains: [CHAIN], methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"], events: ["accountsChanged", "chainChanged"], accounts: [`${CHAIN}:${c.account}`] } } });
      await kit.approveSession({ id: e.id, namespaces });
      c.log("connected");
    } catch (err) {
      await kit.rejectSession({ id: e.id, reason: getSdkError("UNSUPPORTED_CHAINS") });
      c.log(`refused: ${(err as Error).message}`);
    }
  });

  kit.on("session_request", async (e: WalletKitTypes.SessionRequest) => {
    const { method, params } = e.params.request;
    const reply = (response: object) => kit.respondSessionRequest({ topic: e.topic, response: { id: e.id, jsonrpc: "2.0", ...response } as never });
    // Off-chain signatures cannot be checked after the fact, so this wallet does not make them (D10).
    if (method !== "eth_sendTransaction") return reply({ error: { code: 4200, message: `${method} is off: it cannot be post-checked` } });
    try {
      const tx = params[0] as { to: Address; data?: Hex; value?: Hex };
      const block = await client.getBlock();
      const quoted = await bundlerRpc(c.bundler, "pimlico_getUserOperationGasPrice", []).catch(() => null);
      const est = quoted ? { maxFeePerGas: BigInt(quoted.fast.maxFeePerGas), maxPriorityFeePerGas: BigInt(quoted.fast.maxPriorityFeePerGas) } : await client.estimateFeesPerGas();
      const p = await prepareUserOp({ client: client as never, account: c.account, calls: [{ target: tx.to, value: BigInt(tx.value ?? 0), data: tx.data ?? "0x" }], snapshot: c.snapshot, router: { permit2: c.permit2, weth: c.weth, publisher: packedUniswap }, fees: { maxFeePerGas: est.maxFeePerGas, maxPriorityFeePerGas: est.maxPriorityFeePerGas }, expiry: block.timestamp + 240n });
      const sigs = await c.sign(p);
      const h = await bundlerRpc(c.bundler, "eth_sendUserOperation", [userOpWithSignatures(p, sigs), "0x0000000071727De22E5E9d8BAf0edAc6f37da032"]);
      c.log(`user operation ${h}`);
      let receipt = null;
      for (let i = 0; i < 40 && !receipt; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        receipt = await bundlerRpc(c.bundler, "eth_getUserOperationReceipt", [h]).catch(() => null);
      }
      if (!receipt) throw new Error("not mined");
      await reply({ result: receipt.receipt.transactionHash });
    } catch (err) {
      c.log(`refused: ${(err as Error).message}`);
      await reply({ error: { code: 4001, message: (err as Error).message.slice(0, 200) } });
    }
  });

  return { pair: (uri: string) => kit.pair({ uri }) };
}
