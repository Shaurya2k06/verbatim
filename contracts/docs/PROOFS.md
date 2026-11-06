# Proofs

Generated from `contracts/docs/proofs.json`, which `contracts/scripts/live/attacks.ts`, `swap.ts`, `stateless.ts`, `invalidation.ts` and `legb-run.ts` write as they run against the
live networks. All 69 met. `contracts/docs/STATUS.md` says what has been rerun on the final build.

A rejection here means the node refused the transaction, so there is no transaction hash. The reason is the paymaster's or account's own revert,
as the node returned it. Reproduce one with `cd contracts/scripts/live && npx tsx attacks.ts A1`.

Explorer history is in memory on the devnet's side and clears when it restarts; the receipts stay on chain while the devnet lives.

## Leg A: EF frames devnet (chain 1337), real ERC-8421 sidecar, no local stack

Live deployment: paymaster `0x004ecc066292c1fe27109f96c3fd1413053e5d73`, account `0xb357bb4ce9a5c8c03bf106e5652d3a7014fde225`, staked in `0xd998452dcd9c...`.

| ID | Attack or case | Spec expects | Met | Transaction | Reason from the chain |
|---|---|---|---|---|---|
| HONEST | Honest 4-frame transfer | admitted by the public alt mempool and mined; batch succeeds | yes | [`0xc55c00f7442a...`](https://explorer.altmempool.wtf/tx/0xc55c00f7442a3804054ea2c498e88d305f0b1e348a5159b7c23417c84a87cf54?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A1 | Swap the recipient | mempool reject: the render differs from what was signed | yes | rejected, no tx | `SpecHashMismatch(0x03ad505e608ef67049b9a9c03ac760e23b3d5cf37ba73f276df530a334167223, 0x4` |
| A3 | Drop the renderer frame (self-pay layout) | frame 0 rejects with BadLayout | yes | rejected, no tx | `BadLayout(0x0)` |
| A3b | Swap in a permissive paymaster | frame 0 rejects (BadLayout) | yes | rejected, no tx | `BadLayout(0x4)` |
| A4 | Signed weaker spec hash | frame 1 hash mismatch | yes | rejected, no tx | `SpecHashMismatch(0x4b8545a3f027550dc6ada3eb2104f8cb7f362ebba6edfe325f7a4023385916b5, 0x7` |
| A4b | Weak spec bytes under honest hash | frame 1 hash mismatch | yes | rejected, no tx | `SpecHashMismatch(0x4b8545a3f027550dc6ada3eb2104f8cb7f362ebba6edfe325f7a4023385916b5, 0x7` |
| A9 | No fee ticket for this nonce | frame 1 rejects | yes | rejected, no tx | `NoTicket(0x1, 0x6958316c0)` |
| A5 | Poisoned descriptor (unattested code) | UNVERIFIED_CONTRACT, policy reject | yes | rejected, no tx | `PolicyRefused(0x3)` |
| A6 | EvilVault keeps the ETH and credits no shares | assertion revert, fee kept | yes | [`0x4221e7bcda8e...`](https://explorer.altmempool.wtf/tx/0x4221e7bcda8eaf9573b112e6bf9791d5435ad00c732d2f6ffedfaf98ce252314?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `AssertionFailed(0x1, 0xe8d4a51000, 0x0)` |
| A7 | Stale pre-signed transaction past its expiry | the expiry frame refuses it at the mempool | yes | rejected, no tx | `validation frame 0: reverted` |
| A10 | 7702-delegated sender | rejected | yes | rejected, no tx | `BadLayout(0xa)` |
| A11 | Reentrancy into executeVerified | reverts | yes | [`0xd7ee13c36176...`](https://explorer.altmempool.wtf/tx/0xd7ee13c361764f0b3b31ef5f290c2e11aab3044b8a80da6ae0cbd53db5a8bfdb?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `Error(reentry failed as designed)]` |
| A12 | Gas griefing: a call burns all its gas | reserve keeps it safe | yes | [`0x386920726524...`](https://explorer.altmempool.wtf/tx/0x386920726524fa8a16cbd1171b4638ff00c0caaf4e095692d7a5e606f870d8f9?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `CallFailed(0x0, 0x) [0x]` |
| F7 | Fee failure runs nothing | the execute frame fails; no protected call executes | yes | [`0x4c4af86d715d...`](https://explorer.altmempool.wtf/tx/0x4c4af86d715dcfe8c6b60a3784782372da5ea2e3642e6c2d16eee5868dff0e6e?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| SWAP | Honest v4 swap through the real Universal Router | admitted, mined, min out respected | yes | [`0xcad426d4e55e...`](https://explorer.altmempool.wtf/tx/0xcad426d4e55e69e875dc9b68ebbd65273ca23d5699e8de82a930855b9c5761d3?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| WRAP | WRAP_ETH through the real Universal Router | admitted, mined, exact WETH delta | yes | [`0x25c7c73f13a5...`](https://explorer.altmempool.wtf/tx/0x25c7c73f13a5769f10d1bd1a19d3db269d5fb5988f9a54c3ddaf7f9aecd1bb1e?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A2-eoa | Same evil route on an ordinary wallet | the skim works: this is what Verbatim prevents | yes | [`0xa4e112dd02ba...`](https://explorer.altmempool.wtf/tx/0xa4e112dd02ba81d51ff231f42017cd086fd29daf6c16ab42b66b4016807045e1?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| A2 | minOut=0 via SkimHook under an honest sentence | mempool reject: the render differs from what was signed | yes | rejected, no tx | `SpecHashMismatch(0x66af615096ffdfb189e6d8537754a38376b17f0356c5b00ec22473c7cad63536, 0xd` |
| A2b | User signs the true SkimHook sentence | policy rejects | yes | rejected, no tx | `PolicyRefused(0x38)` |
| A13 | Future-dated expiry | the device refuses; signed anyway, the policy cap reverts the batch | yes | [`0xc89bca98c999...`](https://explorer.altmempool.wtf/tx/0xc89bca98c99904ec334887547a11a180a3ebff217926b6982fd1067b53ef86aa?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `TtlTooLong(0xdc2, 0x12c)` |
| A14 | Two transactions, one fee ticket | the second is rejected: tickets are per nonce | yes | rejected, no tx | `NoTicket(0x2, 0x6954c2840)` |
| A16 | Router command with the allow-revert flag | UR_ALLOW_REVERT in the sentence, then policy refusal | yes | rejected, no tx | `PolicyRefused(0x200)` |
| A17 | Unknown router command (PERMIT2_PERMIT) | BLIND, then refusal | yes | rejected, no tx | `PolicyRefused(0x2)` |
| A17b | Unknown v4 action (SWAP_EXACT_OUT) | BLIND, then refusal | yes | rejected, no tx | `PolicyRefused(0x2)` |
| A18 | Return bomb: a call reverts with 500 KB | batch reverts, fee stays paid | yes | [`0xdcf8bdee6fa1...`](https://explorer.altmempool.wtf/tx/0xdcf8bdee6fa137552943c0d2a8778792e55bd5e04a6962413d966865496e5293?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `0x5c0dee5d000000000000000000000000000000000000000000000000000000000000000000000000000000` |
| A15 | Revoking one descriptor stops only the transactions that use it | an unrelated refresh invalidates nothing; the revocation invalidates 1 of 5 | yes | rejected, no tx | `PolicyRefused(0x3)` |
| CANONICAL-UNSTAKED | Unstaked renderer: the public sidecar refuses it | unstaked payer | yes | rejected, no tx | `unstaked payer accessed payer slot 0xadd0900d34a78c11d07412746b9a913dcbf6086c9018d755505` |
| G0a | Expiry verifier deployed | code at the verifier address | yes | rejected, no tx | `Spec address 0x81413f0cF12e9b6a49B1D0439E081c577D57FfFf: no code. Devnet address 0x00000` |
| G0b | Two explicit msgs in four SECP256K1 entries, read in a SIGPARAM loop | admitted and mined | yes | [`0x33619e58194a...`](https://explorer.altmempool.wtf/tx/0x33619e58194af2d6a125f1053fc96bfbb4041e59c1e09030c6b1191b772084e8?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `{"shape":"SelfVerify","canonical":true,"violation":null}` |
| G0d | EXTCODEHASH of a contract that is no entity, in an unstaked sender's VERIFY | admitted and mined | yes | [`0x33619e58194a...`](https://explorer.altmempool.wtf/tx/0x33619e58194af2d6a125f1053fc96bfbb4041e59c1e09030c6b1191b772084e8?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `{"shape":"SelfVerify","canonical":true,"violation":null}` |
| G0e1 | [expiry_verify, self_verify] prefix | admitted and mined | yes | [`0x33619e58194a...`](https://explorer.altmempool.wtf/tx/0x33619e58194af2d6a125f1053fc96bfbb4041e59c1e09030c6b1191b772084e8?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `{"shape":"SelfVerify","canonical":true,"violation":null}` |
| G0e2 | [expiry_verify, only_verify, pay] prefix with a staked paymaster | admitted and mined | yes | [`0x14cca02fa170...`](https://explorer.altmempool.wtf/tx/0x14cca02fa17087cc1407efcaad5580ec50692d23c9c64bd376eb4cf3799d5430?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `{"shape":"OnlyVerifyPay","canonical":false,"violation":"StorageReadNonSender"}` |
| G0c | Signature gas counts toward the 100k cap | limits + signatures = 100,000 admitted; 100,001 refused | yes | [`0xa1807c2fab25...`](https://explorer.altmempool.wtf/tx/0xa1807c2fab2508e91ecf4dc49bdb3f19284723b92506b6ac66ba02c6c39083f9?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `validation prefix execution gas sum 88801 + signature-verification cost 11200 = 100001 e` |
| G0f | A transaction past its expiry | refused by the mempool | yes | rejected, no tx | `validation frame 0: reverted` |
| A7b | Expiry frame starved of gas | BadLayout: the account reads frame 0's status | yes | rejected, no tx | `validation frame 0: ran out of gas (the frame's gas limit 2000 cannot cover its entry ch` |
| B12 | Same signed content under a different nonce key | refused. A sequence belongs to its key and a key costs 20k more validation gas, so this stops before the account's Replayed guard, which Foundry proves | yes | rejected, no tx | `Invalid Transaction: Nonce mismatch: expected 0, got 16` |
| B14 | An approval left standing after the batch | APPROVALS_CLEARED fails, batch reverts, fee kept | yes | [`0x9020ee53bd74...`](https://explorer.altmempool.wtf/tx/0x9020ee53bd74b5dbf280c053c8fbdfa3a315f7a53f8a6ebd2d6b048713db4a74?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `AssertionFailed(0x5, 0x0, 0x5)` |
| S-HONEST | Stateless path: honest transfer, no paymaster, no stake | admitted by the public alt mempool and mined | yes | [`0x6c02ab0e64d4...`](https://explorer.altmempool.wtf/tx/0x6c02ab0e64d431bb3fb06765fd69657652ee65ca75b2935195c636b389f8c538?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| S-SWAP | Stateless path: v4 swap through the real Universal Router | mined, minimum output respected | yes | [`0x88a36457e904...`](https://explorer.altmempool.wtf/tx/0x88a36457e90407457523b6448a548e08ffe252398c211f4b6cb48ebdd88c54f9?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| S-WRAP | Stateless path: WRAP_ETH through the real Universal Router | mined | yes | [`0x8e1c146efbdc...`](https://explorer.altmempool.wtf/tx/0x8e1c146efbdc79924eaf46905f02e9a08a640e5a379f37a7c19948544e1e5c21?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `as expected` |
| S-A1 | Stateless: recipient swapped under an honest sentence | mempool reject: TreeMismatch | yes | rejected, no tx | `TreeMismatch(0x5287c64249142de7b4b8884f1b9587ba515936b837c1c600f3e8ebeac41a64a7, 0x9bd68` |
| S-A2 | Stateless: minOut=0 through SkimHook under an honest sentence | refused: rendering the hook does not fit the cap, and with room the reason is TreeMismatch | yes | rejected, no tx | `validation frame 1: reverted` |
| S-A2b | Stateless: the true SkimHook sentence | refused; with room to name it, the reason is PolicyRefused | yes | rejected, no tx | `validation frame 1: reverted` |
| B1 | NFT drainer through an unattested collection | rendered blind, policy refuses | yes | rejected, no tx | `PolicyRefused(0x3)` |
| B3 | Attestors signed this snapshot for another chain | refused: wrong D_snapshot | yes | rejected, no tx | `Invalid frame transaction signature` |
| B5 | A TOKEN leaf presented as a DESC | refused, not believed | yes | rejected, no tx | `TreeMismatch(0x313822324cc9980a09fbe5a9a280cac39d3dcf2a5307fb5acb93c4a5602291a8, 0xc8c4a` |
| B6 | Padding the signature list | refused | yes | rejected, no tx | `validation prefix execution gas sum 88800 + signature-verification cost 14000 = 102800 e` |
| B7 | Leaving the TOKEN proof out | refused | yes | rejected, no tx | `TreeMismatch(0x7158554bc6bc806c362943fc650b2166aa627c683890a50dc01105f727044327, 0xcf33b` |
| B9 | A far-future snapshot expiry | refused: over maxSnapshotTtl | yes | rejected, no tx | `SnapshotTtlTooLong(0x6270, 0x5460)` |
| B10 | A leaf revoked while the transaction is pending | still admitted; execution refuses: LeafRevoked | yes | [`0x7648e94253ad...`](https://explorer.altmempool.wtf/tx/0x7648e94253addbd850f0b46c7ace8b34fc1e4140467035addcbea75ac94c3d08?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `LeafRevoked(0x22e61d4357e953a3535e959bd22823a48244de605af1154ee837d3d793325c25)` |
| B11-A3 | Stateless: signing for one layout, sending another | refused, by the mempool's shape rule or the account's layout lock | yes | rejected, no tx | `frame transaction validation prefix not recognized` |
| B11-A7 | Stateless: stale signature | the expiry frame refuses it | yes | rejected, no tx | `validation frame 0: reverted` |
| B11-A7b | Stateless: expiry frame starved of gas | refused | yes | rejected, no tx | `validation frame 0: ran out of gas (the frame's gas limit 2000 cannot cover its entry ch` |
| S-B12 | Stateless: the same signed content again | refused | yes | rejected, no tx | `Invalid Transaction: Nonce mismatch: expected 14, got 13` |
| I13 | One digest executes at most once | consumed after landing | yes | [`0x3a30024ffe97...`](https://explorer.altmempool.wtf/tx/0x3a30024ffe97e3337677ca8fd10ea27663d2b1bcabad552d98b2bbfa86c6cc52?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `consumed true. The batch itself reverted, because B10 revoked this descriptor earlier in` |
| BENCH-N50 | 50 pending transactions, 50 senders: a trust update, then rotating the snapshot | refresh stops 0 on both; rotation stops all N on the paymaster path, 0 on the stateless path | yes | [`0xb109b44ea853...`](https://explorer.altmempool.wtf/tx/0xb109b44ea8534136bf48859896dd97bd7e0e15d141af043ffb81626244bf1e55?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) | `refresh: 0 paymaster, 0 stateless. Rotation: 50 paymaster, 0 stateless. SnapshotMismatch` |

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
| A8 | Lookalike ENS name | not in the snapshot, so hex is shown; the exclusivity proof refuses it | yes | rejected, no tx | `Execution reverted with reason: +Ă . Raw Call Arguments: to: 0x1f01041520e365f55be272af8` |
| B13 | An attestor missing from the ENS anchor | admitted; refused at execution: AttestorNotListed | yes | [`0x4e0614b79956...`](https://sepolia.etherscan.io/tx/0x4e0614b79956b1a43976a58c5b9950fdfadb0857948a7c9d88348bebb6af6758) | `AttestorNotListed(0x062D072F2Cd4E28659cdD434aD985dc5696d522C)` |
| B-ens-revoked | A leaf revoked by ENS record while the operation is pending | admitted; refused at execution: LeafRevokedInEns | yes | [`0x03675f840b41...`](https://sepolia.etherscan.io/tx/0x03675f840b417f1c6a2efac2cb8fb246155bb40603575dc12c685dde468aad9a) | `LeafRevokedInEns(0x855303e467745419d6be80bbb9f5d7c68f7286761e53355bcdffd7fd2506fdd1)` |
| B-A2-eoa | The evil route on an ordinary wallet, Sepolia | the skim works: this is what Verbatim prevents | yes | [`0xa479af0e2970...`](https://sepolia.etherscan.io/tx/0xa479af0e2970cb6d8ab10345ce69f080df92c61ede8f937d49a38417638ed791) | `as expected` |
| B-A2b | The same route, signed on the true sentence | the device shows the risks; PolicyRefused | yes | rejected, no tx | `! NO MINIMUM OUTPUT | ! HOOK CAN TAKE YOUR OUTPUT | ! UNVERIFIED HOOK || PolicyRefused; ` |
| WC | A dapp pairs over WalletConnect's relay; honest swap lands; the evil route shows its risks and is refused | lands; refused by PolicyRefused, with the account unmoved | yes | [`0x8ad5bcfa9b5f...`](https://sepolia.etherscan.io/tx/0x8ad5bcfa9b5fc681b8f6e17b0615f238a4ef8110646ada19c966a35dd9bce75c) | `as expected` |
| B-multihop | A two-hop v4 swap through the account | the sentence names the route, the swap lands, the output meets the signed minimum | yes | [`0x50b3d64920b7...`](https://sepolia.etherscan.io/tx/0x50b3d64920b75ab479cd79f5dd66f6cffa1e6ae40c00363ce9f8c284e18e840d) | `received 888635262729794, minimum 844203499593304, 2 hops` |
| B-UI-eoa | Uniswap's real interface, compromised at build: an ordinary wallet signs what the page sends | the page keeps the honest quote; the swap goes through the skim hook | yes | [`0x3a4d1b7c07a7...`](https://sepolia.etherscan.io/tx/0x3a4d1b7c07a7a7b059efe045b977f0f5f478f941d6e4dc8f8262a02dae1fb968) | `the page quoted 26.1892 USDC; the victim got 25749 dUSDC raw, the hook 2549055` |
| B-UI-verbatim | The exact calldata that page produced, handed to Verbatim | the device shows the risks; PolicyRefused | yes | rejected, no tx | `! NO MINIMUM OUTPUT | ! HOOK CAN TAKE YOUR OUTPUT | ! UNVERIFIED HOOK || PolicyRefused(5` |

**Refusals through a bundler:** a bundler reports a reverting validation as a generic error, so `B-A2b` reads the reason from the account itself (`contracts/scripts/live/why-evil.ts`).

ENS: publisher `verbatim-demo.eth`, trust anchor `verbatim-anchor.eth`. The anchor's attestor record was set in [`0xf810b825f4c0...`](https://sepolia.etherscan.io/tx/0xf810b825f4c03cd55bd46bfedbef0541b8d475c0969d380956dbaf75bc02e48e).

## In the browser

`contracts/scripts/e2e/demo.ts` drives the real pages through §20 against the live devnet, with the signer page's network cut after load. See `contracts/docs/demo/`.
