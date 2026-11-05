# A canonical-renderer rule for the alternative mempool

Draft for `forshtat/mempool-workshop-sidecar`. **Not yet opened as a PR**: posting is a public action and waits for a person. [`canonical-renderer-rule.patch`](canonical-renderer-rule.patch) applies to `2e22ff0`, and the fixture it needs is [`unstaked-renderer.json`](unstaked-renderer.json), to be copied to `packages/executor/test/fixtures/`.

## The rule

A node may list code hashes of canonical renderers (`canonicalRendererCodehashes`, or `CANONICAL_RENDERER_CODEHASHES`). A `payer` whose code hash is listed may **read** its own storage in validation without stake.

Unchanged: the 100k prefix budget, every opcode and code-access rule, and the stake requirement for writes, for associated slots on other contracts and for reads of other contracts' storage.

## Why

A paymaster that re-renders a transaction has to read its own descriptors, which is the only reason it needs stake. Stake here prices identity and is not slashed. For a known renderer, the code hash gives that identity more strongly: a node operator can read what it does. Its reads can only change when its own storage is written, so the invalidation surface is the set of transactions that use what gets revoked. We measured that in proof `A15`.

**What this costs.** Node operators choose which code to trust, so the list is a new thing to govern. A listed renderer whose admin writes storage at will could still invalidate its own pending transactions. Operators should only list code whose writes are gated, as `refreshTrust` is.

## Evidence

| Check | Result |
|---|---|
| Unstaked `RendererPaymaster` deployed on the public devnet | `0xeabcd3a670d343cef2cff9368157471c895dc2b4`, registry stake 0 |
| Public sidecar, same transaction | Refused: `unstaked payer accessed payer slot 0xfe14...46b5` (proof `CANONICAL-UNSTAKED`) |
| Fork's validator, that transaction and ethrex's real trace, hash not listed | Refused the same way |
| Fork's validator, same input, hash listed | **Admitted** to the standard mempool |
| Listed renderer that writes its own storage | Refused |
| A different code hash | Refused |

The fork's validator suite passes, 56 tests, 5 of them new.

**Limit of this evidence.** The fork was exercised at the validator, with a real simulation result as input, not as a running sidecar node relaying to a block. The transaction did not land through the fork.
