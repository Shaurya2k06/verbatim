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
| HONEST | Honest 3-frame transfer | admitted by the public alt mempool and mined; batch succeeds | yes | [`0xeb721f063fe1...`](https://explorer.altmempool.wtf/tx/0xeb721f063fe1e9cda5dd7d8c9939fb73ce172729959d1f23009efba2cb430f54?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A1 | Swap the recipient | mempool reject (tree mismatch) | yes | rejected, no tx | `TreeMismatch(0x0957d09798aff504c142a3d4388ba142bd724c4810eb6a39b6c9be1bbc6a70cb, 0x8809a` |
| A3 | Drop the renderer frame (self-pay layout) | frame 0 rejects | yes | rejected, no tx | `FrameReadFailed()` |
| A3b | Swap in a permissive paymaster | frame 0 rejects (BadLayout) | yes | rejected, no tx | `BadLayout(0x4)` |
| A4 | Signed weaker spec hash | frame 1 hash mismatch | yes | rejected, no tx | `SpecHashMismatch(0xd1a553403a03de59143bc198ada523c65836557ae49359f0d0c94b02ee8d1de2, 0x5` |
| A4b | Weak spec bytes under honest hash | frame 1 hash mismatch | yes | rejected, no tx | `SpecHashMismatch(0x59f5321d9df03f9d974f3765100f5a8330f1458e900156429d62deacfaa2b90f, 0xd` |
| A9 | Fee griefing with an empty deposit | frame 1 rejects | yes | rejected, no tx | `InsufficientDeposit(0x1, 0x2dccee080)` |
| A5 | Poisoned descriptor (unattested code) | UNVERIFIED_CONTRACT, policy reject | yes | rejected, no tx | `PolicyRefused(0x3)` |
| A6 | EvilVault hidden WETH pull | assertion revert, fee kept | yes | [`0xa8eca04145d2...`](https://explorer.altmempool.wtf/tx/0xa8eca04145d2ab31eb99a18e34621fd221b2f8217511f9b0715d2bd7a4f79dbe?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `AssertionFailed(0x2, 0xf0447975d6fe039a027029891c1b08191fd267c9, 0x2b5e3af16b1880000)` |
| A7 | Stale pre-signed transaction past TTL | revert | yes | [`0xb9714def8bfb...`](https://explorer.altmempool.wtf/tx/0xb9714def8bfb6abc74a098060b8b90f4c8ee13bf7d922ba916515dcec8032a29?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `Expired(0x630ad, 0x6309b)` |
| A10 | 7702-delegated sender | rejected | yes | rejected, no tx | `BadSignatureEntry()` |
| A11 | Reentrancy into executeVerified | reverts | yes | [`0x61ff3c776d11...`](https://explorer.altmempool.wtf/tx/0x61ff3c776d11cf8255c16efc8b61bbb5a5b06e4512fb48fc5438e6568a55f965?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `Error(reentry failed as designed)]` |
| A12 | Gas griefing: a call burns all its gas | reserve keeps it safe | yes | [`0xc0fd0fbcfc11...`](https://explorer.altmempool.wtf/tx/0xc0fd0fbcfc114315bd8c6f0225cb2dd83e6d9b201dff7ffb8095c6674232cae3?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `CallFailed(0x0, 0x) [0x]` |
| F7 | Fee failure runs nothing | frame 2 fails; no protected call executes | yes | [`0x48c13cd2a738...`](https://explorer.altmempool.wtf/tx/0x48c13cd2a738ca5e0efea2797dcb05aa596b8f8ad8bd826ef1a11e6f11b8a5ad?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| SWAP | Honest v4 swap through the real Universal Router | admitted, mined, min out respected | yes | [`0x2ec2833bb088...`](https://explorer.altmempool.wtf/tx/0x2ec2833bb0884839deca6e6d08fc63de3b34e5aa1ee29be666b8cc60a2da598d?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| WRAP | WRAP_ETH through the real Universal Router | admitted, mined, exact WETH delta | yes | [`0x318ea321677a...`](https://explorer.altmempool.wtf/tx/0x318ea321677a4e94d5b9d7b3339eb27ee635728e155f57082f1074f99473971e?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A2-eoa | Same evil route on an ordinary wallet | the skim works: this is what Verbatim prevents | yes | [`0xa12b37f5b909...`](https://explorer.altmempool.wtf/tx/0xa12b37f5b90918bdca8262b3d7754968a82d6284e0c4a7069f7430fb0549b3a1?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A2 | minOut=0 via SkimHook under an honest sentence | mempool reject (tree mismatch) | yes | rejected, no tx | `TreeMismatch(0x2475df5a8dcdc1001f5c703138495d4e4ed1937997a855fb55c90ceb0d190d17, 0xc832f` |
| A2b | User signs the true SkimHook sentence | policy rejects | yes | rejected, no tx | `PolicyRefused(0x38)` |
| INVALIDATION | Revoking one descriptor stops only the transactions that use it | an unrelated refresh invalidates nothing; the revocation invalidates 1 of 5 | yes | rejected, no tx | `TreeMismatch(0xbd80ee7c195b35421973d7e6c9b128218c9737cf8affc1b09426d86adcc11d06, 0x57d81` |

**What the "plain EOA" row shows:** `A2-eoa` is the same evil route sent from an ordinary wallet. Received `28361251` raw dUSDC, while the hook's
beneficiary took `2807763804`. That is the loss Verbatim's rejections prevent.

**Revocation (`INVALIDATION`):** of 5 signed transactions, an unrelated `refreshTrust` invalidated none, and revoking one descriptor invalidated exactly the one using it
([false,true,true,true,true]). Measured by re-running validation through `ethrex_simulateFrameTransaction`, the call the sidecar itself makes. They share a
sender, so they were not all held pending at once.

**Explorer links** name the miner's node (`?node=...`), because the explorer otherwise asks the gateway, which did not see these. There each honest row shows "On chain" and "Every rule passed", with the admission report for frame 0 (sender) and frame 1 (payer).

**Which endpoint:** the docs' gateway and the miner's sidecar run the same rules. On the night of 5 to 6 November the gateway lost its gossip link to the miner
(`skandha_connectedPeers` returned `[]`, and every sender's transactions stayed `New`), so these were submitted to the miner's sidecar. Rule-enforcing admission is identical; earlier runs
went through the gateway without trouble.

**Staked vs unstaked, canonical vs alt:** ethrex's canonical check reports `StorageReadNonSender` for these transactions, since the paymaster reads its own storage. The alt mempool
admits them because the paymaster is staked. This is the "needs the alt mempool" evidence.

## Leg B: Sepolia, official Uniswap contracts, ENSv2

Paymaster `0x9626d7421105bbaf8a06d2355d4cfa709e46486d`, account `0xa8fca8c624865375322a73b1bd32e4ccb87d1788`.

| ID | Case | Spec expects | Met | Transaction | Reason or detail |
|---|---|---|---|---|---|
| B-honest-pimlico | Honest transfer on Sepolia via Pimlico, recipient shown by ENS name | bundler accepts; lands; delivered | yes | [`0xa5b0dddd8c73...`](https://sepolia.etherscan.io/tx/0xa5b0dddd8c732b0beeedb1192ffecc58f67d9bfd5fc40623b56a68373c1b0b73) | `as expected` |
| B-honest-alchemy | Honest transfer on Sepolia via Alchemy | bundler accepts; lands; delivered | yes | [`0x0668bf44585e...`](https://sepolia.etherscan.io/tx/0x0668bf44585ef7914da9497df05aa7539b86834b470a5118780dec5974097a41) | `as expected` |
| B-swap | v4 swap through Uniswap's official Sepolia Universal Router and PoolManager | bundler accepts; lands; min out respected | yes | [`0xf93a83efe826...`](https://sepolia.etherscan.io/tx/0xf93a83efe8268adef516c11652defd3f064a88f5ab72adc75b8695ff31d78549) | `as expected` |
| B-A1 | Swapped recipient under an honest sentence, on Sepolia | bundler rejects; paymaster reverts TreeMismatch | yes | rejected, no tx | `TreeMismatch(0x4eb6f6893458703fbc9efbd4efd833b216e3605e4baaf9bc816fd8ae79725f19, 0x5df46` |
| A8 | Lookalike ENS name | name not in the cache, so hex is shown; the exclusivity check fails at refresh | yes | rejected, no tx | `WrongResolverCode(0x0530a4cbd0086fc7728614d14cf73974e1e0e17089000b956b98a659ed979f5e)` |

| ENS step | Transaction |
|---|---|
| Registered `verbatim-demo.eth` | [`0x6ba53bc758ef...`](https://sepolia.etherscan.io/tx/0x6ba53bc758efa538cc53136e12274e4e4835d135d76b8094e8cd81df68cb21dc) |
| Renounced resolver root roles (SET_TEXT, LINK, UPGRADE and their admins) | [`0x7b229411e300...`](https://sepolia.etherscan.io/tx/0x7b229411e300a7691a6866c8d667def2d00d6c1f5449d877c759a53a07c04231) |
| Renounced registry roles (SET_RESOLVER, SET_SUBREGISTRY and their admins) | [`0x34e539877e7e...`](https://sepolia.etherscan.io/tx/0x34e539877e7e8155a25083ceb9ce396a503df666e6f4e0ea9360542eb1344562) |
| Council published the `clear-signing` record | [`0x9c72f2c56c76...`](https://sepolia.etherscan.io/tx/0x9c72f2c56c762a4cd4f3236c7d2e4e1fd7dc2f332b9a96128222d831f884039a) |
| `refreshTrust`, passing attestors and the live exclusivity proof | [`0x13eab916ebe0...`](https://sepolia.etherscan.io/tx/0x13eab916ebe013ac4c2878d37e4b503fbcbcae613fcce79434d2e0a2fa0be3b2) |

**A8 in detail:** `verbatim-dem0.eth` was registered without giving up any roles, and published a record claiming a descriptor. `refreshTrust` refuses it with `WrongResolverCode`.
A checker pinned to the lookalike's own resolver code still refuses it, with `RootRolesHeld` (checker `0xd0dd3f693a5ba49c66cdf73a47f49dc9eb9f7677`). A sentence paying its address shows `To: 0x000000000000000000000000000000000000bad1`: hex, no name.

## In the browser

`tools/e2e/demo.ts` drives the real pages through §20 against the live devnet, with the signer page's network cut after load. See `docs/demo/`.
