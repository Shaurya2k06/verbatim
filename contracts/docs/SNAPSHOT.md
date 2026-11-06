# Snapshots

All trust data lives in one snapshot: a sorted Merkle tree signed by a k-of-n attestor set. The stateless path carries proofs in the transaction. The paymaster path caches the root and leaves. `packages/snapshot-cli` and `contracts/src/lib/SnapshotVerifier.sol` are the two halves, held together by `contracts/vectors/snapshot.json`.

## Leaves

| Type | Key | Value |
|---|---|---|
| 1 DESC | chainId, codehash, selector | descHash, publisher, status. The descriptor's bytes travel with the proof |
| 2 TOKEN | chainId, address | packed symbol, decimals, riskFlags. Any flag refuses the token |
| 3 HOOK | chainId, codehash | attestFlags |
| 4 NAME | chainId, address | packed name, resolver |
| 5 PROXY | chainId, codehash | upgrader, logic code hash, implementation, getter |
| 6 ROUTER | chainId, codehash | kind: 1 current layout, 3 older layout |
| 7 SPENDER | chainId, address | 1 |

ROUTER and SPENDER are additions to context.md §6; see `DECISIONS.md`, D-A19.

## Hashing

```
order:  keccak(type ‖ key words)
leaf:   keccak(0x00 ‖ type ‖ key words ‖ value words)
node:   keccak(0x01 ‖ left ‖ right)
```

The leading byte keeps a node from being replayed as a leaf. Leaves sort by order hash, between a low sentinel (type 0, order 0) and a high one (type 255, order all ones), so every gap has two neighbours. Unused positions up to the next power of two hold zero. Depth is at most 20.

## Proofs

Frame 1 carries `depth(1)`, then for each leaf the render used:

```
type(1) index(2) nKey(1) nValue(1) vdescLen(2) key words, value words, path(depth words), vdesc
```

**Presence** is that path. **Absence** is two leaves with consecutive indices whose order hashes bracket the key. A host leaving a proof out can only make the render refuse, or show an address as hex, so absence proofs are optional on this path.

## The attestors' statement

```
D_snapshot = EIP712({name:"VerbatimSnapshot", version:"1", chainId},
  Snapshot(bytes32 root, uint64 issuedAt, uint64 expiry, uint16 schema))
```

Owner signatures come first in the transaction's entries, attestors' after. Validation checks `expiry ≤ expiry_s` and `expiry_s − issuedAt ≤ maxSnapshotTtl` (default 6 hours) without reading the time.

## Revocation

1. **Leave the leaf out of the next snapshot,** at most one TTL away.
2. **`RevocationRegistry`:** keyed by leaf hash, written by an attestor quorum, read only at execution. It can stop a batch and can authorize nothing.
3. **ENS, where it exists:** the `revoked` record on the anchor name, checked at the same moment.

## A snapshot expires

With a 6-hour TTL, a demo left overnight refuses everything. On Sepolia, rerun `legb-deploy.ts` to reissue. On the devnet, rotating the root invalidates pending paymaster transactions, because they signed it. Measuring that is the job of the invalidation bench.
