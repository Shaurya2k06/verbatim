# Security

Hackathon code, unaudited. Do not trust it with funds you would miss.

## Threat model

**The attacker controls** the frontend, the host running it, the RPC, the relayer, and any target contract. They may also publish descriptors, deploy hooks and register lookalike names.

**They should not be able to** make a transaction land whose effects differ from the sentence the owners read, or take a tracked asset the sentence did not mention.

| Trusted | Untrusted |
|---|---|
| The device's decoder, screen and clock | Frontend, host, RPC, relayer |
| The owners' keys | Target contracts (their effects are asserted) |
| The attestor quorum and, on Leg B, the ENS publisher: both must collude to lie | Our TypeScript renderer (a mismatch fails closed) |
| The EVM, the EntryPoint, the protocol's signature recovery | Mempool operators (they can censor, not forge) |
| The ENS DAO and root (irreducible on Leg B) | |

## Invariants

| # | Statement | Where tested |
|---|---|---|
| I1 | A landed batch's calls render to the signed tree | `Invariants.t`, `Invariant.t` |
| I2 | Only what the sentence says leaves the account | `Invariant.t` |
| I3 | The signature binds the layout, fees, gas and frames | `Invariants.t`, `Invariant.t` |
| I4 | A landed transaction pays; no fee means nothing protected ran | `Invariants.t`, `Invariant.t`, A18 |
| I5 | A failed assertion undoes everything except the fee | `Invariants.t`, `Invariant.t` |
| I6 | Stale or lying transactions do not take effect | `Invariant.t` |
| I7 | Owners and threshold change only by a rendered `TRUST_CHANGE` | `Invariant.t` |
| I8 | The two renderers are byte-identical | `tools/difffuzz`, 10k cases per CI run |
| I9 | Validation reads only what §5 allows on each path | `Invariants.t`, `Stateless.t`, `Account4337.t` |
| I10 | A snapshot from another chain, past its TTL or expired is never accepted | `Stateless.t` |
| I11 | A revoked leaf never executes | `Stateless.t`, `Account4337.t` |
| I12 | No approval survives a batch, except Permit2 base allowances | `Attacks.t`, `Stateless.t` |
| I13 | The same `D_owner` can never execute twice | `Attacks.t`, `Stateless.t`, `Account4337.t` |

`Invariant.t.sol` runs 64 random sequences of 40 calls: honest transfers, lying recipients, stale signatures, EvilVault, refreshes, attempts to lower the epoch and to seize the account.

## Out of scope

- **Machine signers** (the Binance class). Nobody reads anything, so a sentence protects nothing.
- **Stolen owner keys.** They sign whatever they like.
- **Collusion** between a k-of-n attestor quorum and the ENS publisher. On the frames devnet there is no ENS, so attestors alone, and sentences there say so.
- **Untracked state and protocol-internal ledgers.** Assertions cover balances, allowances, operators and owners of tracked assets. A lending position inside a protocol is not visible to them.
- **Admin-parameter-dependent behaviour** of a target.
- **A sentence that is accurate but misunderstood.**
- **Off-chain signatures.** `isValidSignature` always fails.

## Other trust assumptions and limits

- Revocation takes effect at execution through `RevocationRegistry`, and ENS where it exists. In the mempool, a stateless transaction can stay valid until its snapshot expires. An EAS revocation on mainnet has no effect until attestors relay it.
- The paymaster is a shared service. Stake prices identity and is not slashed.
- The paymaster frame trusts the account frame's layout lock by pinning the sender's code hash.
- The expiry frame refuses an expired transaction at the mempool. Execution checks the time again. A starved expiry frame is refused by a gas floor on it.
- A snapshot lasts at most 6 hours by default. A paymaster-path transaction signs the root, so rotating the root drops pending ones on that path.
- The APPROVE opcode is a patched LOG1 byte. Deployment fails unless the runtime holds exactly one, and CI checks the same (`tools/scripts/check-bytecode.ts`).

## Static analysis

**This triage predates the final contracts. Rerun `make slither` before any funds are at stake.** [Slither](https://github.com/crytic/slither) over `contracts/src`, excluding informational findings, tests and `forge-std`. 60 findings, every one triaged by reading the code. Slither cannot parse the Yul `FrameReader`, so that file is removed for the run and is covered by the live proofs instead. To reproduce: `make slither`.

| Finding | Count | Verdict |
|---|---:|---|
| `return-bomb` in `protectedBatch` and `_execute` | 1 | **Real, fixed.** A target reverting with about 500 KB ran the outer call past its reserve, reverting the fee charge. Reproduced in `test_A18_return_bomb_does_not_undo_the_fee`, then return data was capped at 256 bytes. See D-A17 |
| `return-bomb` in `_liveChecks` | 1 | Accepted. That staticcall is limited to `READ_GAS`, so the copy is too, and it runs inside the protected call, whose failure only reverts the batch |
| `uninitialized-state` | 14 | False positive. `TrustStoreLayout` storage is written by `TrustAdmin` through delegatecall, which Slither does not follow |
| `constable-states` | 2 | False positive, same cause |
| `reentrancy-eth`, `reentrancy-no-eth` on `_phase` | 2 | False positive. `_phase` is the reentrancy guard itself: `PHASE_PROTECTED` is set before the calls and refuses reentry (A11) |
| `unchecked-transfer` | 2 | Intended. `EvilVault` is the demo attacker |
| `reentrancy-benign`, `reentrancy-events` | 4 | Accepted. Only `EvilVault`, `deposit` to a caller-chosen token crediting the caller's own balance, and the result event |
| `uninitialized-local` | 10 | False positive. Solidity zero-initialises these and the code relies on it |
| `unused-return` | 1 | Intended. `checkName` needs only the primary name from `reverse` |
| `write-after-write` in `_field` | 1 | False positive. `p` is read in between by `d.rdU8(p++)` |
| `missing-zero-check` | 10 | Accepted. Constructor arguments set at deploy, and an owner-chosen withdrawal address |
| `calls-loop` | 5 | Accepted. A batch's calls are the point; a failure reverts it. `refreshTrust`'s loops are bounded by the attestors' own update |
| `timestamp` | 5 | Intended. These are the expiry and delay checks, in execution only |
| `immutable-states`, `cache-array-length` | 2 | Optimisation only |

Aderyn was not run.

## Independent review

**Not done.** Nobody outside the authors has spent time on the attack kit. Per `docs/BOUNTY.md`, no funds go live until this is done and attestor keys are held outside the team.

## Reporting a bug

Open a private advisory on this repository, or contact the maintainers on GitHub. Please do not test against anyone else's funds.
