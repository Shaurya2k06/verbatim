# Proofs

Generated from `docs/proofs.json`, which `tools/scripts/attacks.ts`, `swap.ts`, `invalidation.ts` and `legb-run.ts` write as they run against the
live networks. All 33 pass.

A rejection here means the node refused the transaction, so there is no transaction hash. The reason is the paymaster's or account's own revert,
as the node returned it. Reproduce one with `cd tools/scripts && npx tsx attacks.ts A1`.

Explorer history is in memory on the devnet's side and clears when it restarts; the receipts stay on chain while the devnet lives.

## Leg A: EF frames devnet (chain 1337), real ERC-8421 sidecar, no local stack

Live deployment: paymaster `0x97da098b58c6c1659957dbd493e6cb0a84dbd3a0`, account `0x268f98c9e33b1ad20911bfaea286fe6ee8415845`, staked in `0x7bb7f7cefb5a...`.

| ID | Attack or case | Spec expects | Met | Transaction | Reason from the chain |
|---|---|---|---|---|---|
| HONEST | Honest 3-frame transfer | admitted by the public alt mempool and mined; batch succeeds | yes | [`0x41bf1e2ec41c...`](https://explorer.altmempool.wtf/tx/0x41bf1e2ec41c3b56a4de327b71967cf759d505b0d4f9678afc0f3c75a4c88956?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A1 | Swap the recipient | mempool reject (tree mismatch) | yes | rejected, no tx | `TreeMismatch(0x4fbaeb3602762f7ee7b5511af98f2226cb9a8e89af5cf7b6e994698dca8de000, 0x71471` |
| A3 | Drop the renderer frame (self-pay layout) | frame 0 rejects with BadLayout | yes | rejected, no tx | `BadLayout(0x0)` |
| A3b | Swap in a permissive paymaster | frame 0 rejects (BadLayout) | yes | rejected, no tx | `BadLayout(0x4)` |
| A4 | Signed weaker spec hash | frame 1 hash mismatch | yes | rejected, no tx | `SpecHashMismatch(0xd1a553403a03de59143bc198ada523c65836557ae49359f0d0c94b02ee8d1de2, 0x6` |
| A4b | Weak spec bytes under honest hash | frame 1 hash mismatch | yes | rejected, no tx | `SpecHashMismatch(0x6bb1ed23be5dae34fe42ad3ef61c4281d4a94bc8dd055d7babc0e7f7a623cd6c, 0xd` |
| A9 | No fee ticket for this nonce | frame 1 rejects | yes | rejected, no tx | `NoTicket(0x1, 0xd02f22b00)` |
| A5 | Poisoned descriptor (unattested code) | UNVERIFIED_CONTRACT, policy reject | yes | rejected, no tx | `PolicyRefused(0x3)` |
| A6 | EvilVault hidden WETH pull | assertion revert, fee kept | yes | [`0x1884f7b0ef00...`](https://explorer.altmempool.wtf/tx/0x1884f7b0ef007a4e10568773886de3ec6361f1ffff13063de2bc9787a8ec46b1?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `AssertionFailed(0x2, 0x22b9ec43cf81fe4da34db0c0788ce0b0a86cecbe, 0x2b5e3af16b1880000)` |
| A7 | Stale pre-signed transaction past validUntil | revert | yes | [`0xf938324fe9ee...`](https://explorer.altmempool.wtf/tx/0xf938324fe9eefe99b7e1685302147dbbf40306b5de9b0500963bbca329533552?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `Expired(0x6aecebd2, 0x6aecebbe)` |
| A10 | 7702-delegated sender | rejected | yes | rejected, no tx | `BadSignatureEntry()` |
| A11 | Reentrancy into executeVerified | reverts | yes | [`0x7cc61d7e4a19...`](https://explorer.altmempool.wtf/tx/0x7cc61d7e4a19d46319101e81b30a8d962acc77445843a14d7218b8b19ada5759?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `Error(reentry failed as designed)]` |
| A12 | Gas griefing: a call burns all its gas | reserve keeps it safe | yes | [`0xfdfc492f755a...`](https://explorer.altmempool.wtf/tx/0xfdfc492f755ae81bd25b600da557df75985e70151656f13071968d6ba8aceedb?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `CallFailed(0x0, 0x) [0x]` |
| F7 | Fee failure runs nothing | frame 2 fails; no protected call executes | yes | [`0xaafbfccd52a5...`](https://explorer.altmempool.wtf/tx/0xaafbfccd52a5fed20edaf1be132ad3eb465e40732ba42515363ac87179b63080?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| SWAP | Honest v4 swap through the real Universal Router | admitted, mined, min out respected | yes | [`0x6aaba4c1fdc9...`](https://explorer.altmempool.wtf/tx/0x6aaba4c1fdc9073dbfc73c81cf779f31dac195d1180e7e4e6ccdbf81a15f0e27?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| WRAP | WRAP_ETH through the real Universal Router | admitted, mined, exact WETH delta | yes | [`0x9f48386b4340...`](https://explorer.altmempool.wtf/tx/0x9f48386b4340f071bc2f64a4b69d920da8f07c34a6b87f716089a18ea6efe908?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A2-eoa | Same evil route on an ordinary wallet | the skim works: this is what Verbatim prevents | yes | [`0x9187793b9a85...`](https://explorer.altmempool.wtf/tx/0x9187793b9a8511ed5dab4121d7abe9ba082c68b02aa2d33afdebf37b9b69bfa8?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A2 | minOut=0 via SkimHook under an honest sentence | mempool reject (tree mismatch) | yes | rejected, no tx | `TreeMismatch(0x3b98ee55a7213ace57c714198b7e3928682e2185cd4eed02cd49f920281d4c45, 0xf4108` |
| A2b | User signs the true SkimHook sentence | policy rejects | yes | rejected, no tx | `PolicyRefused(0x38)` |
| INVALIDATION | Revoking one descriptor stops only the transactions that use it | an unrelated refresh invalidates nothing; the revocation invalidates 1 of 5 | yes | rejected, no tx | `TreeMismatch(0xbd80ee7c195b35421973d7e6c9b128218c9737cf8affc1b09426d86adcc11d06, 0x57d81` |
| A13 | Future-dated validUntil | the device refuses; signed anyway, the policy cap reverts the batch | yes | [`0x19af57ad97dd...`](https://explorer.altmempool.wtf/tx/0x19af57ad97ddca0e2279a1ff3b0c97d042cdd7edae7f54c4831911717460ae53?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `TtlTooLong(0xdf8, 0x12c)` |
| A14 | Two transactions, one fee ticket | the second is rejected: tickets are per nonce | yes | rejected, no tx | `NoTicket(0x2, 0xd02f22b00)` |
| A16 | Router command with the allow-revert flag | UR_ALLOW_REVERT in the sentence, then policy refusal | yes | rejected, no tx | `PolicyRefused(0x200)` |
| A17 | Unknown router command (PERMIT2_PERMIT) | BLIND, then refusal | yes | rejected, no tx | `PolicyRefused(0x2)` |
| A17b | Unknown v4 action (SWAP_EXACT_IN) | BLIND, then refusal | yes | rejected, no tx | `PolicyRefused(0x2)` |
| A18 | Return bomb: a call reverts with 500 KB | batch reverts, fee stays paid | yes | [`0xaaa9991453f6...`](https://explorer.altmempool.wtf/tx/0xaaa9991453f62cb2589e3a9531b4c5b6cc17a74d51c08aedeebd944884d280bc?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `0x5c0dee5d000000000000000000000000000000000000000000000000000000000000000000000000000000` |
| A15 | Revoking one descriptor stops only the transactions that use it | an unrelated refresh invalidates nothing; the revocation invalidates 1 of 5 | yes | rejected, no tx | `TreeMismatch(0xe78a5ca259fb56f2a1d1ab9b2778c3fce41dd3e67e7a423b4fdd5aac7791ef54, 0x1e67d` |
| CANONICAL-UNSTAKED | Unstaked renderer: the public sidecar refuses it | unstaked payer | yes | rejected, no tx | `unstaked payer accessed payer slot 0xfe14b27715673b991bd7915a08d56171b500abd7973c04ea2a6` |

**What the "plain EOA" row shows:** `A2-eoa` is the same evil route sent from an ordinary wallet. Received `28361251` raw dUSDC, while the hook's
beneficiary took `2807763804`. That is the loss Verbatim's rejections prevent.

**Revocation (`A15`):** of 5 signed transactions, an unrelated `refreshTrust` invalidated none, and revoking one descriptor invalidated exactly the one using it
([false,true,true,true,true]). Measured by re-running validation through `ethrex_simulateFrameTransaction`, the call the sidecar itself makes. They share a
sender, so they were not all held pending at once.

**Explorer links** name the miner's node (`?node=...`), because the explorer otherwise asks the gateway, which did not see these. There each honest row shows "On chain" and "Every rule passed", with the admission report for frame 0 (sender) and frame 1 (payer).

**Which endpoint:** the docs' gateway and the miner's sidecar run the same rules. On the night of 5 to 6 November the gateway lost its gossip link to the miner
(`skandha_connectedPeers` returned `[]`, and every sender's transactions stayed `New`), so these were submitted to the miner's sidecar. Rule-enforcing admission is identical. Earlier deployments' transactions did go through the gateway and landed, for example `0x70855b1b...73f4` in block 404793.

**Staked vs unstaked, canonical vs alt:** ethrex's canonical check reports `StorageReadNonSender` for these transactions, since the paymaster reads its own storage. The alt mempool
admits them because the paymaster is staked. This is the "needs the alt mempool" evidence.

## Leg B: Sepolia, official Uniswap contracts, ENSv2

Paymaster `0x6c7a705a6a744b316c7f2a070419630dcf978b45`, account `0x74cba4a5916a8e665167d25da40e29d4ae5e0b67`.

| ID | Case | Spec expects | Met | Transaction | Reason or detail |
|---|---|---|---|---|---|
| B-honest-pimlico | Honest transfer on Sepolia via Pimlico, recipient shown by ENS name | bundler accepts; lands; delivered | yes | [`0x49256aa47f50...`](https://sepolia.etherscan.io/tx/0x49256aa47f5000f839301ffa7a6add588725f345e6d6d7142c32d7c4db54d2da) | `as expected` |
| B-honest-alchemy | Honest transfer on Sepolia via Alchemy | bundler accepts; lands; delivered | yes | [`0xc30b42437771...`](https://sepolia.etherscan.io/tx/0xc30b42437771a2fb31532bf43515faed1033c9f9bf9a2130b98572491d26c52c) | `as expected` |
| B-swap | v4 swap through Uniswap's official Sepolia Universal Router and PoolManager | bundler accepts; lands; min out respected | yes | [`0x9723873a2185...`](https://sepolia.etherscan.io/tx/0x9723873a218547940dd2992d71b3e09364406ae8fffb77ab1bff3253a713b035) | `as expected` |
| B-A1 | Swapped recipient under an honest sentence, on Sepolia | bundler rejects; paymaster reverts TreeMismatch | yes | rejected, no tx | `TreeMismatch(0x678e50e16a445bc39dec6c1481f580fe89d462728b78fe162d53d51246af5275, 0xc8b9f` |
| A8 | Lookalike ENS name | name not in the cache, so hex is shown; the exclusivity check fails at refresh | yes | rejected, no tx | `WrongResolverCode(0x0530a4cbd0086fc7728614d14cf73974e1e0e17089000b956b98a659ed979f5e)` |

| ENS step | Transaction |
|---|---|
| Registered `verbatim-demo.eth` | [`0x6ba53bc758ef...`](https://sepolia.etherscan.io/tx/0x6ba53bc758efa538cc53136e12274e4e4835d135d76b8094e8cd81df68cb21dc) |
| Renounced resolver root roles (SET_TEXT, LINK, UPGRADE and their admins) | [`0x7b229411e300...`](https://sepolia.etherscan.io/tx/0x7b229411e300a7691a6866c8d667def2d00d6c1f5449d877c759a53a07c04231) |
| Renounced registry roles (SET_RESOLVER, SET_SUBREGISTRY and their admins) | [`0x34e539877e7e...`](https://sepolia.etherscan.io/tx/0x34e539877e7e8155a25083ceb9ce396a503df666e6f4e0ea9360542eb1344562) |
| Council published the `clear-signing` record | [`0x9c72f2c56c76...`](https://sepolia.etherscan.io/tx/0x9c72f2c56c762a4cd4f3236c7d2e4e1fd7dc2f332b9a96128222d831f884039a) |
| `refreshTrust`, passing attestors and the live exclusivity proof | [`0x3b66fd1dd6c2...`](https://sepolia.etherscan.io/tx/0x3b66fd1dd6c2e59b9a0d3dd018d468051e7b4d9e117eea4cccae7731b049a7a5) |

**A8 in detail:** `verbatim-dem0.eth` was registered without giving up any roles, and published a record claiming a descriptor. `refreshTrust` refuses it with `WrongResolverCode`.
A checker pinned to the lookalike's own resolver code still refuses it, with `RootRolesHeld` (checker `0xf47fa7a5ef1f0c38d88b9076e872316a8b3968fd`). A sentence paying its address shows `To: 0x000000000000000000000000000000000000bad1`: hex, no name.

## In the browser

`tools/e2e/demo.ts` drives the real pages through §20 against the live devnet, with the signer page's network cut after load. See `docs/demo/`.
