# Gas

Measured, not estimated. `contracts/scripts/gas-report` re-reads every number below from `frameReceipts` on the live chain.
Regenerate with `pnpm --filter @verbatim/gas-report report`.

## Leg A: EF frames devnet (chain 1337)

Each frame's execution gas, from its receipt. "Prefix" adds the validation frames and the 5,600 gas of two protocol-validated
signatures. The mempool's cap applies to the declared limits plus signatures. Rows come from the latest run of each proof: `contracts/docs/STATUS.md` says which predate the final build.

| Proof | What | Validation frames | Prefix | Execute exec | Execute state | Tx |
|---|---|---:|---:|---:|---:|---|
| HONEST | Honest 4-frame transfer | 3,051 + 16,285 + 60,493 | 85,429 | 160,872 | 391,680 | `0xc55c00f744...` |
| SWAP | Honest v4 swap through the real Universal Router | 3,051 + 16,719 + 65,218 | 90,588 | 240,545 | 97,920 | `0xcad426d4e5...` |
| WRAP | WRAP_ETH through the real Universal Router | 3,051 + 16,409 + 53,824 | 78,884 | 181,124 | 97,920 | `0x25c7c73f13...` |
| A6 | EvilVault keeps the ETH and credits no shares | 3,051 + 16,298 + 54,220 | 79,169 | 136,429 | 97,920 | `0x4221e7bcda...` |
| A11 | Reentrancy into executeVerified | 3,051 + 16,421 + 51,934 | 77,006 | 102,977 | 97,920 | `0xd7ee13c361...` |
| A12 | Gas griefing: a call burns all its gas | 3,051 + 16,224 + 45,124 | 69,999 | 975,917 | 97,920 | `0x3869207265...` |
| F7 | Fee failure runs nothing | 3,051 + 16,285 + 60,481 | 85,417 | 21,252 | 0 | `0x4c4af86d71...` |

### Stateless path

Simulated with room to spare, so these are what each transaction needs. The declared limits stay under the 100,000 cap: expiry 3,500, account 85,300, four signatures 11,200.

| Transaction | Expiry | Account | Signatures | Prefix | Proof bytes |
|---|---:|---:|---:|---:|---:|
| transfer | 3,051 | 76,234 | 11,200 | 90,485 | 732 |
| approve (Permit2) | 3,051 | 83,926 | 11,200 | 98,177 | 1,005 |
| v4 swap (ETH in) | 3,051 | 82,291 | 11,200 | 96,542 | 591 |
| WRAP_ETH | 3,051 | 70,245 | 11,200 | 84,496 | 264 |

The G2 target was a prefix of at most 90k. A transfer misses it by 485 gas, and a swap needs 96,542. All of them fit the cap.


**Why the prefix is tight:** the deployed sidecar caps it at 100,000 (`FINDINGS.md`, b), so render was written to fit. See `DECISIONS.md`, D-A20.

**The limit that remains:** one call per transaction on the deployed sidecar. Each extra call adds about 21,500 to the account's work, so a second call overflows the cap. ERC-8421's 1M staked budget would hold them, up to the renderer's own limit.

**State gas:** this devnet charges EIP-8037 state gas, about 1,530 per byte of new state. It is why frame 2 declares
1,500,000 of it, why a first approval costs much more than a later one (ledger entries are new slots), and why deploying the
paymaster took about 34M gas.

## Every demo transaction against the 100k cap

Measured by `contracts/scripts/live/measure.ts` with generous limits, so each figure is what the frame used. The checklist's floor is 8,000 of headroom.

| Transaction | Expiry | Account | Paymaster | Signatures | Prefix | Headroom |
|---|---:|---:|---:|---:|---:|---:|
| transfer | 3,051 | 16,285 | 60,493 | 5,600 | 85,429 | 14,571 |
| approve | 3,051 | 16,294 | 64,043 | 5,600 | 88,988 | 11,012 |
| permit2.approve | 3,051 | 16,319 | 69,069 | 5,600 | 94,039 | 5,961 |
| v4 swap (ETH in) | 3,051 | 16,719 | 65,218 | 5,600 | 90,588 | 9,412 |

v4 `SWAP_EXACT_IN` is measured on Sepolia: two hops landed through the account in 929,953 transaction gas (`B-multihop`). `V3_SWAP_EXACT_IN` renders, but the devnet's router has no v3 factory, so it cannot run there. An unknown command or action renders as `BLIND` and is refused.

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
