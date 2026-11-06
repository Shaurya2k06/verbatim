# VSPEC v2: guarantees

What must be true after the batch runs. `specHash = keccak256(spec)` is signed alongside the tree. Written during render (`VSpec` in `contracts/src/lib/VTree.sol`) and evaluated by `VerbatimCore` (`contracts/src/account/VerbatimAccount.sol`).

```
Spec := 0x56530002 nItems(u16) Item*
Item := op(u8) args
```

| Op | Name | Args | Check |
|---|---|---|---|
| 0x01 | DELTA_EQ | holder(20) asset(20) delta(int256) | `post - pre == delta`. Asset `0x0` is ETH |
| 0x02 | DELTA_GE | holder(20) asset(20) min(uint256) | `post >= pre + min` |
| 0x03 | ALLOW_LE | token(20) spender(20) max(uint256) | ERC-20 allowance at most `max` |
| 0x04 | P2ALLOW_LE | permit2(20) token(20) spender(20) max(uint160) | Permit2 allowance at most `max`. A swap states 0 |
| 0x05 | OPERATOR_EQ | collection(20) operator(20) bool(u8) | `isApprovedForAll` equals it |
| 0x06 | OWNER_EQ | collection(20) id(32) owner(20) | `ownerOf(id)` equals it |
| 0x07 | CODEHASH_EQ | target(20) hash(32) | checked before and after the calls |
| 0x08 | NO_CODE | addr(20) | checked before and after the calls |
| 0x09 | TRACKED_NO_DECREASE | | every tracked asset no delta names: `post >= pre` |
| 0x0A | TRACKED_NO_ALLOW_INC | | every ledger approval the spec does not name: `post <= pre` |
| 0x0B | ACCOUNT_INVARIANT | allowTrustChange(u8) | owners, threshold, own code and policy unchanged, unless 1 |
| 0x0C | APPROVALS_CLEARED | | every approval the batch names is back at zero, except an ERC-20 base allowance to Permit2 |
| 0x0D | IMPL_EQ | target(20) getter(4) impl(20) | added: a proxy's implementation, read live at execution |
| 0x0E | NAME_EQ | addr(20) resolver(20) packedName(32) | added: a shown name still resolves forward to `addr` (Leg B) |

**Changes from §8.4, and why.** `P2ALLOW_LE` gained a mode, because "pre minus amount" cannot be computed at render without reading third-party state. `ACCOUNT_INVARIANT` gained an argument, so a `TRUST_CHANGE` sentence can be honest about changing owners. `IMPL_EQ` and `NAME_EQ` carry the live re-checks of §6.3 and §12.3 as data. ERC-1155 and `getApproved` readers from §7.5 are not built, because no v1 descriptor uses them.

## Ordering and merging

Deterministic, so the two renderers agree: deltas in first-seen order, then other items in encounter order, then 0x09, 0x0A, 0x0B, 0x0C.

Effects on the same `(holder, asset)` merge: EQ sums with EQ and GE with GE. Mixing them fails closed (`ConflictingEffects`). At most 8 distinct deltas.

## Tracked set

ETH, every token in the approval ledger, the watchlist, and every token named by a delta. So a token enters the tracked set the moment any verified batch approves it, which is what catches EvilVault: the old dWETH approval put dWETH in the ledger.

A failed read fails the assertion. Each read is a STATICCALL with 100,000 gas.

## Forward compatibility

Each item maps to an EIP-7906 `TXDIFF`-based POST_TX check. The in-account snapshot is an emulation until that ships.

## The tree carries the spec

The spec is the tree's GUARANTEE section, byte for byte. So a device computes `specHash` from what it displayed, and never takes it from the host.
