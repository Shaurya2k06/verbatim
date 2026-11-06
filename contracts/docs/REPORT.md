# Final report

State of the build at the end of the run. Evidence for every claim: `contracts/docs/PROOFS.md`, `contracts/docs/GAS.md`, `contracts/docs/DECISIONS.md`.

## Shipped

| Goal item | Status |
|---|---|
| 1. Leg A on the public EF devnet (not Kurtosis): honest 3-frame tx admitted and landed; A1-A7, A9-A12 fail as specified | Done, each with a test and a live proof |
| 2. I1-I10 tested, all tests pass | Done. 62 Foundry tests, 48 TypeScript tests, 10k-case differential fuzz per CI run |
| 3. URRender: v4 swap, WRAP_ETH, hook-flag nodes checked against Hooks.sol, honest swap lands, minOut=0 SkimHook rejected, standalone package | Done |
| 4. Leg B: official Uniswap contracts, refreshTrust with ENS exclusivity, A8 | Done on Sepolia, via Pimlico and Alchemy |
| 5. README and all docs | Done |
| 6. Wallet, attack kit, swap demo, signer; §20 demo end to end; video script | Done. 10/10 beats pass in a real browser with the signer offline |

## Cut, and why

- **e-ink hardware.** Per the agreed cut order. The offline signer is a one-file web app.
- **ERC-1271 opt-in.** Off is the safe default, so it is simply always off.
- **Multi-call batches on the deployed sidecar.** Not cut from the code, but each call past the first overflows the deployed 100k cap. One call per transaction on Leg A.
- **ENS subnames, a multisig council.** `.eth` second-level names only, and an EOA council. See D-A11.
- **ERC-1155 and `getApproved` readers.** No v1 descriptor needs them.

## Falsifiers

| # | Outcome |
|---|---|
| F0 | True |
| F1 | Cross-frame reads, F1b and F1c true. "`sig_hash` elides VERIFY data" is **false**, so signatures moved to protocol-validated entries bound by `txCommit` |
| F2 | **Partly false.** Own-storage reads work when staked, but the deployed sidecar caps the prefix at 100k regardless of stake. Render was rewritten to fit |
| F3 | True: 62k |
| F4 | True |
| F5 | True |
| F6 | True: 68k for all of frame 1, against a 300k target. Constants needed correcting (mask, params layout) |
| F7 | True |
| F8 | True: both bundlers, after tightening limits for Alchemy's 40% efficiency rule |

Also found on the deployed sidecar: precompile calls are blocked (`precompiles: []`), and the gateway's gossip link dropped on the night of 5 November.

## Measured gas

| | Frame 0 | Frame 1 | Prefix with signatures |
|---|---:|---:|---:|
| Transfer | 19,376 | 62,213 | 87,189 |
| v4 swap | 19,972 | 68,249 | 93,821 |

Frame 2 depends on the account's history, because the assertion snapshot reads every ledger entry: a transfer measured 127,909 on a fresh account and 222,308 after the demo's approvals. Latest figures are in `contracts/docs/GAS.md`.

Sepolia `actualGasUsed` figures are in `contracts/docs/GAS.md`. Full tables in `contracts/docs/GAS.md`.

## Known weaknesses a judge might probe

- `ALTMEMPOOL.md` admits the revocation test re-ran validation through the simulator instead of observing the sidecar evict.
- More than 4 pending transactions from one sender could make `charge` fail on Leg A. Nothing protected would run, and the paymaster absorbs that gas.
- The resolver pin covers one resolver instance, so each publisher needs its own checker today.
- The APPROVE byte patch is a deploy step, not a compiler feature.
- Demo pools drift as swaps sell into them, and an honest "at least 2000" then correctly fails. `contracts/scripts/live/rebalance-pool.ts` restores them. Run it before a live demo if the pools have seen heavy use.
- The devnet may reset. `contracts/scripts/live/fresh-deploy.sh` then rebuilds it, and the addresses in the docs change.

## Remaining manual steps

1. **Make the repo public** and merge `build/verbatim` to `main` (Uniswap and ENS tracks require a public repo).
2. **Submit the Uniswap Developer Feedback Form**, https://developers.uniswap.org/hackathon-feedback, linking `FEEDBACK.md` on the public repo.
3. **Upload the video.** `contracts/docs/demo/verbatim-demo.mp4` (176 s, captioned, no voice) is a fallback; regenerate with `cd contracts/scripts/e2e && pnpm record`. It is git-ignored.
4. **Host a live demo** (ENS track requires a link). `client/apps/ens-demo`, `client/apps/wallet` and the rest are static: `pnpm --filter <app> build`, then upload `dist/`. The ENS page reads Sepolia with no keys.
5. **Select prizes:** EF Frame Transaction Alt Mempool, Uniswap Build, ENS Best Use of ENSv2.
6. **Check the AI-usage disclosure** if the event requires one. The README states it.
7. **Optionally post `contracts/docs/UPSTREAM.md`** to the ERC-7730 registry and Uniswap, which §11.5 asks for.
8. **Rotate the Pimlico, Alchemy and Etherscan keys, and retire the Sepolia key.** They were pasted into a chat session. They are in the git-ignored `.env` and not in git history.
9. **Raise the 100k cap with the alt-mempool team.** It is worth telling them, whether or not it changes anything.
