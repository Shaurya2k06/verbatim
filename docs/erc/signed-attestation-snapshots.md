---
title: Signed Attestation Snapshots for Stateless Validation
description: Carry attested data as protocol-validated signature entries and Merkle proofs, so validation reads no global state
author: Verbatim team
discussions-to: (none yet; to be posted on Ethereum Magicians)
status: Draft
type: Standards Track
category: ERC
requires: 712, 8141, 8421
---

## Abstract

A k-of-n attestor set signs the root of a sorted Merkle tree of typed facts. A transaction carries the attestors' signatures as protocol-validated entries with an explicit `msg`, and proofs of the leaves it uses in frame data. Validation then reads no global state, so updating trust data invalidates no pending transaction.

## Motivation

A shared on-chain registry read in validation is a shared invalidation surface: one write can drop every transaction that depends on it, and the mempool has to track that. Signed data avoids this, and EIP-8141's explicit-`msg` entries let the protocol check the signatures before any frame runs.

## Specification

The key words MUST, MUST NOT, SHOULD and MAY are as in RFC 2119.

### The tree

Leaves are typed. With `key` and `value` as 32-byte words:

```
order = keccak(type ‖ key)
leaf  = keccak(0x00 ‖ type ‖ key ‖ value)
node  = keccak(0x01 ‖ left ‖ right)
```

Leaves MUST be sorted by `order`, between sentinels of order 0 and 2^256-1, padded with zero to a power of two. Depth MUST NOT exceed 20. Keys SHOULD include a chain ID.

**Presence** is a Merkle path. **Absence** is two verified leaves with consecutive indices whose orders bracket the key.

### The statement

```
D_snapshot = EIP712({name:"VerbatimSnapshot", version:"1", chainId},
  Snapshot(bytes32 root, uint64 issuedAt, uint64 expiry, uint16 schema))
```

Attestors sign `D_snapshot` in SECP256K1 entries whose explicit `msg` is it. A verifier MUST check the entry count exactly, each signer's membership and ascending order, and `msg`.

### Freshness

A verifier MUST require `txExpiry ≤ expiry`, and `expiry − issuedAt ≤ maxTtl` from its own storage. Neither reads the clock, so both are allowed in validation. The transaction's own expiry is enforced by an expiry frame.

### Revocation

A leaf left out of the next snapshot lapses at `expiry`. For immediate effect a registry keyed by leaf hash MAY be consulted at execution. It MUST NOT be read in validation, and it MUST NOT be able to authorize anything.

## Rationale

Omitting a proof must only be able to refuse or show less; a verifier MUST treat a missing proof of something a transaction needs as a refusal. The cost is transaction size and a bound on revocation latency in the mempool: both are measured in the reference implementation's `docs/ALTMEMPOOL.md`.

This generalises beyond renderers to sponsors and oracles: anything attested that validation needs to know.

## Backwards Compatibility

Requires EIP-8141 explicit-`msg` entries. Under ERC-4337 the same data travels in `userOp.signature`, verified with `ecrecover`.

## Reference Implementation

`packages/snapshot-cli`, `contracts/src/lib/SnapshotVerifier.sol`, `contracts/src/stateless/`, and [SNAPSHOT.md](../SNAPSHOT.md).

## Security Considerations

A captured quorum can mislabel anything the tree holds, up to `expiry`. Keep TTLs short and attestors independent. Attestors should not sign leaves they have not checked against the code they name.

## Copyright

Copyright and related rights waived via CC0.
