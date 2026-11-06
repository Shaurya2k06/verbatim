# Gas

Measured, not estimated. `contracts/scripts/gas-report` re-reads every number below from `frameReceipts` on the live chain.
Regenerate with `pnpm --filter @verbatim/gas-report report`.

## Leg A: EF frames devnet (chain 1337)

Each frame's execution gas, from its receipt. "Prefix" adds the validation frames and the 5,600 gas of two protocol-validated
signatures. The mempool's cap applies to the declared limits plus signatures. Rows come from the latest run of each proof: `contracts/docs/STATUS.md` says which predate the final build.

| Proof | What | Validation frames | Prefix | Execute exec | Execute state | Tx |
|---|---|---:|---:|---:|---:|---|
| HONEST | Honest 4-frame transfer | 3,051 + 16,112 + 60,482 | 85,245 | 160,115 | 391,680 | `0x9455794616...` |
| SWAP | Honest v4 swap through the real Universal Router | 18,860 + 62,725 | 87,185 | 358,960 | 97,920 | `0x6aaba4c1fd...` |
| WRAP | WRAP_ETH through the real Universal Router | 18,420 + 47,779 | 71,799 | 264,408 | 97,920 | `0x9f48386b43...` |
| A11 | Reentrancy into executeVerified | 3,051 + 16,248 + 51,922 | 76,821 | 102,171 | 97,920 | `0x55077d80b6...` |
| A12 | Gas griefing: a call burns all its gas | 3,051 + 16,051 + 45,113 | 69,815 | 975,903 | 97,920 | `0x34a28447d3...` |
| F7 | Fee failure runs nothing | 3,051 + 16,112 + 60,470 | 85,233 | 20,932 | 0 | `0xfac98fb726...` |

**Why the prefix is tight:** the deployed sidecar caps it at 100,000 (`FINDINGS.md`, b), so render was written to fit. See `DECISIONS.md`, D-A20.

**The limit that remains:** one call per transaction on the deployed sidecar. Each extra call adds about 21,500 to the account's work, so a second call overflows the cap. ERC-8421's 1M staked budget would hold them, up to the renderer's own limit.

**State gas:** this devnet charges EIP-8037 state gas, about 1,530 per byte of new state. It is why frame 2 declares
1,500,000 of it, why a first approval costs much more than a later one (ledger entries are new slots), and why deploying the
paymaster took about 34M gas.

## Every demo transaction against the 100k cap

Measured by `contracts/scripts/live/measure.ts` with generous limits, so each figure is what the frame used. The checklist's floor is 8,000 of headroom.

| Transaction | Expiry | Account | Paymaster | Signatures | Prefix | Headroom |
|---|---:|---:|---:|---:|---:|---:|
| transfer | 3,051 | 16,112 | 60,482 | 5,600 | 85,245 | 14,755 |
| approve | 3,051 | 16,121 | 64,032 | 5,600 | 88,804 | 11,196 |
| permit2.approve | 3,051 | 16,146 | 69,058 | 5,600 | 93,855 | 6,145 |
| v4 swap (ETH in) | 3,051 | 16,546 | 65,439 | 5,600 | 90,636 | 9,364 |

v4 `SWAP_EXACT_IN` renders in both renderers and is tested, but has not been measured on a live chain. `V3_SWAP_EXACT_IN` renders, but the devnet's router has no v3 factory, so it cannot run there. An unknown command or action renders as `BLIND` and is refused.

## Patched bytecode

Each holds exactly one LOG1 before patching, checked in CI by `contracts/scripts/live/check-bytecode.ts`. Hashes of the artifacts' patched runtimes; deployed code differs where immutables are filled in.

```
ok   VerbatimAccount: LOG1 1, DELEGATECALL 0, patched runtime 0xa7d43ff3f8dec81efb1487f96934998099f20553131ecf397943315da566bd58
ok   RendererPaymaster: LOG1 1, DELEGATECALL 1, patched runtime 0x22c8c6d900c7d338df8c959cc50a2ea34d11ce646a9311704ca543de82ed5518
```

## Leg B: Sepolia (ERC-4337, EntryPoint v0.7)

`actualGasUsed` from the bundler's receipt, covering account validation with its render, the batch and overhead. There is no paymaster on this path.

| What | Bundler | actualGasUsed | Tx |
|---|---|---:|---|
| Honest transfer on Sepolia via Pimlico, recipient shown by ENS name | pimlico | 1,532,214 | [tx](https://sepolia.etherscan.io/tx/0xd5bef0e32ce8ee7239bac08ae676329dae13b1a1b33de0eedf1429705e2e1bae) |
| Honest transfer on Sepolia via Alchemy | alchemy | 1,521,133 | [tx](https://sepolia.etherscan.io/tx/0x540608c614d999cfb63fd496e405454928dcc6b889bcf1f029d6bc929a3694f9) |
| v4 swap through Uniswap's official Sepolia Universal Router and PoolManager | pimlico | 1,267,022 | [tx](https://sepolia.etherscan.io/tx/0x57c7b706e64d9f8a4445b5e42a78bc9682b43f5c47f25f5639600d0ef5c7b47c) |

**Read that column with care.** `actualGasUsed` is what the EntryPoint bills: it includes `preVerificationGas` and the 10% penalty on unused call gas, and our limits are deliberately generous. The bundle transactions themselves used far less, read from their receipts: 1,030,506 (B-honest-pimlico), 1,019,425 (B-honest-alchemy), 736,653 (B-swap).

Bundler limits met (F8): Alchemy requires at least 40% of the verification limits to be used, which rejected a generous first plan
(33%). The plan in `contracts/scripts/live/lib/userop.ts` passes both Alchemy and Pimlico.
