import "@verbatim/app-kit/style.css";
import { parseEther, parseUnits, type Address } from "viem";
import { d, el, nav, prepareCalls, sendAndReport, sentence, signingPanel, withSignatures } from "@verbatim/app-kit";
import { v4SwapCall } from "@verbatim/urrender";

const app = document.getElementById("app")!;
const dWETH: Address = d.tokens.dWETH;
const honest = d.pools.honest.key;
const evil = d.pools.evil.key;
const zeroForOne = honest.currency0.toLowerCase() === dWETH.toLowerCase();
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 3600);

const amountIn = el("input", { value: "1" }) as HTMLInputElement;
const minOut = el("input", { value: "2000" }) as HTMLInputElement;
const mode = el("select", {},
  el("option", { value: "honest" }, "Honest frontend"),
  el("option", { value: "lie" }, "Evil frontend: shows the honest sentence, sends minOut=0 through SkimHook"),
  el("option", { value: "truth" }, "Evil route, and the device shows the truth"),
) as HTMLSelectElement;
const flow = el("div");

const call = (key: unknown, min: bigint) => ({ target: d.uniswap.router as Address, value: 0n, data: v4SwapCall({ key: key as never, zeroForOne, amountIn: parseEther(amountIn.value), amountOutMinimum: min }, deadline()) });

async function go() {
  flow.replaceChildren(el("div", { class: "line" }, "Rendering..."));
  const min = parseUnits(minOut.value, 6);
  const result = el("div");
  try {
    const shownCall = mode.value === "truth" ? call(evil, 0n) : call(honest, min);
    const shown = await prepareCalls([shownCall]);
    const p = mode.value === "lie" ? await prepareCalls([call(evil, 0n)], { signedAtBlock: shown.signedAtBlock, overrideSentence: { tree: shown.tree, spec: shown.spec } }) : shown;
    flow.replaceChildren(
      el("div", { class: "panel" }, el("h2", {}, "What the device will show"), sentence(p.tree)),
      signingPanel({ tree: p.tree, specHash: p.specHash, txCommit: p.txCommit }, d.threshold, (sigs) => sendAndReport(withSignatures(p.tx, p.digest, sigs), d.account, result)),
      el("div", { class: "panel" }, el("h2", {}, "Result"), result),
    );
  } catch (e) {
    flow.replaceChildren(el("div", { class: "bad" }, (e as Error).message));
  }
}

app.append(
  el("h1", {}, "Swap dWETH for dUSDC"),
  el("div", { class: "sub" }, "Real Uniswap v4 and Universal Router on the frames devnet. Pool price is about 3000."),
  nav("Swap demo"),
  el("div", { class: "grid", style: "margin-top:16px" },
    el("div", { class: "panel" },
      el("label", {}, "Frontend"), mode,
      el("label", {}, "You pay (dWETH)"), amountIn,
      el("label", {}, "At least (dUSDC)"), minOut,
      el("div", { class: "row" }, el("button", { class: "primary", onclick: go }, "Swap")),
    ),
    flow,
  ),
);
