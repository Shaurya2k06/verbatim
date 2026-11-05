// What the demo apps share: chain access, the signing hand-off, and showing what happened.
import QRCode from "qrcode";
import { createPublicClient, decodeErrorResult, encodeFunctionData, hashTypedData, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ChainTrust, PAYMASTER_ABI, PUBLIC_GATEWAY_GAS, prepare, txCommit, typedData, withSignatures, type Call, type OwnerSig, type Prepared } from "@verbatim/client";
import { RpcError, submit, waitReceipt, type FrameReceipt, type FrameTx } from "@verbatim/frames-sdk";
import { decodeTree, formatForDevice } from "@verbatim/displayvm-ts";
import { decodeResponse, encodeRequest, review, toFrames, typedData as deviceTypedData } from "@verbatim/signer";
import deployment from "../../../deployments/devnet.json";

export { deployment };
export const d = deployment as any;

const chain = { id: d.chainId, name: "frames-devnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [d.node] } } } as const;
export const client = createPublicClient({ chain, transport: http(d.node) });
export const trust = () => new ChainTrust(client as never, d.paymaster);

export const ERC20 = parseAbi(["function transfer(address,uint256)", "function approve(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
export const ZERO: Address = "0x0000000000000000000000000000000000000000";
export const FEE_RATE = 1100n;
const gasTotal = PUBLIC_GATEWAY_GAS.frame0 + PUBLIC_GATEWAY_GAS.frame1 + PUBLIC_GATEWAY_GAS.frame2 + PUBLIC_GATEWAY_GAS.frame2State;
export const DEFAULT_FEE = { asset: ZERO, amount: gasTotal * FEE_RATE };

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v as string;
    else (e as any)[k] = v;
  }
  e.append(...kids);
  return e;
};

export function sentence(tree: Hex): HTMLElement {
  const box = el("div");
  for (const l of formatForDevice(decodeTree(tree))) box.append(el("div", { class: l.risk ? "risk" : "line", style: `margin-left:${l.indent * 14}px` }, l.text));
  return box;
}

const ERRORS = parseAbi([
  "error TreeMismatch(bytes32 expected, bytes32 actual)",
  "error SpecHashMismatch(bytes32 expected, bytes32 actual)",
  "error PolicyRefused(uint256 risk)",
  "error InsufficientDeposit(uint256 available, uint256 needed)",
  "error FeeTooLow(uint256 min, uint256 amount)",
  "error FeeAssetNotAllowed(address asset)",
  "error NotCanonicalSender(bytes32 codehash)",
  "error BadLayout(uint256 check)",
  "error BadSignatureEntry()",
  "error SignersNotSortedOrUnknown()",
  "error FrameReadFailed()",
  "error AssertionFailed(uint256 index, uint256 expected, uint256 actual)",
  "error Expired(uint256 blockNumber, uint256 lastValid)",
  "error CallFailed(uint256 index, bytes reason)",
  "error CodeChanged(address target)",
  "error CodeAppeared(address target)",
]);

const EXPLAIN: Record<string, string> = {
  TreeMismatch: "The calldata does not render to the sentence you signed.",
  SpecHashMismatch: "The assertions do not match the sentence you signed.",
  PolicyRefused: "The sentence is true, and your policy refuses it.",
  InsufficientDeposit: "The fee deposit cannot cover this.",
  BadLayout: "The transaction is not the required three-frame shape.",
  BadSignatureEntry: "The signatures do not cover this transaction.",
  FrameReadFailed: "The transaction is not the required three-frame shape.",
  AssertionFailed: "The contract did something the sentence did not say. Everything was undone.",
  Expired: "The signature is past its validity window.",
  CallFailed: "A call in the batch reverted. Everything was undone.",
  CodeAppeared: "An address claimed to hold no code does.",
  CodeChanged: "A contract's code changed after signing.",
};

export function explainRevert(text: string): { name?: string; human: string; raw: string } {
  const m = text.match(/0x[0-9a-fA-F]{8,}/);
  if (m) {
    try {
      const e = decodeErrorResult({ abi: ERRORS, data: m[0] as Hex });
      const args = (e.args ?? []).map((a: unknown) => (typeof a === "bigint" ? `0x${a.toString(16)}` : String(a))).join(", ");
      return { name: e.errorName, human: EXPLAIN[e.errorName] ?? e.errorName, raw: `${e.errorName}(${args})` };
    } catch {
      /* not one of ours */
    }
  }
  return { human: text, raw: text };
}

export function batchOutcome(r: FrameReceipt, account: Address): { ok: boolean | null; err: string } {
  for (const f of r.frameReceipts ?? []) {
    for (const l of f.logs ?? []) {
      if (l.address?.toLowerCase() === account.toLowerCase() && l.topics?.length === 2) {
        const ok = BigInt(l.topics[1]) === 1n;
        const hex = l.data as string;
        const len = hex.length > 130 ? parseInt(hex.slice(66, 130), 16) : 0;
        return { ok, err: len ? `0x${hex.slice(130, 130 + len * 2)}` : "" };
      }
    }
  }
  return { ok: null, err: "" };
}

/** Owners' signing hand-off: a QR for the offline device, and locally held demo keys for the laptop owner. */
export function signingPanel(p: { tree: Hex; specHash: Hex; txCommit: Hex }, needed: number, onReady: (sigs: OwnerSig[]) => void): HTMLElement {
  const sigs = new Map<string, OwnerSig>();
  const status = el("div", { class: "line" }, `0 of ${needed} signatures`);
  const add = (s: OwnerSig) => {
    sigs.set(s.signer.toLowerCase(), s);
    status.textContent = `${sigs.size} of ${needed} signatures`;
    if (sigs.size >= needed) onReady([...sigs.values()].slice(0, needed));
  };
  const req = encodeRequest(p);
  const frames = toFrames(req);
  const canvas = el("canvas");
  let i = 0;
  const draw = () => QRCode.toCanvas(canvas, frames[i++ % frames.length], { errorCorrectionLevel: "L", margin: 2, width: 300 });
  draw();
  if (frames.length > 1) setInterval(draw, 700);

  const reqBox = el("textarea", { readOnly: true, value: req });
  const paste = el("textarea", { placeholder: "Paste the signature the device shows (VSG1:...)" }) as HTMLTextAreaElement;
  const keyInput = el("input", { placeholder: "0x owner key held by this laptop (kept in this tab only)", type: "password" }) as HTMLInputElement;
  const err = el("div");
  try {
    keyInput.value = sessionStorage.getItem("verbatim-owner-key") ?? "";
  } catch {
    /* storage blocked */
  }
  return el("div", { class: "panel" },
    el("h2", {}, "Sign on the offline device"),
    canvas,
    reqBox,
    el("div", { class: "row" }, el("button", { onclick: () => navigator.clipboard?.writeText(req) }, "Copy request")),
    el("label", {}, "Device's signature"),
    paste,
    el("div", { class: "row" }, el("button", { onclick: () => {
      try {
        const r = decodeResponse(paste.value);
        add({ signer: r.signer, sig: r.sig });
        paste.value = "";
        err.replaceChildren();
      } catch (e) {
        err.replaceChildren(el("div", { class: "bad" }, (e as Error).message));
      }
    } }, "Add signature")),
    el("label", {}, "Laptop owner"),
    keyInput,
    el("div", { class: "row" }, el("button", { onclick: async () => {
      try {
        const a = privateKeyToAccount(keyInput.value.trim() as Hex);
        try {
          sessionStorage.setItem("verbatim-owner-key", keyInput.value.trim());
        } catch {
          /* storage blocked */
        }
        const rv = review(p);
        const sig = await a.signTypedData(deviceTypedData(rv.decoded, p, rv.treeHash) as never);
        add({ signer: a.address, sig });
        err.replaceChildren();
      } catch (e) {
        err.replaceChildren(el("div", { class: "bad" }, (e as Error).message));
      }
    } }, "Sign with this key")),
    status,
    err,
  );
}

export function digestFor(p: { tree: Hex; specHash: Hex; txCommit: Hex }): Hex {
  return review(p).digest;
}

/** Sends to the real alt mempool, reporting rejection or the mined outcome into `box`. */
export async function sendAndReport(tx: FrameTx, account: Address, box: HTMLElement): Promise<void> {
  box.replaceChildren(el("div", { class: "line" }, "Submitting to the alt mempool..."));
  let hash: Hex;
  try {
    hash = await submit(tx);
  } catch (e) {
    const x = explainRevert((e as RpcError).message);
    box.replaceChildren(el("div", { class: "bad" }, `Rejected by the mempool. ${x.human}`), el("div", { class: "mono" }, x.raw));
    return;
  }
  box.replaceChildren(el("div", { class: "ok" }, "Admitted by the mempool. Waiting for a block..."), el("div", { class: "mono" }, hash));
  const r = await waitReceipt(hash);
  const out = batchOutcome(r, account);
  const link = el("a", { href: `${d.explorer}tx/${hash}`, target: "_blank" }, "Open in the explorer");
  const frames = (r.frameReceipts ?? []).map((f, i) => `frame ${i}: ${f.status === "0x1" ? "ok" : "failed"}`).join(", ");
  if (out.ok) {
    box.replaceChildren(el("div", { class: "ok" }, `Landed in block ${Number(r.blockNumber)}. The sentence happened.`), el("div", { class: "mono" }, hash), el("div", { class: "mono" }, frames), link);
  } else {
    const x = explainRevert(out.err);
    box.replaceChildren(el("div", { class: "bad" }, `Mined in block ${Number(r.blockNumber)}, batch reverted. ${x.human}`), el("div", { class: "mono" }, x.raw), el("div", { class: "mono" }, hash), el("div", { class: "mono" }, frames), link);
  }
}

export const prepareCalls = (calls: Call[], extra: Partial<Parameters<typeof prepare>[0]> = {}) =>
  prepare({ client: client as never, trust: trust(), account: d.account, paymaster: d.paymaster, calls, fee: DEFAULT_FEE, ...extra });

export { PAYMASTER_ABI, encodeFunctionData, hashTypedData, typedData, txCommit, withSignatures };
export type { Call, OwnerSig, Prepared };

export function nav(current: string): HTMLElement {
  const links = [["Wallet", "http://localhost:5174"], ["Swap demo", "http://localhost:5175"], ["Attack us", "http://localhost:5176"], ["Signer", "http://localhost:5173"]];
  return el("nav", {}, ...links.filter(([n]) => n !== current).map(([n, h]) => el("a", { href: h }, n)));
}
