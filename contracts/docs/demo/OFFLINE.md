# When the network fails

Every beat has something to show without a live chain. `contracts/docs/PROOFS.md` holds the links, `contracts/docs/proofs.json` the raw results.

| Beat | Fallback |
|---|---|
| Whole demo | `contracts/docs/demo/verbatim-demo.mp4` |
| The evil route, side by side | `B-A2-eoa` and `B-A2b` in PROOFS: Sepolia, official contracts |
| A lying sentence is refused | `A1`, `A2`, `S-A1`, `B-A1`: the exact revert text |
| The contract does more than it says | `A6`, `B14`: transaction and `AssertionFailed` |
| The live demo (`/suites`) | The attack table in PROOFS, plus `pnpm --filter @verbatim/signer dev` on a phone: the device still decodes and refuses offline |
| ENS | `B13`, `B-ens-revoked`, `A8`. `client/apps/ens-demo` reads Sepolia, which is separate from the devnet |

**The devnet's explorer keeps history in memory only**, and the devnet can reset, so its links can die. The log in `proofs.json` is the durable copy. Sepolia links do not have this problem.

**Handling a failure live:** say "the public devnet has stopped, so here is the same run recorded", switch to the video, and carry on. It stalled for over 80 minutes during the build, so this is worth rehearsing.
