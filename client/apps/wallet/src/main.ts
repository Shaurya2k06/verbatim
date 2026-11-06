import "@verbatim/app-kit/style.css";
import { encodeFunctionData, parseUnits, type Address } from "viem";
import { ERC20, d, el, nav, prepareCalls, sendAndReport, sentence, signingPanel, withSignatures, type Call } from "@verbatim/app-kit";
import { RenderError } from "@verbatim/displayvm-ts";

const app = document.getElementById("app")!;
const tokens: Record<string, { address: Address; decimals: number }> = { dUSDC: { address: d.tokens.dUSDC, decimals: 6 }, dWETH: { address: d.tokens.dWETH, decimals: 18 } };

const kind = el("select", {}, el("option", { value: "transfer" }, "Send tokens"), el("option", { value: "approve" }, "Approve a spender")) as HTMLSelectElement;
const token = el("select", {}, ...Object.keys(tokens).map((t) => el("option", { value: t }, t))) as HTMLSelectElement;
const to = el("input", { placeholder: "0x address", value: d.owners[2] }) as HTMLInputElement;
const amount = el("input", { value: "1" }) as HTMLInputElement;
const flow = el("div");
const balances = el("div", { class: "mono" });

async function refreshBalances() {
  const { client } = await import("@verbatim/app-kit");
  const rows = await Promise.all(Object.entries(tokens).map(async ([n, t]) => {
    const b = await client.readContract({ address: t.address, abi: ERC20, functionName: "balanceOf", args: [d.account] });
    return `${n}: ${(Number(b) / 10 ** t.decimals).toLocaleString()}`;
  }));
  balances.textContent = rows.join("   ");
}

async function compose() {
  flow.replaceChildren(el("div", { class: "line" }, "Rendering..."));
  try {
    const t = tokens[token.value];
    const raw = parseUnits(amount.value, t.decimals);
    const fn = kind.value as "transfer" | "approve";
    const call: Call = { target: t.address, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: fn, args: [to.value as Address, raw] }) };
    const p = await prepareCalls([call]);
    const result = el("div");
    flow.replaceChildren(
      el("div", { class: "panel" }, el("h2", {}, "The sentence"), sentence(p.tree)),
      signingPanel({ tree: p.tree, txCommit: p.txCommit }, d.threshold, async (sigs) => {
        await sendAndReport(withSignatures(p.tx, p.digest, sigs), d.account, result);
        refreshBalances();
      }),
      el("div", { class: "panel" }, el("h2", {}, "Result"), result),
    );
  } catch (e) {
    flow.replaceChildren(el("div", { class: "bad" }, e instanceof RenderError ? `Refused to render: ${e.code}` : (e as Error).message));
  }
}

app.append(
  el("h1", {}, "Verbatim Wallet"),
  el("div", { class: "sub" }, `2-of-3 account ${d.account} on the frames devnet`),
  nav("Wallet"),
  el("div", { class: "grid", style: "margin-top:16px" },
    el("div", {},
      el("div", { class: "panel" },
        el("h2", {}, "Compose"),
        balances,
        el("label", {}, "Action"), kind,
        el("label", {}, "Token"), token,
        el("label", {}, "To or spender"), to,
        el("label", {}, "Amount"), amount,
        el("div", { class: "row" }, el("button", { class: "primary", onclick: compose }, "Render the sentence")),
      ),
    ),
    flow,
  ),
);
refreshBalances();

// WalletConnect, on the production leg. Needs VITE_WALLET_CONNECT_PROJECT_ID and VITE_BUNDLER_URL.
const wcEnv = (import.meta as any).env ?? {};
if (wcEnv.VITE_WALLET_CONNECT_PROJECT_ID) {
  const uriBox = el("input", { placeholder: "wc: pairing link from the dapp" }) as HTMLInputElement;
  const wcLog = el("div", { class: "mono" });
  const wcFlow = el("div");
  const log = (l: string) => wcLog.append(el("div", {}, l));
  const start = async () => {
    const [{ startWallet }, sepolia, snapshot] = await Promise.all([import("./walletconnect"), import("../../../../contracts/deployments/sepolia.json"), import("../../../../contracts/deployments/snapshot-sepolia.json")]);
    return startWallet({
      projectId: wcEnv.VITE_WALLET_CONNECT_PROJECT_ID,
      rpc: wcEnv.VITE_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
      bundler: wcEnv.VITE_BUNDLER_URL,
      account: sepolia.default.account as Address,
      snapshot: snapshot.default as never,
      permit2: sepolia.default.uniswap.permit2 as Address,
      weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      log,
      sign: (p) => new Promise((resolve) => {
        wcFlow.replaceChildren(el("div", { class: "panel" }, el("h2", {}, "The dapp asks for this"), sentence(p.tree)), signingPanel({ tree: p.tree, txCommit: p.hash }, 2, (sigs) => {
          wcFlow.replaceChildren();
          resolve(sigs as never);
        }));
      }),
    });
  };
  let wallet: Awaited<ReturnType<typeof start>> | null = null;
  app.append(el("div", { class: "panel", id: "walletconnect" }, el("h2", {}, "WalletConnect (Sepolia)"), uriBox, el("div", { class: "row" }, el("button", { onclick: async () => {
    wallet ??= await start();
    await wallet.pair(uriBox.value.trim());
    log("pairing");
  } }, "Connect")), wcLog, wcFlow));
}
