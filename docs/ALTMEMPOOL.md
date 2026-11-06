# Verbatim on the alternative mempool

What we rely on, what we measured, and what we traded away. Rule IDs are ERC-8421's. Where the deployed sidecar differs from the draft, this says so, because we hit those differences head on.

## The shape

```
frame 0  VERIFY  target = account    flags = EXECUTION   only_verify
frame 1  VERIFY  target = paymaster  flags = PAYMENT     pay
frame 2  SENDER  target = account    executeVerified(fee, calls, spec)
```

This is the `[only_verify, pay]` prefix of PREFIX-010. Owner signatures are two protocol-validated SECP256K1 entries with an explicit `msg`.

## Why this needs the alt mempool

The paymaster reads its own storage to render: descriptors, token info, policies, fee tickets. The canonical mempool refuses that (ethrex reports `StorageReadNonSender` on every one of these transactions). ERC-8421 admits it for a staked entity. Live proof: the honest rows in `PROOFS.md`.

## Rules we rely on

| Rule | How |
|---|---|
| PREFIX-010 | The exact shape above, enforced by the account's layout lock as well as the node |
| STORAGE-010 | Frame 0 reads only the sender's own storage: threshold and owners |
| STORAGE-031 | Frame 1, a staked entity, reads its own storage |
| STAKING-010 | Paymaster staked through its own `stake()`, because the registry keys on `msg.sender`: 0.012 ETH, delay 86,400 s |
| CALLING-010 | Validation never touches an address with no code. Addresses claimed to have code come as signed hints, and everything else is asserted code-free at execution |
| OPCODES | No TIMESTAMP, NUMBER, BALANCE or GAS-then-not-a-call in validation. Expiry is checked in execution |
| SOLVENCY-010 | The paymaster's balance covers each transaction's maximum cost |

## Where the deployed sidecar differs (findings)

These are the most useful thing we can hand the track. All reproduced live; see `FEEDBACK.md` and `DECISIONS.md`.

1. **Flat 100k prefix cap, staked or not.** ERC-8421's BUDGET-010 gives a staked entity 1,000,000 and the landing page says 2,500,000. The deployed `validationPrefix.ts:288` applies a single `MAX_VERIFY_GAS = 100,000` to the whole prefix, including signature cost. A probe paymaster staked with 0.012 ETH was refused at 120k.
2. **`precompiles: []` blocks ecrecover.** CALLING-040 allows core precompiles. The deployed config treats 0x01 as an undeployed contract, so a bespoke-signature wallet cannot call `ecrecover`. We moved signature recovery to protocol-validated entries.
3. **Gateway gossip link can drop.** On the night of 5 November the gateway reported `peers: []` and held every sender's transactions at `New` while still answering "admitted". The miner's sidecar still worked. A client cannot tell from the admission response.

Also still true on the deployed sidecar: **a staked entity may read its own storage** (STORAGE-031 admits it, the canonical mempool says `StorageReadNonSender`), and that is the whole reason this design needs stake. [`docs/upstream/canonical-renderer-rule.md`](upstream/canonical-renderer-rule.md) proposes admitting a recognised renderer without stake, with a patch.

## What fitting in 100k cost us

We built for the cap that exists instead of the one specified, so the whole system runs on the unmodified public mempool.

| Item | Measured | Note |
|---|---|---|
| Frame 0 | about 19.5k | Limit 20,500 |
| Frame 1, transfer | about 62k | Limit 73,700 |
| Frame 1, v4 swap | about 68k | The target was up to 300k |
| Signatures | 5,600 | Counted in the cap |

**The trade-off is one call per transaction.** Each further call adds about 21.5k to frame 1, so a two-call batch overflows. Under BUDGET-010's 1M, batches up to the renderer's limit of 16 would fit. The design is ready for that with no contract change: only the client's gas plan differs. See `GAS.md`.

## Mass invalidation

One shared paymaster is a shared risk, so this is the central question. A pending transaction is invalidated only by:

- (a) the sender's own state changing;
- (b) revocation of a descriptor or hook **that transaction uses**;
- (c) code appearing at an address it claimed empty (and a lying claim fails at execution anyway);
- (d) the sender's own fee ticket for that nonce being reclaimed, which only it can start, and which takes a delay.

Three design choices exist purely for this:

- **No third-party reads in validation.** No ENS, no proxy slots, no oracles, no token balances. Those checks move to execution.
- **Per-descriptor hashes in the tree, not a global root (D5).** The tree has no global epoch at all: each call binds its own `descHash` and attestation version. An early draft used the store's epoch, and any refresh would have invalidated the whole pool.
- **Fees from a per-nonce ticket in the paymaster's own storage.** No token balance to race, and no two pending transactions share one: each nonce has its own prepaid amount (A14).

**Measured** (`INVALIDATION` in `PROOFS.md`): of 5 signed transactions, an unrelated `refreshTrust` invalidated none, and revoking one descriptor invalidated exactly the one using it. **Limit of this measurement:** validation was re-run through `ethrex_simulateFrameTransaction`, the same call the sidecar makes. The five share a sender, so they were not all held pending in the mempool at once, and we did not observe the sidecar's own eviction.

## Other trade-offs

- **VERIFY frames are static, so Leg A cannot reserve a fee.** It prepays instead: `fundTickets` stores an amount per nonce, validation demands `ticket[nonce] >= amount >= TXPARAM max cost`, and frame 2 consumes it. Tickets are ETH only and cost one extra funding transaction, which is the price of pending transactions being independent.
- **Stake is not slashed.** It prices identity and nothing more (ERC-8421). A malicious staked renderer is limited by the account's code hash pin and by reputation, not by loss of stake.
- **Trust in frame 1.** The paymaster does not recheck the layout. It pins the sender's code hash, and that code enforced the layout in frame 0, which the protocol ran first. This saves gas and depends on that pin.
- **The APPROVE patch is a build step.** One LOG1 byte becomes APPROVE at deploy (`D-A3`), after checking exactly one LOG1 exists. It avoids DELEGATECALL in the account, at the cost of an unusual deploy path. A proper compiler target would remove it.
- **Single gas plan.** All transactions declare the same limits, so a fee is the same regardless of the sentence. Simple and legible, but slightly over-reserved.

## Keyed nonces, recent roots, P256

Refused or unused. `nonce_keys` must be `[0]`, because frame 0 refuses anything else rather than commit to it. A keyed nonce per signing session would let one account have several independent pending sentences, and is the natural next step.
