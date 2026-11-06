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

A conforming transaction leads with an expiry frame. On the paymaster path:

| # | Mode | Target | Scope | Data |
|---|---|---|---|---|
| 0 | VERIFY | expiry verifier | none | 8-byte expiry |
| 1 | VERIFY | sender | EXECUTION | tree and spec hashes, root, path, policy, owners |
| 2 | VERIFY | canonical renderer | PAYMENT | hints, snapshot fields |
| 3 | SENDER | sender | none, value 0 | `executeVerified(calls, spec)` |

On the stateless path, frame 1 has scope BOTH and also carries the proofs, and frame 2 is the SENDER frame. The account's verifying frame MUST revert on any other count, mode, flag, target or selector, and MUST require frame 0's gas limit to cover the verifier, since a starved frame may not stop a transaction.

### Digest

```
D_owner = EIP712({name:"Verbatim", version:"11", chainId, verifyingContract: account},
  Tx(bytes32 treeHash, bytes32 specHash, uint64 expiry, bytes32 snapshotRoot, uint8 path, bytes32 txCommit))
```

Signatures use protocol-validated SECP256K1 entries whose explicit `msg` is this digest. Every verifier MUST rebuild the digest from its own render and require every owner entry's `msg` to equal it.

`txCommit` hashes as 32-byte words: chain ID, sender, nonce, max priority fee, max fee, frame count; for each frame mode, flags, target, value, gas limit, state gas limit, and the keccak of its data, with frame 1's blanked to zero; signature count, blob count. A transaction with blob hashes MUST be refused.

`consumed[D_owner]` MUST be checked in validation and set in execution, whatever the batch then does. This stops the same content under another nonce key.

### Tree and spec

The tree is `0x56540002 chainId(u64) account(20) expiry(u64) snapshotRoot(32) policyVersion(u32) path(u8) Node*`; see [VTREE](../VTREE.md). The spec is `0x56530002 nItems(u16) Item*`; see [VSPEC](../VSPEC.md). Both are deterministic. The tree's GUARANTEE nodes encode the spec byte for byte, so a device derives `specHash` itself.

Each call node MUST bind the descriptor hash used. A tree MUST NOT contain a global trust epoch.

### Renderer

In frame 1 the renderer MUST recompute tree and spec from frame 2's calldata and refuse on any difference, or if its policy refuses a risk the tree contains. It MUST NOT read third-party state beyond what mempool rules allow.

### Execution

The account MUST charge any fee first, then in an inner call: reject if `block.timestamp > expiry`, snapshot, run the calls, and assert the spec, including that no approval named in the batch survives it, except an ERC-20 base allowance to Permit2. Failure of the inner call MUST undo the batch and keep the fee. Return data copied from targets MUST be bounded.

### Device

A signing device MUST decode the tree itself, refuse unknown node types, over-length strings and out-of-charset strings, show risk lines first, show guarantees first, and refuse a tree whose expiry is past or too far ahead by its own clock.

## Rationale

- **An explicit digest over `sig_hash`.** A device cannot compute or check `sig_hash` from a sentence. Having it sign `sig_hash` would put a lying frontend back in charge.
- **An expiry frame, and a second check.** Only the canonical verifier may read the time in validation. An expired transaction is refused at the mempool, and execution checks again.
- **A spec as well as a tree.** A true description of a call does not bound what the callee does.

## Backwards Compatibility

Requires EIP-8141. The same logic runs behind ERC-4337 with `userOpHash` in place of `txCommit`.

## Reference Implementation

This repository: `contracts/src/account/VerbatimAccount.sol`, `contracts/src/paymaster/RendererPaymaster.sol`, `contracts/src/lib/DisplayVM.sol`. Live results: [PROOFS](../PROOFS.md).

## Security Considerations

See [SECURITY.md](../../SECURITY.md). Assertions cover balances, allowances, operators and owners of tracked assets, not protocol-internal ledgers. Descriptor attestors, with an ENS publisher where one is used, can lie if they collude. Machine signers read nothing, so they gain nothing.

## Copyright

Copyright and related rights waived via CC0.
