// Verbatim as a WalletConnect wallet on the production leg. Ported from client/apps/wallet: pairing and sessions live here; each
// eth_sendTransaction is handed to the page, which renders it, collects owner signatures and submits it like any other operation.
// What the dapp says is never what gets signed: the account renders what the calldata does.
import { Core } from "@walletconnect/core";
import { WalletKit } from "@reown/walletkit";
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";

const CHAIN = "eip155:11155111";

/** `onRequest({ dapp, tx, reply })` is called per transaction; `reply` takes { result } or { error }. */
export async function startWallet({ projectId, account, onLog, onRequest }) {
  const kit = await WalletKit.init({
    core: new Core({ projectId }),
    metadata: { name: "Verbatim", description: "The chain is your wallet's screen.", url: location.origin, icons: [] },
  });

  kit.on("session_proposal", async (e) => {
    const name = e.params.proposer.metadata.name;
    onLog(`${name} asks to connect`);
    try {
      const namespaces = buildApprovedNamespaces({
        proposal: e.params,
        supportedNamespaces: { eip155: { chains: [CHAIN], methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"], events: ["accountsChanged", "chainChanged"], accounts: [`${CHAIN}:${account}`] } },
      });
      await kit.approveSession({ id: e.id, namespaces });
      onLog(`connected to ${name}`);
    } catch (err) {
      await kit.rejectSession({ id: e.id, reason: getSdkError("UNSUPPORTED_CHAINS") });
      onLog(`refused ${name}: ${err.message}`);
    }
  });

  kit.on("session_request", async (e) => {
    const { method, params } = e.params.request;
    const dapp = kit.getActiveSessions()[e.topic]?.peer.metadata.name ?? "dapp";
    const reply = (response) => kit.respondSessionRequest({ topic: e.topic, response: { id: e.id, jsonrpc: "2.0", ...response } });
    // Off-chain signatures cannot be checked after the fact, so this wallet does not make them (D10).
    if (method !== "eth_sendTransaction") {
      onLog(`${dapp}: refused ${method}: ERC-1271 and off-chain signatures are off, because the chain cannot post-check them`);
      return reply({ error: { code: 4200, message: `${method} is off: it cannot be post-checked` } });
    }
    onRequest({ dapp, tx: params[0], reply });
  });

  kit.on("session_delete", () => onLog("the dapp disconnected"));

  return {
    pair: (uri) => kit.pair({ uri }),
    sessions: () => Object.values(kit.getActiveSessions()).map((s) => ({ topic: s.topic, name: s.peer.metadata.name, url: s.peer.metadata.url })),
    disconnect: (topic) => kit.disconnectSession({ topic, reason: getSdkError("USER_DISCONNECTED") }),
  };
}
