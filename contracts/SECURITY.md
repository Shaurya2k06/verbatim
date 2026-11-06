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
| I8 | The two renderers are byte-identical | `contracts/scripts/difffuzz`, 10k cases per CI run |
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
- The APPROVE opcode is a patched LOG1 byte. Deployment fails unless the runtime holds exactly one, and CI checks the same (`contracts/scripts/live/check-bytecode.ts`).

## Static analysis

Slither 0.11 over `contracts/src` on the final contracts, excluding informational findings, tests and libraries: 78 results, none of them a new defect. Rerun with `make -C contracts slither`; it exits non-zero whenever there are results.

| Finding | Count | Verdict |
|---|---:|---|
| `return-bomb` in `_liveChecks` | 1 | Accepted. That staticcall is limited to `READ_GAS`, so the copy is too, and it runs inside the protected call, whose failure only reverts the batch. The earlier `return-bomb` in `protectedBatch` and `_execute` was real and is fixed: `_callBounded` keeps at most `MAX_RETURN` bytes (`test_A18_return_bomb_does_not_undo_the_fee`) |
| `uninitialized-state`, `constable-states` | 12, 6 | False positive. `TrustStoreLayout` storage is written by `TrustAdmin` through delegatecall, which Slither does not follow |
| `unchecked-transfer` | 2 | Intended. `EvilVault` is the demo attacker |
| `reentrancy-benign`, `reentrancy-events` | 2, 1 | Accepted. `EvilVault`, and `TrustAdmin.deposit`, where a caller-chosen token can only credit its own asset's balance |
| `uninitialized-local` | 17 | False positive. Solidity zero-initialises these and the code relies on it |
| `unused-return` | 1 | Intended. `checkName` needs only the primary name from `reverse` |
| `write-after-write` in `_field` | 1 | False positive. `p` is read in between by `d.rdU8(p++)` |
| `shadowing-local` | 1 | Harmless. `_verifyStateless` reads `maxSnapshotTtl` from the packed policy word, which holds the same value as the state variable it shadows |
| `missing-zero-check` | 18 | Accepted. Constructor arguments set at deploy, and an owner-chosen withdrawal address. A zero anchor is meaningful: it turns the ENS anchor off on chains without ENS |
| `calls-loop` | 7 | Accepted. A batch's checks are the point; a failure reverts it. `refreshTrust`'s loops are bounded by the attestors' own update |
| `timestamp` | 6 | Intended. Expiry and delay checks, in execution and admin paths. None is in validation |
| `immutable-states`, `cache-array-length` | 1, 2 | Optimisation only. Not changed: each would alter the deployed bytecode for a few gas |

Aderyn was not run.

## Independent review

**Not done.** Nobody outside the authors has spent time on the attack kit. Per `contracts/docs/BOUNTY.md`, no funds go live until this is done and attestor keys are held outside the team.

## Reporting a bug

Open a private advisory on this repository, or contact the maintainers on GitHub. Please do not test against anyone else's funds.
