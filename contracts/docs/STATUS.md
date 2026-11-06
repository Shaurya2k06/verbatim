# Status against context.md

Where the build stands against `context.md`, gate by gate. A gate counts as passed only with a live transaction or rejection log in `contracts/docs/PROOFS.md`. Updated at each gate.

## Gates

| Gate | State | Evidence or what is left |
|---|---|---|
| G0 probes | **Done** | `G0a`-`G0f` in `PROOFS.md` |
| G1 paymaster upgrade | **Code done, live proofs pending** | 176 Foundry tests, 10k fuzz. **The public devnet stopped at block 408262.** `contracts/scripts/live/wait-devnet.sh` reruns everything when it moves. Until then the devnet rows in `proofs.json` are from older builds, and some show failures from a masked-revert bug since fixed |
| G2 stateless path | **Code done, live proofs pending** | Tests for B1-B11 pass. `stateless.ts` has the live cases. Same blocker. Coverage so far: the descriptors in `contracts/descriptors/`, proved for transfer, approve, swap and wrap |
| G3 Uniswap | **Partial** | Side-by-side live on official Sepolia contracts (`B-A2-eoa`, `B-A2b`). A two-hop v4 swap (ETH to dUSDC to dWETH) landed through the account with the output above its signed minimum (`B-multihop`): 929,953 transaction gas, with a bundler-reported `actualGasUsed` of 1,436,542. Hook X-ray built. WalletConnect wallet works over the real relay (`WC`). Real interface: see below. Upstream PR drafted in `contracts/docs/UPSTREAM.md`, not opened: the repo is private, so it would link to nothing |
| G4 production | **Sepolia done; mainnet needs funds** | `VerbatimAccount4337` live through Pimlico and Alchemy. `deploy-l2.ts` ran end to end on throwaway local forks of Base and Optimism, and refuses to run without the right `CONFIRM_MAINNET`. A fork proves the deployment only: no snapshot exists for those chains and no operation ran there. The oracle and terms are written. Not deployed to an L2, and no funds at risk |
| G5 ENS anchor | **Done on Sepolia, hosted link not confirmed** | `B13`, `B-ens-revoked`, `A8`. `client/` has the `/ens` page and deploy config for Vercel and Render, but no public URL is recorded and the deploys were not checked after the repo layout changed |
| G6 measurement and standards | **Partial** | Four findings and both ERC drafts written, not posted. `SNAPSHOT.md` done. The N=50 invalidation bench needs the devnet. FrameReader and the patch tool are packaged, not published |
| G7 freeze | **Partial** | Script, Q&A, offline fallback written. Rehearsals are yours. Final videos wait on the live run |
| Hardware signer | **Not built** | Needs hardware in hand. The offline app remains the fallback |

## The real-interface attack: how far it got

Working, with your Trading API key and Reown ID:

- `Uniswap/interface` builds and serves locally from a clean checkout, once references to its unpublished workspaces are removed (`contracts/scripts/uniswap-evil`, `DECISIONS.md` D-A22).
- The malicious build step loads in the page, and wraps the provider.
- The UI detects and connects a wallet, on testnet mode.
- Trading API calls succeed through the harness.

**Blocked:** selecting a token. The token selector and URL token lookup read Uniswap's data backend, which refuses a localhost origin and which the API key does not cover. So the UI has not yet shown a quote, and the attack has not run end to end through it. **Options:** a Uniswap data API key or allowed origin, or stubbing the data backend's responses in the harness, with that disclosed. The same route is proven without the UI, on the official contracts.

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
- An ERC-20 swap on the final build has not been measured.

**A6.** For the same reason EvilVault can no longer hold a standing allowance, so a "hidden pull" cannot happen on a real account. The live A6 is now a vault that keeps the ETH and credits no shares. The hidden-pull case stays as a Foundry test with an out-of-band allowance and a watched token.

## Gas changes that made G1 fit

The first G1 build measured 99-109k. The last measurement, before the devnet stopped: 85.2k transfer, 88.8k approve, 90.6k swap (ETH in). See `DECISIONS.md`, D-A20. The stateless path has not been measured live.

## Known rough edges

- **A multi-hop sentence reads oddly.** The route line is `Through: 0 dUSDC`, and pool fees show without saying which hop they belong to (`B-multihop`). It is accurate, and both renderers agree, but the wording needs a renderer change, which means a redeploy, so it waits for a reason to redeploy.
- **Some named guards have no test that asserts them by name:** `SignatureMalleable`, `SpecMismatch`, `Reentrant`, `NotLocked`, `NoGasReserve`, `ChargeForcedToFail`, `SnapshotMismatch`, `SnapshotMissing`, `WrongAttestors`, `AttestorsNotSorted`, `DescriptorHashMismatch`, `BadSignatureLength`, `BadFrame`, `BadPath`, `BadOwner`, `BadThreshold`, `BadSpec`, `NotOwner`, `ReadFailed`, `WatchFull`. Each effect check now has one (`contracts/test/Effects.t.sol`, and `test_shown_name_*` in `Stateless.t.sol`). Disabling any one of the ten post-call checks in a scratch copy fails at least one test; the live checks are asserted by their error names.
