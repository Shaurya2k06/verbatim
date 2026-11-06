# Final report

The state of the build on 6 November 2026. Evidence for every claim is in [PROOFS.md](PROOFS.md), [GAS.md](GAS.md) and [DECISIONS.md](DECISIONS.md). Gate by gate: [STATUS.md](STATUS.md).

## Shipped

| Goal item | Status |
|---|---|
| 1. Leg A on the public EF devnet, not a local chain: honest transaction admitted and landed, attacks fail as specified | **Done, on the final build.** The devnet was reset to genesis on 6 November, and everything was redeployed and rerun after that |
| 2. Invariants tested, all tests pass | **Done.** 191 Foundry tests, 95 TypeScript tests, 10,000 fuzz cases with 0 mismatches between the Solidity and TypeScript renderers |
| 3. URRender: v4 swap, WRAP_ETH, hook-flag risks, honest swap lands, skim hook refused, standalone package | **Done.** Also a two-hop swap on Sepolia (`B-multihop`) |
| 4. Sepolia ERC-4337 leg on official Uniswap contracts, ENS as trust root, A8 | **Done,** through Pimlico and Alchemy |
| 5. README and all docs | **Done** |
| 6. Demo apps, demo script, fallback video | **Done.** 13 of 13 beats pass in a real browser with the signer offline, against the live devnet. The script writes `contracts/docs/demo/verbatim-demo.mp4` (176 s) |
| The real Uniswap interface attack, which `context.md` says never to cut | **Done on Sepolia** (`B-UI-eoa`, `B-UI-verbatim`). Recording: `contracts/docs/demo/uniswap-interface-attack.mp4`. What the harness changes: D-A22 |
| Stateless path | **Done,** on the public alternative mempool with no stake (`S-HONEST`, `S-SWAP`, `S-WRAP`, `B1`-`B11`) |
| Invalidation bench, N = 50 | **Done** (`BENCH-N50`): a refresh stops 0 on both paths. Rotating the snapshot stops 50 on the paymaster path and 0 on the stateless path |

All 69 rows in `PROOFS.md` meet their expected result. 45 of them are attacks stopped on a live network.

## Cut or not done, and why

- **Hardware signer.** First in the cut order, and it needs hardware in hand. The offline signer is a one-file web app.
- **L2 mainnet deployment and the live bounty (G4).** Needs your funded key, and `context.md` forbids going live before an outside red team signs off and attestor keys leave the team. `deploy-l2.ts` ran on local forks of Base and Optimism only.
- **ERC-20 swaps.** One call fits per transaction on the deployed sidecar, and an ERC-20 swap needs two. ETH-input swaps only (D-A21).
- **ERC-1271.** Off is the safe default, so it is always off.
- **ENS subnames and a multisig council.** `.eth` second-level names and one EOA council (D-A11).
- **Aderyn.** Slither was rerun on the final contracts and triaged. Aderyn was not run.

## Falsifiers

From the day-1 checks. The numbers were measured when each check ran, on earlier builds; current gas is below.

| # | Outcome |
|---|---|
| F0 | True |
| F1 | Cross-frame reads, F1b and F1c true. "`sig_hash` elides VERIFY data" is **false**, so signatures moved to protocol-validated entries bound by `txCommit` |
| F2 | **Partly false.** Own-storage reads work when staked, but the deployed sidecar caps the prefix at 100k regardless of stake. Render was rewritten to fit |
| F3 | True |
| F4 | True |
| F5 | True |
| F6 | True. Constants needed correcting (mask, params layout) |
| F7 | True (`F7` in `PROOFS.md`, rerun on the final build) |
| F8 | True: both bundlers, after tightening limits for Alchemy's 40% efficiency rule |

G0 probes, rerun after the reset: all pass. G2's target of a 90k prefix **is missed by 485 gas** on a transfer (90,485).

## Measured gas

Prefix against the 100,000 cap, including signatures:

| | Paymaster path | Stateless path |
|---|---:|---:|
| Transfer | 85,429 | 90,485 |
| v4 swap, ETH in | 90,588 | 96,542 |
| WRAP_ETH | 78,884 | 84,496 |

Execution, Sepolia and every other table: [GAS.md](GAS.md). The side-by-side of the two paths: [ALTMEMPOOL.md](ALTMEMPOOL.md).

## Known weaknesses a judge might probe

- **The bench revalidates; it does not watch a pool.** It re-runs validation through the sidecar's own simulator call, because the miner lands pending transactions within seconds.
- **The interface attack has one stub and a preset.** Token metadata comes from the chain, testnet mode is preset, and the page offers USDC while the skim pays dUSDC (D-A22).
- **`B12` stops before the account's guard on the live chain.** `consumed[]` is proven in Foundry (D-A23).
- **Inside the cap, the stateless path refuses a skim hook by running out of gas,** so no reason reaches the wallet (D-A24).
- **A multi-hop sentence reads oddly:** `Through: 0 dUSDC`, and fees without a hop. Fixing the wording means a redeploy.
- **Attestor keys are held by the team,** so there is no independent attestation yet.
- **`/suites` signs with two owner keys held on the server.** It is testnet only, and those keys must never guard real funds.
- **Six guards are not asserted by name in a test,** listed in `STATUS.md`. Each effect check is, and disabling any one of them fails a test.
- **Demo pools drift** as swaps sell into them, and an honest "at least 2000" then correctly fails.
- **`B10` leaves its revocation in place.** It revoked the transfer descriptor on the devnet, so a stateless transfer there now lands and reverts `LeafRevoked` until the next deployment. The stateless proofs ran before it.
- **The paymaster-path snapshot on the devnet expires at 12:51 UTC on 6 November.** After that, redeploy with `fresh-deploy.sh` before a devnet demo.
- **The devnet may reset again.** `contracts/scripts/live/fresh-deploy.sh` rebuilds it, and the addresses change. A snapshot lasts 6 hours: `refresh-snapshot.ts` re-signs Sepolia's.

## Remaining manual steps

These need you. Nothing here has been done for you.

1. **Make the repo public,** which the Uniswap and ENS tracks require.
2. **Submit the Uniswap feedback form,** https://developers.uniswap.org/hackathon-feedback, linking `FEEDBACK.md`. `context.md` says never to cut this.
3. **Update the hosted site.** https://verbatim-wallet.vercel.app answers logged out, but it serves commit `aa5dbf1`: 13 unmet rows and addresses from before the devnet reset. It updates when `main` does. Then check every link logged out: links into the repo stay broken until it is public.
4. **Upload the videos.** The two recordings above are captioned or silent screen captures, in git-ignored files. Record a main video if you want voice.
5. **Select prizes:** EF Frame Transaction Alternative Mempool, Uniswap Build, ENS Best Use of ENSv2.
6. **Rehearse three times,** once with a devnet failure handled live ([OFFLINE.md](demo/OFFLINE.md)).
7. **Post what is drafted, if you want it public:** the findings, both ERC drafts, and `UPSTREAM.md`. G6's exit asks for links in the README once they are posted.
8. **Rotate every key pasted into chat:** Pimlico, Alchemy, Etherscan, Reown, Uniswap and the Sepolia key.
9. **Check the AI-usage disclosure** if the event requires one.
10. **Only after an outside red team:** L2 deployment and the bounty, with attestor keys held outside the team.
