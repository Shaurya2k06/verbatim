import "@verbatim/app-kit/style.css";
import { encodeFunctionData, parseAbi, parseEther, type Address, type Hex } from "viem";
import { ERC20, client, d, el, nav, prepareCalls, sendAndReport, sentence, signingPanel, txCommit, typedData, withSignatures, hashTypedData, type Prepared } from "@verbatim/app-kit";
import { frame2Data } from "@verbatim/client";
import { Scope, newTx, type FrameTx } from "@verbatim/frames-sdk";
import { CMD, executeData, v4ExactInSingleInput, v4SwapCall } from "@verbatim/urrender";

const app = document.getElementById("app")!;
const usdc: Address = d.tokens.dUSDC;
const dWETH: Address = d.tokens.dWETH;
const bob: Address = d.owners[2];
const thief: Address = "0x000000000000000000000000000000000000bad1";
const transfer = (to: Address, n = 1_000_000n) => ({ target: usdc, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, n] }) });
const zeroForOne = d.pools.honest.key.currency0.toLowerCase() === dWETH.toLowerCase();
const swap = (key: unknown, min: bigint) => ({ target: d.uniswap.router as Address, value: 0n, data: v4SwapCall({ key: key as never, zeroForOne, amountIn: parseEther("1"), amountOutMinimum: min }, BigInt(Math.floor(Date.now() / 1000) + 3600)) });

interface Attack {
  name: string;
  claim: string;
  expected: string;
  /** What goes to the device and, after signing, what goes to the mempool. */
  build(): Promise<{ device: Prepared; finish: (sigs: { signer: Address; sig: Hex }[]) => FrameTx; holdUntil?: bigint }>;
}

const sends = (p: Prepared) => ({ device: p, finish: (s: { signer: Address; sig: Hex }[]) => withSignatures(p.tx, p.digest, s) });

const attacks: Attack[] = [
  {
    name: "Swap the recipient",
    claim: `Send 1 dUSDC to ${bob}`,
    expected: "Mempool rejects: tree mismatch",
    async build() {
      const shown = await prepareCalls([transfer(bob)]);
      const lie = await prepareCalls([transfer(thief)], { validUntil: shown.validUntil, overrideSentence: { tree: shown.tree, spec: shown.spec } });
      return sends(lie);
    },
  },
  {
    name: "minOut = 0 through SkimHook",
    claim: "Swap 1 dWETH for at least 2000 dUSDC",
    expected: "Mempool rejects: tree mismatch",
    async build() {
      const shown = await prepareCalls([swap(d.pools.honest.key, 2_000_000_000n)]);
      const lie = await prepareCalls([swap(d.pools.evil.key, 0n)], { validUntil: shown.validUntil, overrideSentence: { tree: shown.tree, spec: shown.spec } });
      return sends(lie);
    },
  },
  {
    name: "Same route, and the device tells the truth",
    claim: "Swap 1 dWETH (the page says it is fine)",
    expected: "Device shows the risks; if signed anyway, policy refuses",
    async build() {
      return sends(await prepareCalls([swap(d.pools.evil.key, 0n)]));
    },
  },
  {
    name: "Drop the renderer frame",
    claim: `Send 1 dUSDC to ${bob}`,
    expected: "Frame 0 rejects: wrong layout",
    async build() {
      const p = await prepareCalls([transfer(bob)]);
      return {
        device: p,
        finish(s) {
          const signed = withSignatures(p.tx, p.digest, s);
          const f = p.tx.frames;
          const tx = newTx({ chainId: p.tx.chainId, sender: p.tx.sender, nonce: p.tx.nonceSeq, maxFeePerGas: p.tx.fees.maxFeePerGas, maxPriorityFeePerGas: p.tx.fees.maxPriorityFeePerGas, signatures: signed.signatures, frames: [{ ...f[0], flags: Scope.EXECUTION_AND_PAYMENT }, f[2]] });
          return tx;
        },
      };
    },
  },
  {
    name: "Swap the spec for a weaker one",
    claim: `Send 1 dUSDC to ${bob}`,
    expected: "Frame 1 rejects: spec mismatch",
    async build() {
      const p = await prepareCalls([transfer(bob)]);
      const weak = "0x565300010000" as Hex;
      const f2 = { ...p.tx.frames[2], data: frame2Data(p.fee, p.calls, weak) };
      const tx = { ...p.tx, frames: [p.tx.frames[0], p.tx.frames[1], f2] };
      const c = txCommit(tx);
      const typed = typedData(p.chainId, p.account, c, p.treeHash, p.specHash, p.validUntil);
      const device = { ...p, tx, txCommit: c, digest: hashTypedData(typed), digestTypedData: typed };
      return sends(device);
    },
  },
  {
    name: "Poison a descriptor",
    claim: "Claim Rewards (descriptor supplied by this page)",
    expected: "Rendered blind and unverified; policy refuses",
    async build() {
      return sends(await prepareCalls([{ target: d.reenterer, value: 0n, data: "0xdeadbeef" }]));
    },
  },
  {
    name: "The contract tells the truth, then does more",
    claim: "Deposit 5 dUSDC into Accurate Vault",
    expected: "The sentence is accurate, so it is admitted. Execution pulls dWETH too: AssertionFailed, everything undone, fee kept.",
    async build() {
      return sends(await prepareCalls([{ target: d.evilVault, value: 0n, data: encodeFunctionData({ abi: parseAbi(["function deposit(uint256)"]), functionName: "deposit", args: [5_000_000n] }) }]));
    },
  },
  {
    name: "Replay a stale signature",
    claim: `Send 1 dUSDC to ${bob}, with a signature this page holds until it expires`,
    expected: "Admitted, then the batch reverts: Expired. The fee is kept.",
    async build() {
      const now = (await client.getBlock()).timestamp;
      const validUntil = now + 40n;
      return { ...sends(await prepareCalls([transfer(bob)], { validUntil })), holdUntil: validUntil + 2n };
    },
  },
  {
    name: "A signature that never expires",
    claim: `Send 1 dUSDC to ${bob}`,
    expected: "The device refuses, by its own clock. Signed anyway, the policy cap reverts the batch.",
    async build() {
      const now = (await client.getBlock()).timestamp;
      return sends(await prepareCalls([transfer(bob)], { validUntil: now + 86_400n }));
    },
  },
  {
    name: "Router command that may silently fail",
    claim: "Swap 1 dWETH for at least 2000 dUSDC",
    expected: "The device shows COMMAND MAY PARTIALLY FAIL; policy refuses",
    async build() {
      const input = v4ExactInSingleInput({ key: d.pools.honest.key, zeroForOne, amountIn: parseEther("1"), amountOutMinimum: 2_000_000_000n });
      return sends(await prepareCalls([{ target: d.uniswap.router, value: 0n, data: executeData([CMD.V4_SWAP | CMD.FLAG_ALLOW_REVERT], [input], BigInt(Math.floor(Date.now() / 1000) + 600)) }]));
    },
  },
  {
    name: "Router command nobody can read",
    claim: "Swap with a gasless permit",
    expected: "Rendered BLIND; policy refuses",
    async build() {
      return sends(await prepareCalls([{ target: d.uniswap.router, value: 0n, data: executeData([0x0a], ["0x1234"], BigInt(Math.floor(Date.now() / 1000) + 600)) }]));
    },
  },
  {
    name: "Lookalike name",
    claim: "Send 1 dUSDC to vitalik.eth",
    expected: "The device shows the raw address, because the name is not attested. The frames devnet has no ENS at all; see Leg B.",
    async build() {
      return sends(await prepareCalls([transfer(thief)]));
    },
  },
];

