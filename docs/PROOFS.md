# Proofs

Generated from `docs/proofs.json`, which `tools/scripts/attacks.ts`, `swap.ts`, `stateless.ts`, `invalidation.ts` and `legb-run.ts` write as they run against the
live networks. **13 of 48 not met:** A1, A3, A3b, A4, A4b, A9, A5, A6, A14, A16, A17, A17b, B12. A row shows its latest run, which may predate the final build. `docs/STATUS.md` says what has been rerun.

A rejection here means the node refused the transaction, so there is no transaction hash. The reason is the paymaster's or account's own revert,
as the node returned it. Reproduce one with `cd tools/scripts && npx tsx attacks.ts A1`.

Explorer history is in memory on the devnet's side and clears when it restarts; the receipts stay on chain while the devnet lives.

## Leg A: EF frames devnet (chain 1337), real ERC-8421 sidecar, no local stack

Live deployment: paymaster `0xdf2672849e3317f27157049589237922151fec76`, account `0x5e065985a4b1a95c0bd9173faa49801ad7097053`, staked in `0xb11667238ec2...`.

| ID | Attack or case | Spec expects | Met | Transaction | Reason from the chain |
|---|---|---|---|---|---|
| HONEST | Honest 4-frame transfer | admitted by the public alt mempool and mined; batch succeeds | yes | [`0x945579461601...`](https://explorer.altmempool.wtf/tx/0x945579461601b42b28ba638df1d06a5026757394180f5d34b517adda9ba7a602?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A1 | Swap the recipient | mempool reject (tree mismatch) | **NO** | rejected, no tx | `FrameReadFailed()` |
| A3 | Drop the renderer frame (self-pay layout) | frame 0 rejects with BadLayout | **NO** | rejected, no tx | `FrameReadFailed()` |
| A3b | Swap in a permissive paymaster | frame 0 rejects (BadLayout) | **NO** | rejected, no tx | `FrameReadFailed()` |
| A4 | Signed weaker spec hash | frame 1 hash mismatch | **NO** | rejected, no tx | `FrameReadFailed()` |
| A4b | Weak spec bytes under honest hash | frame 1 hash mismatch | **NO** | rejected, no tx | `FrameReadFailed()` |
| A9 | No fee ticket for this nonce | frame 1 rejects | **NO** | rejected, no tx | `FrameReadFailed()` |
| A5 | Poisoned descriptor (unattested code) | UNVERIFIED_CONTRACT, policy reject | **NO** | rejected, no tx | `FrameReadFailed()` |
| A6 | EvilVault hidden pull | assertion revert, fee kept | **NO** | rejected, no tx | `FrameReadFailed()` |
| A7 | Stale pre-signed transaction past its expiry | the expiry frame refuses it at the mempool | yes | rejected, no tx | `validation frame 0: reverted` |
| A10 | 7702-delegated sender | rejected | yes | rejected, no tx | `FrameReadFailed()` |
| A11 | Reentrancy into executeVerified | reverts | yes | [`0x55077d80b6fe...`](https://explorer.altmempool.wtf/tx/0x55077d80b6fecfdfdd7b2979aca11421555df260a23c4105f50694f8864a3fc3?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `Error(reentry failed as designed)]` |
| A12 | Gas griefing: a call burns all its gas | reserve keeps it safe | yes | [`0x34a28447d379...`](https://explorer.altmempool.wtf/tx/0x34a28447d379a0c9fcb9751d14ee00e25193c58534cd27a57b7a2273d0040ae5?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `CallFailed(0x0, 0x) [0x]` |
| F7 | Fee failure runs nothing | the execute frame fails; no protected call executes | yes | [`0xfac98fb7261d...`](https://explorer.altmempool.wtf/tx/0xfac98fb7261d75f7bfadd1ffb532fb8c09bc65ae3f2c76421db47f79b78a79e6?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| SWAP | Honest v4 swap through the real Universal Router | admitted, mined, min out respected | yes | [`0x6aaba4c1fdc9...`](https://explorer.altmempool.wtf/tx/0x6aaba4c1fdc9073dbfc73c81cf779f31dac195d1180e7e4e6ccdbf81a15f0e27?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| WRAP | WRAP_ETH through the real Universal Router | admitted, mined, exact WETH delta | yes | [`0x9f48386b4340...`](https://explorer.altmempool.wtf/tx/0x9f48386b4340f071bc2f64a4b69d920da8f07c34a6b87f716089a18ea6efe908?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A2-eoa | Same evil route on an ordinary wallet | the skim works: this is what Verbatim prevents | yes | [`0x9187793b9a85...`](https://explorer.altmempool.wtf/tx/0x9187793b9a8511ed5dab4121d7abe9ba082c68b02aa2d33afdebf37b9b69bfa8?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A2 | minOut=0 via SkimHook under an honest sentence | mempool reject (tree mismatch) | yes | rejected, no tx | `TreeMismatch(0x3b98ee55a7213ace57c714198b7e3928682e2185cd4eed02cd49f920281d4c45, 0xf4108` |
| A2b | User signs the true SkimHook sentence | policy rejects | yes | rejected, no tx | `PolicyRefused(0x38)` |
| INVALIDATION | Revoking one descriptor stops only the transactions that use it | an unrelated refresh invalidates nothing; the revocation invalidates 1 of 5 | yes | rejected, no tx | `TreeMismatch(0xbd80ee7c195b35421973d7e6c9b128218c9737cf8affc1b09426d86adcc11d06, 0x57d81` |
| A13 | Future-dated expiry | the device refuses; signed anyway, the policy cap reverts the batch | yes | [`0xd0d65b138e74...`](https://explorer.altmempool.wtf/tx/0xd0d65b138e74183022ebf1a8c1f2187a82d52363e795e01162614a71168afb9e?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `TtlTooLong(0xdfe, 0x12c)` |
| A14 | Two transactions, one fee ticket | the second is rejected: tickets are per nonce | **NO** | rejected, no tx | `FrameReadFailed()` |
| A16 | Router command with the allow-revert flag | UR_ALLOW_REVERT in the sentence, then policy refusal | **NO** | rejected, no tx | `FrameReadFailed()` |
| A17 | Unknown router command (PERMIT2_PERMIT) | BLIND, then refusal | **NO** | rejected, no tx | `FrameReadFailed()` |
| A17b | Unknown v4 action (SWAP_EXACT_IN) | BLIND, then refusal | **NO** | rejected, no tx | `FrameReadFailed()` |
| A18 | Return bomb: a call reverts with 500 KB | batch reverts, fee stays paid | yes | [`0x347fcc1b07df...`](https://explorer.altmempool.wtf/tx/0x347fcc1b07dfdbd5558393f730c26bd0dc364cecaeef8c037e5ed822da6cb682?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `0x5c0dee5d000000000000000000000000000000000000000000000000000000000000000000000000000000` |
| A15 | Revoking one descriptor stops only the transactions that use it | an unrelated refresh invalidates nothing; the revocation invalidates 1 of 5 | yes | rejected, no tx | `TreeMismatch(0xe78a5ca259fb56f2a1d1ab9b2778c3fce41dd3e67e7a423b4fdd5aac7791ef54, 0x1e67d` |
| CANONICAL-UNSTAKED | Unstaked renderer: the public sidecar refuses it | unstaked payer | yes | rejected, no tx | `unstaked payer accessed payer slot 0xfe14b27715673b991bd7915a08d56171b500abd7973c04ea2a6` |
| G0a | Expiry verifier deployed | code at the verifier address | yes | rejected, no tx | `Spec address 0x81413f0cF12e9b6a49B1D0439E081c577D57FfFf: no code. Devnet address 0x00000` |
| G0b | Two explicit msgs in four SECP256K1 entries, read in a SIGPARAM loop | admitted and mined | yes | [`0x43f68a93c88e...`](https://explorer.altmempool.wtf/tx/0x43f68a93c88ea744527af3cd29be8e1c1cc07b0549ea5fb68853cf505b94bc70?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `{"shape":"SelfVerify","canonical":true,"violation":null}` |
| G0d | EXTCODEHASH of a contract that is no entity, in an unstaked sender's VERIFY | admitted and mined | yes | [`0x43f68a93c88e...`](https://explorer.altmempool.wtf/tx/0x43f68a93c88ea744527af3cd29be8e1c1cc07b0549ea5fb68853cf505b94bc70?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `{"shape":"SelfVerify","canonical":true,"violation":null}` |
| G0e1 | [expiry_verify, self_verify] prefix | admitted and mined | yes | [`0x43f68a93c88e...`](https://explorer.altmempool.wtf/tx/0x43f68a93c88ea744527af3cd29be8e1c1cc07b0549ea5fb68853cf505b94bc70?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `{"shape":"SelfVerify","canonical":true,"violation":null}` |
| G0e2 | [expiry_verify, only_verify, pay] prefix with a staked paymaster | admitted and mined | yes | [`0xa93d227098bd...`](https://explorer.altmempool.wtf/tx/0xa93d227098bd7354d64149229576bfe63dc8de9c1b17eee5ade47db121d7a2b6?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `{"shape":"OnlyVerifyPay","canonical":false,"violation":"StorageReadNonSender"}` |
| G0c | Signature gas counts toward the 100k cap | limits + signatures = 100,000 admitted; 100,001 refused | yes | [`0x2cab86f1e0d2...`](https://explorer.altmempool.wtf/tx/0x2cab86f1e0d2cf5dae1f5f63fb3b4371c7704ca6e9e8c558f963871f25fefa17?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `validation prefix execution gas sum 88801 + signature-verification cost 11200 = 100001 e` |
| G0f | A transaction past its expiry | refused by the mempool | yes | rejected, no tx | `validation frame 0: reverted` |
| A7b | Expiry frame starved of gas | BadLayout: the account reads frame 0's status | yes | rejected, no tx | `validation frame 0: ran out of gas (the frame's gas limit 2000 cannot cover its entry ch` |
| B12 | Same signed content under a different nonce key | the second is refused: Replayed | **NO** | rejected, no tx | `FrameReadFailed()` |
| B14 | An approval left standing after the batch | APPROVALS_CLEARED fails, batch reverts, fee kept | yes | [`0x046e60552f28...`](https://explorer.altmempool.wtf/tx/0x046e60552f28aacfbde946df8a97a975380dce781781148c1610b9b6403246ea?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `AssertionFailed(0x5, 0x0, 0x5)` |

**What the "plain EOA" row shows:** `A2-eoa` is the same evil route sent from an ordinary wallet. That is the loss Verbatim's rejections prevent.

**Revocation (`A15`):** of 5 signed transactions, an unrelated `refreshTrust` invalidated none, and revoking one descriptor invalidated exactly the one using it
([false,true,true,true,true]). The refresh keeps the snapshot root: rotating it is a different event, since paymaster-path transactions sign it. Measured by re-running validation through `ethrex_simulateFrameTransaction`, the call the sidecar itself makes. They share a
sender, so they were not all held pending at once.

**Explorer links** name the miner's node (`?node=...`), because the explorer otherwise asks the gateway, which may not have seen these.

**Staked vs unstaked, canonical vs alt:** ethrex's canonical check reports `StorageReadNonSender` for these transactions, since the paymaster reads its own storage. The alt mempool
admits them because the paymaster is staked. This is the "needs the alt mempool" evidence.

## Production leg: Sepolia, official Uniswap contracts, ENSv2

Stateless ERC-4337 account `0xa1e877b2f6b167b52d0ad33ea7c73e3301829da7`, with no paymaster.

| ID | Case | Spec expects | Met | Transaction | Reason or detail |
|---|---|---|---|---|---|
| B-honest-pimlico | Honest transfer on Sepolia via Pimlico, recipient shown by ENS name | bundler accepts; lands; delivered; name in the sentence | yes | [`0xd5bef0e32ce8...`](https://sepolia.etherscan.io/tx/0xd5bef0e32ce8ee7239bac08ae676329dae13b1a1b33de0eedf1429705e2e1bae) | `as expected` |
| B-honest-alchemy | Honest transfer on Sepolia via Alchemy | bundler accepts; lands; delivered | yes | [`0x540608c614d9...`](https://sepolia.etherscan.io/tx/0x540608c614d999cfb63fd496e405454928dcc6b889bcf1f029d6bc929a3694f9) | `as expected` |
| B-swap | v4 swap through Uniswap's official Sepolia Universal Router and PoolManager | lands; minimum output respected | yes | [`0x57c7b706e64d...`](https://sepolia.etherscan.io/tx/0x57c7b706e64d9f8a4445b5e42a78bc9682b43f5c47f25f5639600d0ef5c7b47c) | `as expected` |
| B-A1 | Swapped recipient under an honest sentence, on Sepolia | bundler rejects; the account's reason is TreeMismatch | yes | rejected, no tx | `Internal error from bundler (trace id: 159b94dedeecf1740556199cd4b2c61e) | Error: TreeMi` |
| A8 | Lookalike ENS name | not in the snapshot, so hex is shown; the exclusivity proof refuses it | yes | rejected, no tx | `Execution reverted with reason: +Ă                           . Raw Call Arguments:` |
| B13 | An attestor missing from the ENS anchor | admitted; refused at execution: AttestorNotListed | yes | [`0x4e0614b79956...`](https://sepolia.etherscan.io/tx/0x4e0614b79956b1a43976a58c5b9950fdfadb0857948a7c9d88348bebb6af6758) | `AttestorNotListed(0x062D072F2Cd4E28659cdD434aD985dc5696d522C)` |
| B-ens-revoked | A leaf revoked by ENS record while the operation is pending | admitted; refused at execution: LeafRevokedInEns | yes | [`0x03675f840b41...`](https://sepolia.etherscan.io/tx/0x03675f840b417f1c6a2efac2cb8fb246155bb40603575dc12c685dde468aad9a) | `LeafRevokedInEns(0x855303e467745419d6be80bbb9f5d7c68f7286761e53355bcdffd7fd2506fdd1)` |
| B-A2-eoa | The evil route on an ordinary wallet, Sepolia | the skim works: this is what Verbatim prevents | yes | [`0x6c8e25647358...`](https://sepolia.etherscan.io/tx/0x6c8e256473585839e32a6f9deef46501cf935759e665fdec4ee1b7e0b89fb10b) | `as expected` |
| B-A2b | The same route, signed on the true sentence | the device shows the risks; PolicyRefused | yes | rejected, no tx | `! NO MINIMUM OUTPUT | ! HOOK CAN TAKE YOUR OUTPUT | ! UNVERIFIED HOOK || PolicyRefused(5` |
| WC | A dapp pairs over WalletConnect's relay; honest swap lands; the evil route shows its risks and is refused | lands; refused | yes | [`0x67810e38daf2...`](https://sepolia.etherscan.io/tx/0x67810e38daf222d4b84500847a495a6595d77c28d1cfe2934e4aa09cb3b8498c) | `as expected` |

**Refusals through a bundler:** a bundler reports a reverting validation as a generic error, so `B-A2b` reads the reason from the account itself (`tools/scripts/why-evil.ts`).

ENS: publisher `verbatim-demo.eth`, trust anchor `verbatim-anchor.eth`. The anchor's attestor record was set in [`0xf810b825f4c0...`](https://sepolia.etherscan.io/tx/0xf810b825f4c03cd55bd46bfedbef0541b8d475c0969d380956dbaf75bc02e48e).

## In the browser

`tools/e2e/demo.ts` drives the real pages through §20 against the live devnet, with the signer page's network cut after load. See `docs/demo/`.
