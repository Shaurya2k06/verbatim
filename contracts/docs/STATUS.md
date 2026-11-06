# Status against context.md

Where the build stands against `context.md`, gate by gate. A gate counts as passed only with a live transaction or rejection log in `contracts/docs/PROOFS.md`. Updated at each gate.

## Gates

| Gate | State | Evidence or what is left |
|---|---|---|
| G0 probes | **Done** | `G0a`-`G0f` in `PROOFS.md` |
| G1 paymaster upgrade | **Done** | A1-A18, B14 and F7 met on the final build on the public devnet, after its 6 November reset. 191 Foundry tests, 10k fuzz with 0 mismatches. B12 is refused by the chain before the account's guard, which Foundry proves (`DECISIONS.md`, D-A23) |
| G2 stateless path | **Done, one target missed by 485 gas** | Honest transfer, swap and wrap landed with no paymaster or stake. B1-B11 refused. A transfer needs a 90,485 prefix against the 90k target, and a swap 96,542; all fit the 100k cap. The skim hook is refused by gas inside the cap (D-A24). Coverage: the descriptors in `contracts/descriptors/`, proved for transfer, approve, swap and wrap |
| G3 Uniswap | **Done, except the form** | The real-interface attack: see below. Side by side on official Sepolia contracts (`B-A2-eoa`, `B-A2b`). A two-hop v4 swap landed through the account above its signed minimum (`B-multihop`): 929,953 transaction gas, with a bundler-reported `actualGasUsed` of 1,436,542. Hook X-ray built. WalletConnect wallet works over the real relay (`WC`). **The feedback form is yours to submit.** Upstream PR drafted in `contracts/docs/UPSTREAM.md`, not opened |
| G4 production | **Sepolia done; mainnet needs funds** | `VerbatimAccount4337` live through Pimlico and Alchemy. `deploy-l2.ts` ran end to end on throwaway local forks of Base and Optimism, and refuses to run without the right `CONFIRM_MAINNET`. A fork proves the deployment only: no snapshot exists for those chains and no operation ran there. The oracle and terms are written. Not deployed to an L2, and no funds at risk |
| G5 ENS anchor | **Done on Sepolia; hosted at verbatim-wallet.vercel.app/ens, on an older build until `main` is updated** | `B13`, `B-ens-revoked`, `A8`. `client/` has the `/ens` page and deploy config for Vercel and Render, and the page answers from a logged-out client |
| G6 measurement and standards | **Measured; posting is yours** | §16.3 is measured, in `ALTMEMPOOL.md`, including the N=50 bench. The findings and both ERC drafts are written, not posted. `SNAPSHOT.md` done. FrameReader and the patch tool are packaged, not published |
| G7 freeze | **Yours to finish** | Script, Q&A, offline fallback and video script done. Rehearsals and the final upload are yours |
| Hardware signer | **Not built** | Needs hardware in hand. The offline app remains the fallback |

## The real-interface attack

Done on Sepolia, through `Uniswap/interface` built from a clean checkout plus the malicious build step (`contracts/scripts/uniswap-evil`).

- The page quoted 26.19 USDC for 0.001 ETH, from the real Trading API ([screenshot](demo/evidence/uniswap-review.png)).
- The build step rewrote the transaction. An ordinary wallet signed it, the victim got 0.026 dUSDC and the hook took 2.55 (`B-UI-eoa`).
- The exact bytes the page produced, given to Verbatim: three risk lines on the device, then `PolicyRefused(56)` (`B-UI-verbatim`).

What the harness changes is in `DECISIONS.md`, D-A22. The one stub is token metadata for the selected pair, read from the chain.

## G0 results

All five probes passed on the live devnet, and the stateless design is feasible as specified.

| Probe | Result |
|---|---|
| (a) Expiry verifier | **Different address.** No code at the context's `0x81413f…FfFf`. The devnet has it at `0x…8141`: 8-byte data, reverts past the timestamp. The account takes the address as a constructor argument. A finding to file |
| (b) Explicit-`msg` entries in a SIGPARAM loop | Works: 4 SECP256K1 entries, 2 different `msg` values |
| (c) Signature gas counts toward 100k | Yes. Limits + signatures = 100,000 admitted, 100,001 refused |
| (d) EXTCODEHASH of a non-entity contract | Allowed for an unstaked sender |
| (e) Both prefixes with a leading expiry frame | Both mined. `[expiry_verify, self_verify]` is also valid for the canonical mempool |
| (f, added) Expired transaction | Refused by the mempool: "validation frame 0: reverted" |

**A failed expiry frame does not by itself stop a transaction.** With its gas limit below the 3,000 entry charge, frame 0 has status 0 and the node still mined the transaction. So a host could otherwise strip expiry. The account now requires frame 0's gas limit to cover the verifier (`BadLayout(8)`), tested in Foundry; the live `A7b` is pending the devnet. Reading the frame's status instead masked every revert reason: see `DECISIONS.md`, D-A19.

## Known conflicts in the design

**D9 and the 100k cap, for ERC-20 swaps.** No approval may outlive a batch, so an ERC-20 swap has to be `[permit2.approve, execute]` in one batch. Each extra call costs about 21k, and the budget does not hold two. Today:

- The honest swap and A2 use **native-ETH pools**: one call, no approval. On the official Sepolia contracts the victim got 0.0272 dUSDC and the hook 2.70, of a 0.001 ETH swap (`B-A2-eoa`, rerun 2026-11-06).
- `permit2.approve` alone now fails `APPROVALS_CLEARED`, which is exactly B14.
- An ERC-20 swap on the final build has not been measured, because it does not fit.

**A6.** For the same reason EvilVault can no longer hold a standing allowance, so a "hidden pull" cannot happen on a real account. The live A6 is now a vault that keeps the ETH and credits no shares. The hidden-pull case stays as a Foundry test with an out-of-band allowance and a watched token.

## Gas changes that made G1 fit

The first G1 build measured 99-109k. On the final build: 85.4k transfer, 89.0k approve, 90.6k swap (ETH in), 94.0k `permit2.approve`. See `DECISIONS.md`, D-A20. 

## Known rough edges

- **A multi-hop sentence reads oddly.** The route line is `Through: 0 dUSDC`, and pool fees show without saying which hop they belong to (`B-multihop`). It is accurate, and both renderers agree, but the wording needs a renderer change, which means a redeploy, so it waits for a reason to redeploy.
- **Six named guards have no test that asserts them by name:** `BadPath`, `BadSpec`, `SpecMismatch`, `SnapshotMissing`, `DescriptorHashMismatch` and `ChargeForcedToFail`, the last of which `F7` exercises live. Each effect check has a test (`contracts/test/Effects.t.sol`, and `test_shown_name_*` in `Stateless.t.sol`), and disabling any one of the ten post-call checks in a scratch copy fails at least one test.
