---
title: Canonical Renderer Rule for the Alternative Mempool
description: Admit a recognised renderer's reads of its own storage without stake
author: Verbatim team
discussions-to: (none yet; to be posted on Ethereum Magicians)
status: Draft
type: Standards Track
category: ERC
requires: 8141, 8421
---

## Abstract

A node may recognise paymasters by code hash. One it recognises may read its own storage during validation without stake, inside the ordinary validation budget.

## Motivation

ERC-8421 lets a staked entity read its own storage. A paymaster that renders transactions needs exactly that and nothing more, and its stake is not slashed: it prices identity. A code hash provides identity a node can inspect, so a shared public-good renderer need not lock capital.

## Specification

A node MAY keep a set `CANONICAL_RENDERERS` of code hashes. For a validation frame of role `payer` whose target's code hash is in the set, the storage rule is relaxed:

1. Reads of the target's own storage MUST be allowed without stake.
2. Any write to the target's own storage, including transient storage, MUST follow the unchanged rules.
3. Access to any other contract's storage MUST follow the unchanged rules.
4. All budget, opcode, code-access and prefix-shape rules MUST apply unchanged.

A node MUST read the code hash from state at the block it simulates against, not from anything the transaction claims.

## Rationale

Reads only, because a write in validation creates new invalidation channels between transactions. A local set rather than an onchain registry, because whose code to trust is each operator's judgement, as whitelists are today.

## Backwards Compatibility

Nodes with an empty set behave as before. Transactions admitted only by this rule propagate only among nodes that list the same hash.

## Reference Implementation

[`docs/upstream/canonical-renderer-rule.patch`](../upstream/canonical-renderer-rule.patch), with its evidence and limits in [the rule note](../upstream/canonical-renderer-rule.md).

## Security Considerations

A listed renderer's admin can invalidate that renderer's pending transactions by writing storage, so operators SHOULD list only code whose writes are gated and delayed, and SHOULD apply the usual reputation limits. Removing a hash stops admission and leaves transactions already in the pool to normal revalidation.

## Copyright

Copyright and related rights waived via CC0.
