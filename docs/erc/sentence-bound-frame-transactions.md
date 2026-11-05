---
title: Sentence-Bound Frame Transactions
description: Bind what a signer read to what a frame transaction does, re-derived on chain during validation
author: Verbatim team
discussions-to: (none yet; to be posted on Ethereum Magicians)
status: Draft
type: Standards Track
category: ERC
requires: 712, 7730, 8141
---

## Abstract

An owner signs a canonical byte encoding of a human-readable sentence (a *tree*) and a list of post-conditions (a *spec*), not calldata. A renderer contract re-derives both from the real calldata in a VERIFY frame and refuses to pay on any difference. The account asserts the spec in execution.

## Motivation

Clear signing lives in wallets. Nothing on chain checks that what was shown matches what runs, so a tampered host can show one thing and send another. An offline device cannot judge calldata, but it can decode a small strict format.

## Specification

The key words MUST, MUST NOT and SHOULD are as in RFC 2119.

### Layout

A conforming transaction has exactly three frames:

| # | Mode | Target | Scope | Data |
|---|---|---|---|---|
| 0 | VERIFY | sender | EXECUTION | `verifyFrame(treeHash, specHash, validUntil)` |
| 1 | VERIFY | canonical renderer | PAYMENT | tree, spec and hints |
| 2 | SENDER | sender | none, value 0 | `executeVerified(fee, calls, spec)` |

The account's frame 0 MUST revert on any other count, mode, flag, target or frame 2 selector.

### Digest

Owners sign, under an EIP-712 domain with the chain ID and the account as `verifyingContract`:

```
VerbatimTx(bytes32 txCommit, bytes32 treeHash, bytes32 specHash, uint64 validUntil)
```

Signatures use protocol-validated SECP256K1 entries whose explicit `msg` is this digest. The account MUST check the count against its threshold, and each entry's scheme, `msg`, owner status and ascending signer order.

An explicit `msg` cannot contain `sig_hash`, since `sig_hash` covers it. So:

```
txCommit = keccak256(abi.encode(nonce, maxPriorityFee, maxFee,
           gas0, state0, gas1, state1, gas2, state2,
           keccak256(frame1.data), keccak256(frame2.data)))
```

A transaction with blob hashes or a keyed nonce MUST be refused rather than committed to.

### Tree and spec

The tree is `0x56540001 chainId(u64) account(20) validUntil(u64) Node*`; see [VTREE](../VTREE.md). The spec is `0x56530001 nItems(u16) Item*`; see [VSPEC](../VSPEC.md). Both encodings are deterministic: one input has one encoding.

Each call node MUST bind the descriptor hash and attestation version used. A tree MUST NOT contain a global trust epoch, because any trust update would then invalidate every pending transaction.

### Renderer

In frame 1 the renderer MUST recompute tree and spec from frame 2's calldata and refuse on any difference, or if its policy refuses a risk the tree contains. It MUST NOT read third-party state beyond what mempool rules allow.

### Execution

The account MUST charge the fee first, then in an inner call: reject if `block.timestamp > validUntil`, snapshot, run the calls, and assert the spec. Failure of the inner call MUST undo the batch and keep the fee. Return data copied from targets MUST be bounded.

### Device

A signing device MUST decode the tree itself, refuse unknown node types, over-length strings and out-of-charset strings, show risk lines first, and refuse a tree whose `validUntil` is past or too far ahead by its own clock.

## Rationale

- **An explicit digest over `sig_hash`.** A device cannot compute or check `sig_hash` from a sentence. Having it sign `sig_hash` would put a lying frontend back in charge.
- **Expiry in execution.** Validation cannot read TIMESTAMP. An expired transaction lands, reverts and pays.
- **A spec as well as a tree.** A true description of a call does not bound what the callee does.

## Backwards Compatibility

Requires EIP-8141. The same logic runs behind ERC-4337 with `userOpHash` in place of `txCommit`.

## Reference Implementation

This repository: `contracts/src/account/VerbatimAccount.sol`, `contracts/src/paymaster/RendererPaymaster.sol`, `contracts/src/lib/DisplayVM.sol`. Live results: [PROOFS](../PROOFS.md).

## Security Considerations

See [SECURITY.md](../../SECURITY.md). Assertions cover balances, allowances, operators and owners of tracked assets, not protocol-internal ledgers. Descriptor attestors, with an ENS publisher where one is used, can lie if they collude. Machine signers read nothing, so they gain nothing.

## Copyright

Copyright and related rights waived via CC0.
