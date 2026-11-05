# Proofs

Generated from `docs/proofs.json`, which `tools/scripts/attacks.ts`, `swap.ts`, `invalidation.ts` and `legb-run.ts` write as they run against the
live networks. All 25 pass.

A rejection here means the node refused the transaction, so there is no transaction hash. The reason is the paymaster's or account's own revert,
as the node returned it. Reproduce one with `cd tools/scripts && npx tsx attacks.ts A1`.

Explorer history is in memory on the devnet's side and clears when it restarts; the receipts stay on chain while the devnet lives.

## Leg A: EF frames devnet (chain 1337), real ERC-8421 sidecar, no local stack

Live deployment: paymaster `0xee656b20237fbadf51ba251a2512ef1bd2494382`, account `0xd797194917479e6072bf5a91d057ddf7a61292db`, staked in `0x3e8cf277c88b...`.

| ID | Attack or case | Spec expects | Met | Transaction | Reason from the chain |
|---|---|---|---|---|---|
| HONEST | Honest 3-frame transfer | admitted by the public alt mempool and mined; batch succeeds | yes | [`0xded2c9b2c8a7...`](https://explorer.altmempool.wtf/tx/0xded2c9b2c8a7962a2b1d3783e4abb984d43b8a36686f543716ce2d7a859a9938?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A1 | Swap the recipient | mempool reject (tree mismatch) | yes | rejected, no tx | `TreeMismatch(0xaea52a8ebf019e94725cdddc3204c4a1707d7f5a402d26bc2e65cd3b11992a08, 0xfc2e4` |
| A3 | Drop the renderer frame (self-pay layout) | frame 0 rejects | yes | rejected, no tx | `FrameReadFailed()` |
| A3b | Swap in a permissive paymaster | frame 0 rejects (BadLayout) | yes | rejected, no tx | `BadLayout(0x4)` |
| A4 | Signed weaker spec hash | frame 1 hash mismatch | yes | rejected, no tx | `SpecHashMismatch(0xd1a553403a03de59143bc198ada523c65836557ae49359f0d0c94b02ee8d1de2, 0x5` |
| A4b | Weak spec bytes under honest hash | frame 1 hash mismatch | yes | rejected, no tx | `SpecHashMismatch(0x59f5321d9df03f9d974f3765100f5a8330f1458e900156429d62deacfaa2b90f, 0xd` |
| A9 | Fee griefing with an empty deposit | frame 1 rejects | yes | rejected, no tx | `InsufficientDeposit(0x1, 0x2dccee080)` |
| A5 | Poisoned descriptor (unattested code) | UNVERIFIED_CONTRACT, policy reject | yes | rejected, no tx | `PolicyRefused(0x3)` |
| A6 | EvilVault hidden WETH pull | assertion revert, fee kept | yes | [`0x3b74c9dbae73...`](https://explorer.altmempool.wtf/tx/0x3b74c9dbae733b83503640f1bcf1f97590afa602ae706638656c2a0c1a662c0d?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `AssertionFailed(0x2, 0xf0447975d6fe039a027029891c1b08191fd267c9, 0x28c418afbbb5c0000)` |
| A7 | Stale pre-signed transaction past TTL | revert | yes | [`0xb15ad99076ea...`](https://explorer.altmempool.wtf/tx/0xb15ad99076eaf41714d52edcf6112b0559c4f10cddf66fb592c7b9765c0548c4?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `Expired(0x63310, 0x632fd)` |
| A10 | 7702-delegated sender | rejected | yes | rejected, no tx | `BadSignatureEntry()` |
| A11 | Reentrancy into executeVerified | reverts | yes | [`0xd0b8dace0c80...`](https://explorer.altmempool.wtf/tx/0xd0b8dace0c80e2e07a6f840495fa432a752aabdcefa09f63d42885791984b02e?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `Error(reentry failed as designed)]` |
| A12 | Gas griefing: a call burns all its gas | reserve keeps it safe | yes | [`0x109022a2c5fb...`](https://explorer.altmempool.wtf/tx/0x109022a2c5fba0fbb05bde118ac9f380560d7cbb7d9ba6e4facb319d1a145353?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `CallFailed(0x0, 0x) [0x]` |
| F7 | Fee failure runs nothing | frame 2 fails; no protected call executes | yes | [`0xfdcc352a4054...`](https://explorer.altmempool.wtf/tx/0xfdcc352a4054117e08ba9ae1821c2d1a1d20c83546f09e7871f16cd16a052e74?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| SWAP | Honest v4 swap through the real Universal Router | admitted, mined, min out respected | yes | [`0xd6b5e9fcc5cc...`](https://explorer.altmempool.wtf/tx/0xd6b5e9fcc5ccd51a407b28056a3eafe6e5e06392f77ad46248691e23aa4efa8a?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| WRAP | WRAP_ETH through the real Universal Router | admitted, mined, exact WETH delta | yes | [`0xd0050ff7c89f...`](https://explorer.altmempool.wtf/tx/0xd0050ff7c89f46f6e78ed332bc2807d493652717a223315276f71a8541c2110a?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A2-eoa | Same evil route on an ordinary wallet | the skim works: this is what Verbatim prevents | yes | [`0xfc0970583fc6...`](https://explorer.altmempool.wtf/tx/0xfc0970583fc676c553e6093959fe13e49b19bfc6a424cf837dedb5d11f750fa4?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A2 | minOut=0 via SkimHook under an honest sentence | mempool reject (tree mismatch) | yes | rejected, no tx | `TreeMismatch(0x289d0548d73152a54d9e464159463d65ce9ce74b242e6d4f33d60dfe0261f45e, 0xb2754` |
| A2b | User signs the true SkimHook sentence | policy rejects | yes | rejected, no tx | `PolicyRefused(0x38)` |
| INVALIDATION | Revoking one descriptor stops only the transactions that use it | an unrelated refresh invalidates nothing; the revocation invalidates 1 of 5 | yes | rejected, no tx | `TreeMismatch(0xbd80ee7c195b35421973d7e6c9b128218c9737cf8affc1b09426d86adcc11d06, 0x57d81` |

**What the "plain EOA" row shows:** `A2-eoa` is the same evil route sent from an ordinary wallet. Received `25568739` raw dUSDC, while the hook's
beneficiary took `2531305096`. That is the loss Verbatim's rejections prevent.

**Revocation (`INVALIDATION`):** of 5 signed transactions, an unrelated `refreshTrust` invalidated none, and revoking one descriptor invalidated exactly the one using it
([false,true,true,true,true]). Measured by re-running validation through `ethrex_simulateFrameTransaction`, the call the sidecar itself makes. They share a
sender, so they were not all held pending at once.

**Explorer links** name the miner's node (`?node=...`), because the explorer otherwise asks the gateway, which did not see these. There each honest row shows "On chain" and "Every rule passed", with the admission report for frame 0 (sender) and frame 1 (payer).

**Which endpoint:** the docs' gateway and the miner's sidecar run the same rules. On the night of 5 to 6 November the gateway lost its gossip link to the miner
(`skandha_connectedPeers` returned `[]`, and every sender's transactions stayed `New`), so these were submitted to the miner's sidecar. Rule-enforcing admission is identical. Earlier deployments' transactions did go through the gateway and landed, for example `0x70855b1b...73f4` in block 404793.

**Staked vs unstaked, canonical vs alt:** ethrex's canonical check reports `StorageReadNonSender` for these transactions, since the paymaster reads its own storage. The alt mempool
admits them because the paymaster is staked. This is the "needs the alt mempool" evidence.

## Leg B: Sepolia, official Uniswap contracts, ENSv2

Paymaster `0xc242b797a9ab3f151f434d902cec2f5acef31701`, account `0x59092c8916926f8ddab8421e7b4e8c08834a542c`.

| ID | Case | Spec expects | Met | Transaction | Reason or detail |
|---|---|---|---|---|---|
| B-honest-pimlico | Honest transfer on Sepolia via Pimlico, recipient shown by ENS name | bundler accepts; lands; delivered | yes | [`0x8f6e2fad4107...`](https://sepolia.etherscan.io/tx/0x8f6e2fad41072dbb405c81a9aaffce58d690b7cf876e2ad7de46e74c2106a305) | `as expected` |
| B-honest-alchemy | Honest transfer on Sepolia via Alchemy | bundler accepts; lands; delivered | yes | [`0x4f1bac38c460...`](https://sepolia.etherscan.io/tx/0x4f1bac38c46053d14e99cdaa52bfcfc681d2f18b762d9d95008db442c9b2873d) | `as expected` |
| B-swap | v4 swap through Uniswap's official Sepolia Universal Router and PoolManager | bundler accepts; lands; min out respected | yes | [`0x0f70460eb746...`](https://sepolia.etherscan.io/tx/0x0f70460eb746c1d76c47bcd99784727d0c543a57c6857d73e765a9fd325d21ac) | `as expected` |
| B-A1 | Swapped recipient under an honest sentence, on Sepolia | bundler rejects; paymaster reverts TreeMismatch | yes | rejected, no tx | `TreeMismatch(0x1fe4012d07b5f3c48e3f8dc2a9c64d5ebc96a58286bfcf9c6e221a142e762614, 0xb5ba6` |
| A8 | Lookalike ENS name | name not in the cache, so hex is shown; the exclusivity check fails at refresh | yes | rejected, no tx | `WrongResolverCode(0x0530a4cbd0086fc7728614d14cf73974e1e0e17089000b956b98a659ed979f5e)` |

| ENS step | Transaction |
|---|---|
| Registered `verbatim-demo.eth` | [`0x6ba53bc758ef...`](https://sepolia.etherscan.io/tx/0x6ba53bc758efa538cc53136e12274e4e4835d135d76b8094e8cd81df68cb21dc) |
| Renounced resolver root roles (SET_TEXT, LINK, UPGRADE and their admins) | [`0x7b229411e300...`](https://sepolia.etherscan.io/tx/0x7b229411e300a7691a6866c8d667def2d00d6c1f5449d877c759a53a07c04231) |
| Renounced registry roles (SET_RESOLVER, SET_SUBREGISTRY and their admins) | [`0x34e539877e7e...`](https://sepolia.etherscan.io/tx/0x34e539877e7e8155a25083ceb9ce396a503df666e6f4e0ea9360542eb1344562) |
| Council published the `clear-signing` record | [`0x9c72f2c56c76...`](https://sepolia.etherscan.io/tx/0x9c72f2c56c762a4cd4f3236c7d2e4e1fd7dc2f332b9a96128222d831f884039a) |
| `refreshTrust`, passing attestors and the live exclusivity proof | [`0x34c2d07303a1...`](https://sepolia.etherscan.io/tx/0x34c2d07303a148601c306705232eb0289c4840d01e4796e2bf11ccf3bf707ce3) |

**A8 in detail:** `verbatim-dem0.eth` was registered without giving up any roles, and published a record claiming a descriptor. `refreshTrust` refuses it with `WrongResolverCode`.
A checker pinned to the lookalike's own resolver code still refuses it, with `RootRolesHeld` (checker `0x728336074b2e46af182887ca1d21baab52db677e`). A sentence paying its address shows `To: 0x000000000000000000000000000000000000bad1`: hex, no name.

## In the browser

`tools/e2e/demo.ts` drives the real pages through §20 against the live devnet, with the signer page's network cut after load. See `docs/demo/`.
