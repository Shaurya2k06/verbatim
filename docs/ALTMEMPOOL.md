# Verbatim on the alternative mempool

What we rely on, what we measured, and what we traded away. Rule IDs are ERC-8421's. Where the deployed sidecar differs from the draft, this says so, because we hit those differences head on.

## The shape

```
Paymaster path, this mempool                     Stateless path, any mempool
frame 0  VERIFY  expiry verifier                 frame 0  VERIFY  expiry verifier
frame 1  VERIFY  account    EXECUTION            frame 1  VERIFY  account   BOTH: renders from proofs
frame 2  VERIFY  paymaster  PAYMENT: renders     frame 2  SENDER  account   executeVerified(calls, spec)
frame 3  SENDER  account    executeVerified(calls, spec)
```

Both are prefixes the mempool recognises with a leading expiry frame (`G0e1`, `G0e2`). Owner signatures are protocol-validated SECP256K1 entries with an explicit `msg`. On the stateless path, attestors' signatures sit beside them.

## Why this needs the alt mempool

The stateless path does not need it, and exists so that nothing has to. On the paymaster path, the paymaster reads its own storage to render: descriptors, token info, fee tickets. The canonical mempool refuses that (ethrex reports `StorageReadNonSender` on every one of these transactions). ERC-8421 admits it for a staked entity. Live proof: the honest rows in `PROOFS.md`.

## Rules we rely on

| Rule | How |
|---|---|
| PREFIX-010 | The shapes above, enforced by the account's layout lock as well as the node |
| STORAGE-010 | The account frame reads only the sender's own storage: the policy word, attestor set hash, consumed digests |
| STORAGE-031 | The paymaster frame, a staked entity, reads its own storage |
| STAKING-010 | Paymaster staked through its own `stake()`, because the registry keys on `msg.sender`: 0.012 ETH, delay 86,400 s |
| CALLING-010 | Validation never touches an address with no code. Addresses claimed to have code come as signed hints, and everything else is asserted code-free at execution |
| OPCODES | No TIMESTAMP, NUMBER, BALANCE or GAS-then-not-a-call in our validation. The expiry verifier may read the time, and execution checks it again |
| SOLVENCY-010 | The paymaster's balance covers each transaction's maximum cost |

## Where the deployed sidecar differs (findings)

See [`FINDINGS.md`](FINDINGS.md): the flat 100k cap, `precompiles: []`, the expiry verifier's address, starved expiry frames, misleading revert data. Also, on the night of 5 November the gateway reported `peers: []` and held every sender's transactions at `New` while still answering "admitted". A client cannot tell from the admission response.

**A staked entity may read its own storage** (STORAGE-031 admits it, the canonical mempool says `StorageReadNonSender`), and that is the whole reason the paymaster path needs stake. [`upstream/canonical-renderer-rule.md`](upstream/canonical-renderer-rule.md) proposes admitting a recognised renderer without stake, with a patch.

## What fitting in 100k cost us

We built for the cap that exists instead of the one specified, so the system runs on the unmodified public mempool.

| Item | Declared limit | Note |
|---|---:|---|
| Expiry frame | 3,500 | |
| Account frame, paymaster path | 18,500 | |
| Paymaster frame | 72,400 | |
| Signatures | 5,600 | Counted in the cap |
| Total | 100,000 | Exactly the cap |

The stateless path declares 85,300 for its account frame, plus 11,200 for four signatures. Measured figures are in `GAS.md`. See also `DECISIONS.md`, D-A20.

**The trade-off is one call per transaction.** Each further call adds about 21.5k, so a two-call batch overflows, and with no standing approvals an ERC-20 swap needs two calls (`DECISIONS.md`, D-A21). Under BUDGET-010's 1M both would fit with no contract change: only the client's gas plan differs.

## Mass invalidation

One shared paymaster is a shared risk, so this is the central question. A pending transaction is invalidated only by:

- (a) the sender's own state changing;
- (b) revocation of a descriptor or hook **that transaction uses**;
- (b') on the paymaster path only, a rotated snapshot root, because the signature covers the root. This one is shared by every pending transaction on that path, and the N=50 bench still has to measure it. The stateless path has no such event: its snapshot travels in the transaction;
- (c) code appearing at an address it claimed empty (and a lying claim fails at execution anyway);
- (d) the sender's own fee ticket for that nonce being reclaimed, which only it can start, and which takes a delay.

Three design choices exist purely for this:

- **No third-party reads in validation.** No ENS, no proxy slots, no oracles, no token balances. Those checks move to execution.
- **Per-descriptor hashes in the tree (D5).** There is no global epoch: each call binds its own `descHash`.
- **Fees from a per-nonce ticket in the paymaster's own storage.** No token balance to race, and no two pending transactions share one: each nonce has its own prepaid amount (A14).

**Measured** (`INVALIDATION` in `PROOFS.md`): of 5 signed transactions, an unrelated `refreshTrust` that kept the root invalidated none, and revoking one descriptor invalidated exactly the one using it. **Limit of this measurement:** validation was re-run through `ethrex_simulateFrameTransaction`, the same call the sidecar makes. The five share a sender, so they were not all held pending in the mempool at once, and we did not observe the sidecar's own eviction.

## Other trade-offs

- **VERIFY frames are static, so Leg A cannot reserve a fee.** It prepays instead: `fundTickets` stores an amount per nonce, validation demands `ticket[nonce] >= amount >= TXPARAM max cost`, and the SENDER frame consumes it. Tickets are ETH only and cost one extra funding transaction, which is the price of pending transactions being independent.
- **Stake is not slashed.** It prices identity and nothing more (ERC-8421). A malicious staked renderer is limited by the account's code hash pin and by reputation, not by loss of stake.
- **Trust between frames.** The paymaster does not recheck the layout. It pins the sender's code hash, and that code enforced the layout in the account frame, which the protocol ran first. This saves gas and depends on that pin.
- **The APPROVE patch is a build step.** One LOG1 byte becomes APPROVE at deploy (`D-A3`), after checking exactly one LOG1 exists. It avoids DELEGATECALL in the account, at the cost of an unusual deploy path. A proper compiler target would remove it.
- **Single gas plan.** All transactions declare the same limits, so a fee is the same regardless of the sentence. Simple and legible, but slightly over-reserved.

## Keyed nonces, P256

Unused. `consumed[D_owner]` stops the same content under another nonce key, so keyed nonces are safe, and they are the natural next step for several independent pending sentences. P256 entries take raw digests, so passkeys do not fit (`FINDINGS.md`, d).