const list = el("div", { class: "attacks" });
const stage = el("div");

async function select(a: Attack, btn: HTMLElement) {
  list.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  stage.replaceChildren(el("div", { class: "line" }, "Building the attack..."));
  const result = el("div");
  try {
    const { device, finish, holdUntil } = await a.build();
    stage.replaceChildren(
      el("div", { class: "panel" }, el("h2", {}, "This page claims"), el("div", { class: "claim" }, a.claim), el("h2", { style: "margin-top:14px" }, "The device shows"), sentence(device.tree), el("h2", { style: "margin-top:14px" }, "Expected"), el("div", { class: "line" }, a.expected)),
      signingPanel({ tree: device.tree, specHash: device.specHash, txCommit: device.txCommit }, d.threshold, async (sigs) => {
        if (holdUntil) {
          result.replaceChildren(el("div", { class: "line" }, "Holding the signature until it expires..."));
          while ((await client.getBlock()).timestamp <= holdUntil) await new Promise((r) => setTimeout(r, 2000));
        }
        await sendAndReport(finish(sigs as never), d.account, result);
      }),
      el("div", { class: "panel" }, el("h2", {}, "What the chain did"), result),
    );
  } catch (e) {
    stage.replaceChildren(el("div", { class: "bad" }, (e as Error).message));
  }
}

for (const a of attacks) {
  const b = el("button", { onclick: () => select(a, b) }, a.name);
  list.append(b);
}

app.append(
  el("h1", {}, "Attack us"),
  el("div", { class: "sub" }, "A hostile frontend. Pick a lie, sign whatever the offline device shows, and watch the chain."),
  nav("Attack us"),
  el("div", { class: "grid", style: "margin-top:16px;grid-template-columns:minmax(240px,320px) minmax(300px,1fr)" }, el("div", { class: "panel" }, el("h2", {}, "Attacks"), list), stage),
);
