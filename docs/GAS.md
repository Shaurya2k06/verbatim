# Gas

Measured, not estimated. `tools/gas-report` re-reads every number below from `frameReceipts` on the live chain.
Regenerate with `pnpm --filter @verbatim/gas-report report`.

## Leg A: EF frames devnet (chain 1337)

Each frame's execution gas, from its receipt. "Prefix" adds frame 0, frame 1 and the 5,600 gas of two protocol-validated
signatures, which is the sum the mempool's cap applies to (declared limits, in practice: 20,500 + 73,700 + 5,600 = 99,800).

| Proof | What | Frame 0 | Frame 1 | Prefix | Frame 2 exec | Frame 2 state | Tx |
|---|---|---:|---:|---:|---:|---:|---|
| HONEST | Honest 3-frame transfer | 18,264 | 56,650 | 80,514 | 140,741 | 293,760 | `0x41bf1e2ec4...` |
| SWAP | Honest v4 swap through the real Universal Router | 18,860 | 62,725 | 87,185 | 358,960 | 97,920 | `0x6aaba4c1fd...` |
| WRAP | WRAP_ETH through the real Universal Router | 18,420 | 47,779 | 71,799 | 264,408 | 97,920 | `0x9f48386b43...` |
| A6 | EvilVault hidden WETH pull | 18,248 | 51,962 | 75,810 | 230,237 | 0 | `0x1884f7b0ef...` |
| A7 | Stale pre-signed transaction past validUntil | 18,264 | 56,650 | 80,514 | 55,930 | 0 | `0xf938324fe9...` |
| A11 | Reentrancy into executeVerified | 18,467 | 49,258 | 73,325 | 124,419 | 0 | `0x7cc61d7e4a...` |
| A12 | Gas griefing: a call burns all its gas | 18,186 | 41,270 | 65,056 | 975,879 | 0 | `0xfdfc492f75...` |
| F7 | Fee failure runs nothing | 18,264 | 56,638 | 80,502 | 12,750 | 0 | `0xaafbfccd52...` |

**Against the spec's targets (§14):**

| Component | Target | Measured | |
|---|---|---:|---|
| Frame 0 (layout lock, signature checks) | 20-30k | 18,264 | within |
| Frame 1, transfer sentence | 60-120k | 56,650 | within |
| Frame 1, v4 swap (F6) | at most 300k for the render | 62,725 for all of frame 1 | far under |
| Frame 1 total | at most 600k | 62,725 at most | far under |

**Why these are so far below the targets:** the deployed sidecar caps the whole prefix at 100,000 (see `DECISIONS.md`, D-A2), so render was
written to fit. Frame reads are batched into one STATICCALL, buffers are unchecked over a bounds-checked cursor, and a token or
descriptor costs one SLOAD.

**The limit that remains:** one call per transaction on the deployed sidecar. Measured by simulation, frame 1 for N transfers is
62,213 (1), 83,778 (2), 105,330 (3), 148,466 (5): about 21,500 per extra call, so a second call overflows the cap. ERC-8421's 1M staked
budget would hold over 40 calls, against the renderer's own limit of 16.

**Frame 2 grows with the account's history.** The assertion snapshot reads every approval-ledger entry and tracked token, so the same transfer measured 127,909 on a fresh account and more once the demo's approvals exist. The ledger is capped at 64 entries, and `pruneLedger` removes dead ones.

**State gas:** this devnet charges EIP-8037 state gas, about 1,530 per byte of new state. It is why frame 2 declares
1,500,000 of it, why a first approval costs much more than a later one (ledger entries are new slots), and why deploying the
paymaster took about 34M gas.

## Every demo transaction against the 100k cap

Measured by `tools/scripts/measure.ts` with generous limits, so each figure is what the frame used. The checklist's floor is 8,000 of headroom.

| Transaction | Frame 0 | Frame 1 | Signatures | Prefix | Headroom |
|---|---:|---:|---:|---:|---:|
| transfer | 18,264 | 56,650 | 5,600 | 80,514 | 19,486 |
| approve | 18,279 | 61,233 | 5,600 | 85,112 | 14,888 |
| permit2.approve | 18,310 | 67,558 | 5,600 | 91,468 | 8,532 |
| v4 swap | 18,860 | 62,725 | 5,600 | 87,185 | 12,815 |

Multi-hop swaps are not supported. `V3_SWAP_EXACT_IN` renders, but the devnet's router has no v3 factory, so it cannot run there. v4 `SWAP_EXACT_IN` and `PERMIT2_TRANSFER_FROM` render as `BLIND` and are refused, which is proof A17. Adding them is future work and each must keep this floor.

## Patched bytecode

Each holds exactly one LOG1 before patching, checked in CI by `tools/scripts/check-bytecode.ts`. Hashes of the artifacts' patched runtimes; deployed code differs where immutables are filled in.

```
ok   VerbatimAccount: LOG1 1, DELEGATECALL 0, patched runtime 0x25ace8c23ea3852d210a0585e920f4c60d1747bc8a4d685402e71211aa8bcbfc
ok   RendererPaymaster: LOG1 1, DELEGATECALL 1, patched runtime 0xe72159bf7cb2c7b11caedef04ca46995d6f134e2a595319e0ba36ce6364fc206
```

## Leg B: Sepolia (ERC-4337, EntryPoint v0.7)

`actualGasUsed` from the bundler's receipt, covering account validation, paymaster render, the batch and overhead.

| What | Bundler | actualGasUsed | Tx |
|---|---|---:|---|
| Honest transfer on Sepolia via Pimlico, recipient shown by ENS name | pimlico | 1,107,411 | [tx](https://sepolia.etherscan.io/tx/0x49256aa47f5000f839301ffa7a6add588725f345e6d6d7142c32d7c4db54d2da) |
| Honest transfer on Sepolia via Alchemy | alchemy | 1,107,411 | [tx](https://sepolia.etherscan.io/tx/0xc30b42437771a2fb31532bf43515faed1033c9f9bf9a2130b98572491d26c52c) |
| v4 swap through Uniswap's official Sepolia Universal Router and PoolManager | pimlico | 1,172,189 | [tx](https://sepolia.etherscan.io/tx/0x9723873a218547940dd2992d71b3e09364406ae8fffb77ab1bff3253a713b035) |

**Read that column with care.** `actualGasUsed` is what the EntryPoint bills: it includes `preVerificationGas` and the 10% penalty on unused call gas, and our limits are deliberately generous. The bundle transactions themselves used far less, read from their receipts: 395,343 (B-honest-pimlico), 395,307 (B-honest-alchemy), 473,485 (B-swap).

Bundler limits met (F8): Alchemy requires at least 40% of the verification limits to be used, which rejected a generous first plan
(33%). The plan in `tools/scripts/lib/userop.ts` passes both Alchemy and Pimlico.
