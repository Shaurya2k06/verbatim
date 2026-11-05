# Gas

Measured, not estimated. `tools/gas-report` re-reads every number below from `frameReceipts` on the live chain.
Regenerate with `pnpm --filter @verbatim/gas-report report`.

## Leg A: EF frames devnet (chain 1337)

Each frame's execution gas, from its receipt. "Prefix" adds frame 0, frame 1 and the 5,600 gas of two protocol-validated
signatures, which is the sum the mempool's cap applies to (declared limits, in practice: 20,500 + 73,700 + 5,600 = 99,800).

| Proof | What | Frame 0 | Frame 1 | Prefix | Frame 2 exec | Frame 2 state | Tx |
|---|---|---:|---:|---:|---:|---:|---|
| HONEST | Honest 3-frame transfer | 19,376 | 62,213 | 87,189 | 127,909 | 195,840 | `0xeb721f063f...` |
| SWAP | Honest v4 swap through the real Universal Router | 19,972 | 68,249 | 93,821 | 344,729 | 97,920 | `0x2ec2833bb0...` |
| WRAP | WRAP_ETH through the real Universal Router | 19,532 | 53,298 | 78,430 | 251,313 | 97,920 | `0x318ea32167...` |
| A6 | EvilVault hidden WETH pull | 19,360 | 57,519 | 82,479 | 217,340 | 0 | `0xa8eca04145...` |
| A7 | Stale pre-signed transaction past TTL | 19,376 | 62,213 | 87,189 | 44,785 | 0 | `0xb9714def8b...` |
| A11 | Reentrancy into executeVerified | 19,579 | 54,869 | 80,048 | 111,715 | 0 | `0x61ff3c776d...` |
| A12 | Gas griefing: a call burns all its gas | 19,298 | 46,863 | 71,761 | 975,707 | 0 | `0xc0fd0fbcfc...` |
| F7 | Fee failure runs nothing | 19,376 | 62,133 | 87,109 | 12,524 | 0 | `0x48c13cd2a7...` |

**Against the spec's targets (§14):**

| Component | Target | Measured | |
|---|---|---:|---|
| Frame 0 (layout lock, signature checks) | 20-30k | 19,376 | within |
| Frame 1, transfer sentence | 60-120k | 62,213 | within |
| Frame 1, v4 swap (F6) | at most 300k for the render | 68,249 for all of frame 1 | far under |
| Frame 1 total | at most 600k | 68,249 at most | far under |

**Why these are so far below the targets:** the deployed sidecar caps the whole prefix at 100,000 (see `DECISIONS.md`, D-A2), so render was
written to fit. Frame reads are batched into one STATICCALL, buffers are unchecked over a bounds-checked cursor, and a token or
descriptor costs one SLOAD.

**The limit that remains:** one call per transaction on the deployed sidecar. Measured by simulation, frame 1 for N transfers is
62,213 (1), 83,778 (2), 105,330 (3), 148,466 (5): about 21,500 per extra call, so a second call overflows the cap. ERC-8421's 1M staked
budget would hold over 40 calls, against the renderer's own limit of 16.

**State gas:** this devnet charges EIP-8037 state gas, about 1,530 per byte of new state. It is why frame 2 declares
1,500,000 of it, why a first approval costs much more than a later one (ledger entries are new slots), and why deploying the
paymaster took about 34M gas.

## Leg B: Sepolia (ERC-4337, EntryPoint v0.7)

`actualGasUsed` from the bundler's receipt, covering account validation, paymaster render, the batch and overhead.

| What | Bundler | actualGasUsed | Tx |
|---|---|---:|---|
| Honest transfer on Sepolia via Pimlico, recipient shown by ENS name | pimlico | 1,248,536 | [tx](https://sepolia.etherscan.io/tx/0xa5b0dddd8c732b0beeedb1192ffecc58f67d9bfd5fc40623b56a68373c1b0b73) |
| Honest transfer on Sepolia via Alchemy | alchemy | 1,062,488 | [tx](https://sepolia.etherscan.io/tx/0x0668bf44585ef7914da9497df05aa7539b86834b470a5118780dec5974097a41) |
| v4 swap through Uniswap's official Sepolia Universal Router and PoolManager | pimlico | 1,177,510 | [tx](https://sepolia.etherscan.io/tx/0xf93a83efe8268adef516c11652defd3f064a88f5ab72adc75b8695ff31d78549) |

Bundler limits met (F8): Alchemy requires at least 40% of the verification limits to be used, which rejected a generous first plan
(33%). The plan in `tools/scripts/lib/userop.ts` passes both Alchemy and Pimlico.
