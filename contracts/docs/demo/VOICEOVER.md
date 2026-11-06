# Voiceover: `verbatim-tour.mp4`

The narration is in the film. This is its transcript, written by `contracts/scripts/e2e/site-tour.ts`, with each line's start time in the final cut (9:47 long). The voice is Kokoro (af_heart), synthesised locally.

The run that made it passed 16 of 16 checks and opened 11 transactions on an explorer. Waiting for blocks is sped up, with a badge saying by how much; nothing a line is spoken over is cut short.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00 | arrive /proofs | Here is the proof ledger. Each row is what a live network returned. We'll start on the EF frames devnet: EIP-8141 frame transactions, sent through the ERC-8421 alternative mempool. |
| 0:15 | proof · HONEST | An honest transfer on the paymaster path: four frames. Frame zero checks the expiry. Frame one is the account's VERIFY frame. Frame two is the paymaster's VERIFY frame, which renders the sentence from its cache in about sixty thousand gas. Frame three is the SENDER frame, which executes. |
| 0:33 | proof · HONEST | Why frames matter. The protocol validates the owners' signatures over an explicit message, so the account never calls ecrecover: it rebuilds the digest from its own render, and compares. A VERIFY frame reads the sender frame's calldata through the new introspection opcodes, which our FrameReader exposes to Solidity. |
| 0:53 | explorer · HONEST | Here it is on the alt-mempool explorer: on chain, with its four frames, their roles and their modes. |
| 1:00 | receipt · HONEST | Its receipt, read live from the devnet node: 4 frame receipts, every one with status one. The paymaster's TicketCharged event takes the fee from this nonce's ticket. The account's VerbatimResult says ok: every assertion held. And there's the token transfer itself. |
| 1:17 | proof · S-HONEST | The stateless path needs no paymaster and no stake: three frames. The account's VERIFY frame renders from Merkle proofs carried in the transaction itself. |
| 1:27 | explorer · S-HONEST | On the explorer: the expiry frame, the account's VERIFY frame, and the SENDER frame. |
| 1:33 | receipt · S-HONEST | Its receipt, read live from the devnet node: 3 frame receipts, every one with status one. The account's VerbatimResult says ok: every assertion held. And there's the token transfer itself. |
| 1:45 | proof · A1 | When the words are wrong, there's nothing to show on an explorer. Swap the recipient on the devnet, and the paymaster's validation frame reverts with SpecHashMismatch. It's refused before the mempool. |
| 1:57 | proof · B14 | This one was admitted and mined, then broke its promise: an approval left standing after the batch. APPROVALS_CLEARED requires every approval the batch names to be back at zero. |
| 2:09 | explorer · B14 | On the explorer it's on chain, like any other. The revert is inside, so let's read the receipt. |
| 2:15 | receipt · B14 | Its receipt, read live from the devnet node: 4 frame receipts, every one with status one. The paymaster's TicketCharged event takes the fee from this nonce's ticket. But the account's VerbatimResult says ok is false, with AssertionFailed, on item 5 of the spec: it expected 0, and found 5. The frame itself succeeds, because the batch runs in an inner self-call: its effects are rolled back, and the fee is kept. |
| 2:39 | proof · G0c | Why the alternative mempool matters. The paymaster reads its own storage during validation, which the canonical rules refuse. ERC-8421 admits it for a staked paymaster, under a flat hundred-thousand gas cap, and signature checks count toward it: a prefix at exactly one hundred thousand was admitted, and one gas more was refused. |
| 3:02 | proof · BENCH-N50 | And the shared-paymaster risk, measured: fifty signed transactions from fifty senders, on each path. Rotating the snapshot root would evict all fifty on the paymaster path, because their signatures cover the root, and none on the stateless path, which carries its snapshot inside each transaction. |
| 3:21 | ens | Now everything the site can run, live on Sepolia. First, ENS, the trust root for names. |
| 3:28 | ens · exclusivity proof | verbatim-demo.eth passes the exclusivity proof. ENSv2's argument-scoped roles show that exactly one party can write its clear-signing record: no root roles, no admin, and no way to swap the resolver. |
| 3:43 | ens · lookalike | Now the lookalike, verbatim-dem0.eth, with a zero. |
| 3:47 | ens · lookalike refused | It fails. So the device would show that address as hex, never as the name. |
| 3:52 | ens · resolved | And at execution, the real name resolves forward to its address and back again. That's why ENS matters here: it answers who you're paying, who published each descriptor, who may attest, and what's been revoked, and each answer is checked again when the transaction executes. |
| 4:09 | arrive /demo | Every case on the live demo runs through ERC-4337 on Sepolia. The server signs with two of the account's three owner keys, standing in for the offline device. |
| 4:20 | Live demo · Send 1 dUSDC | An honest transfer of one dUSDC to verbatim-demo.eth. The bundler simulates validation, which renders the sentence on chain and checks the owners' signatures over its hash. |
| 4:33 | explorer · Send 1 dUSDC | On the explorer: one user operation in the bundle, status success. |
| 4:37 | Live demo · Send 1 dUSDC · result | As expected: it landed, and the name was resolved forward and in reverse at execution, not at render. |
| 4:44 | Live demo · Swap the recipient | The Bybit attack. The owners sign a payment to verbatim-demo.eth, but the calldata pays the attacker. The chain renders the calldata again, so the recipient differs, and so does the hash of T. |
| 4:57 | Live demo · Swap the recipient · result | TreeMismatch, during validation. The bundler never broadcasts it: no transaction, and no fee. |
| 5:03 | Live demo · Empty the assertions | Here the sentence is honest, but the frontend strips the guarantees out of the spec. |
| 5:09 | Live demo · Empty the assertions · result | The digest the chain rebuilds no longer matches what the owners signed, so their signatures recover to unknown addresses: SignersNotSortedOrUnknown. |
| 5:19 | Live demo · Call an unattested contract | A call to a contract no attestor vouches for, with data no descriptor explains. |
| 5:25 | Live demo · Call an unattested contract · result | Unattested means unexplained, and there's no effects-only mode. PolicyRefused. |
| 5:31 | Live demo · Send after the expiry | This one is signed with a twenty-second expiry, and the host holds it until that passes. Every transaction carries a mandatory absolute expiry. On frames it's a dedicated expiry frame at index zero. Here it's checked in validation, and again at execution. |
| 5:48 | Live demo · Send after the expiry · result | Its expiry has passed, so it's refused before the mempool. |
| 5:53 | Live demo · Date the expiry far ahead | Now the opposite: a signature valid for hours, which is lasting authority over the account. The device refuses to sign it, so here it's signed anyway, the way a compromised device would. |
| 6:05 | explorer · Date the expiry far ahead | On the explorer, the transaction itself succeeds: the bundle ran, and the fee was paid. |
| 6:10 | explorer logs · Date the expiry far ahead | But open its logs. The account's VerbatimResult event has ok equal to false, and the error is TtlTooLong: 2.3 hours left on the signature, against a maximum of 5 minutes. Everything the calls did was rolled back. |
| 6:26 | Live demo · Date the expiry far ahead · result | Nothing moved. Only the fee was paid. |
| 6:29 | Live demo · Leave an approval standing | A truthful contract that does more than it says: it leaves a Permit2 approval standing after the batch. The sentence is honest, so it's admitted. |
| 6:38 | explorer · Leave an approval standing | On the explorer, the transaction itself succeeds: the bundle ran, and the fee was paid. |
| 6:43 | explorer logs · Leave an approval standing | But open its logs. The account's VerbatimResult event has ok equal to false, and the error is AssertionFailed, on item 5 of the spec. Everything the calls did was rolled back. |
| 6:55 | Live demo · Leave an approval standing · result | Batch reverted, and the fee is kept. |
| 6:59 | arrive /uniswap | Uniswap. Wallets blind-sign Universal Router calls, because no descriptor describes them. URRender decodes the router's commands and v4 actions on chain, inside validation. |
| 7:11 | Uniswap · Swap 0.0001 ETH on Uniswap v4 | An honest swap of 0.0001 ETH through Uniswap's official Universal Router on Sepolia, with a minimum output one percent under a fresh quote. |
| 7:23 | explorer · Swap 0.0001 ETH on Uniswap v4 | On the explorer: landed, status success. |
| 7:26 | Uniswap · Swap 0.0001 ETH on Uniswap v4 · result | The minimum output and the hook are in the signed sentence, and the amount received is asserted after the swap. |
| 7:33 | Uniswap · Reroute the swap | A compromised frontend shows that same swap, but routes it through a pool whose hook takes the output, with a minimum output of zero. |
| 7:41 | Uniswap · Reroute the swap · result | Rendered again on chain, the words differ: TreeMismatch. |
| 7:45 | Uniswap · Ordinary wallet | Why this matters for Uniswap: hooks are v4's biggest new risk surface. Here an ordinary wallet sends that rerouted swap. It has no way to object. |
| 7:55 | explorer · Ordinary wallet | It lands, and the hook takes nearly everything. We've done the same through Uniswap's real interface, compromised at build time. |
| 8:03 | Uniswap · Ordinary wallet · result | As expected, and that's the problem. |
| 8:06 | Uniswap · Verbatim, on the true sentence | Now Verbatim signs the true sentence for those same bytes. URRender reads the hook's permissions from the low bits of its address. That's pure arithmetic, so it's allowed during validation. |
| 8:17 | Uniswap · Verbatim, on the true sentence · result | The sentence says: no minimum output, this hook can take your output, unverified hook. PolicyRefused. |
| 8:25 | Uniswap · Allow a router command to fail | A router command with its allow-revert flag set, bit 0x80 of the command byte. It could fail silently while the rest of the batch runs on. |
| 8:34 | Uniswap · Allow a router command to fail · result | That raises a risk line, and the policy refuses it. |
| 8:38 | Uniswap · Use an unknown router command | A router command no descriptor explains, here a gasless permit. |
| 8:42 | Uniswap · Use an unknown router command · result | It renders as BLIND, and anything blind is refused. URRender ships standalone, in Solidity and TypeScript, fuzzed to stay byte-identical. |
| 8:55 | full demo | Finally, the full demo in order: an ordinary wallet, an honest swap, a lying frontend, a dangerous hook, and a contract that does more than it says. |
| 9:04 | explorer · full demo | The ordinary wallet's swap lands, and the hook takes the output. |
| 9:08 | explorer · full demo | The honest swap lands, status success. |
| 9:15 | explorer · full demo | On the explorer, the transaction itself succeeds: the bundle ran, and the fee was paid. |
| 9:20 | explorer logs · full demo | But open its logs. The account's VerbatimResult event has ok equal to false, and the error is AssertionFailed, on item 5 of the spec. Everything the calls did was rolled back. |
| 9:32 | full demo · the log | The log keeps every run. The lying frontend and the dangerous hook never got a transaction: both were refused before the mempool. |
| 9:41 | arrive /proofs?view=history | And every run stays on record, in the test history. |

**What runs where.** Everything run live in the film is on Sepolia, through ERC-4337. The frame transactions (EIP-8141, ERC-8421) are the proof ledger's records from the EF frames devnet: they are opened on the alt-mempool explorer and their receipts are read live from the devnet node, but they are not sent again during the film.

**Decoded panels.** Blockscout does not have the account's source, and the alt-mempool explorer does not show receipts, so the dark panels with a green border are added by the recording: decoded with the account's ABI, or read with `eth_getTransactionReceipt`. Each panel says so in its header.
