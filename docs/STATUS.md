# Status against context.md

Every [SPEC] item in `context.md`, marked **done**, **partial** or **missing**. A gate counts as passed only with a live transaction or rejection log in `docs/PROOFS.md`. Updated at each gate.

## Gates

| Gate | State | Evidence or what is left |
|---|---|---|
| G0 probes | **Done** | `G0a`–`G0f` in `PROOFS.md`. See "G0 results" below |
| G1 paymaster upgrade | **In progress** | Contracts, twins, device and Foundry tests done; live matrix running |
| G2 stateless path | Missing | |
| G3 Uniswap | Partial | Honest swap, A2 and A2-eoa live. No real-interface attack, X-ray, upstream PR; v4 `SWAP_EXACT_IN` and measured v3 multi-hop missing |
| G4 production L2 | Missing | Deploying needs real funds; going live needs an external red team and outside attestor keys |
| G5 ENS anchor | Partial | Publisher exclusivity, recipient names and A8 exist, against the old Leg B. `EnsTrustAnchor`, attestor and revocation records, B13 missing |
| G6 measurement and standards | Partial | Small invalidation test only. Findings (b), (c) written; (a), (d) not. ERC drafts need rewriting. `SNAPSHOT.md` missing |
| G7 freeze | Missing | Demo script, Q&A cards, offline fallback, rehearsals, final videos |

**Leg B on Sepolia is behind the code.** The deployed contracts match the previous design and their proofs are still valid for it, but `VerbatimAccount4337` and `RendererPaymaster4337` were removed from the source in G1 because G4 replaces them with a stateless account. `legb-*.ts` will not run until then.

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

**A failed expiry frame does not by itself stop a transaction.** With its gas limit below the 3,000 entry charge, frame 0 has status 0 and the node still mined the transaction. So a host could otherwise strip expiry. The account now reads frame 0's status in its layout lock (`BadLayout(8)`), proved live as `A7b`. Another finding to file.

## Known conflicts in the design

**D9 and the 100k cap, for ERC-20 swaps.** No approval may outlive a batch, so an ERC-20 swap has to be `[permit2.approve, execute]` in one batch. Each extra call costs about 21k, and the budget does not hold two. Today:

- The honest swap and A2 use **native-ETH pools**: one call, no approval. The context's "28 USDC / 2,807 to the hook" figures came from the previous ERC-20 route and need re-measuring.
- `permit2.approve` alone now fails `APPROVALS_CLEARED`, which is exactly B14.
- ERC-20 swaps are attempted in G3, with the measurement recorded either way.

**A6.** For the same reason EvilVault can no longer hold a standing allowance, so a "hidden pull" cannot happen on a real account. The live A6 is now a vault that keeps the ETH and credits no shares. The hidden-pull case stays as a Foundry test with an out-of-band allowance and a watched token.

## Gas changes that made G1 fit

The first G1 build measured 99–109k. Now 85–91k. See `DECISIONS.md`, D-A20.
