# Upstream proposal (draft, not yet posted)

Posting is a public action, so this waits for a person. Suggested destination: `LedgerHQ/clear-signing-erc7730-registry`, with a copy to `Uniswap/universal-router`.

**Title: Clear signing for Universal Router and v4: on-chain decoder, and a gap in ERC-7730**

The registry has descriptors for Uniswap's V2 and V3 routers but none for the Universal Router or v4. ERC-7730's field model does not fit `execute(bytes commands, bytes[] inputs, uint256 deadline)` well, since each command byte selects the ABI of its input, and v4 nests a second dispatch inside that. So the most-used swap path remains blind-signed.

We built `URRender`, a standalone Solidity and TypeScript decoder (MIT, byte-identical under differential fuzzing, tested live against the deployed router), which emits a readable sentence and the balance effects it implies. It reads v4 hook risk from the hook's address bits.

Two questions:
1. Would command-dispatch support in ERC-7730, or a registered decoder reference, be welcome?
2. ERC-7730 has no notion of *effects*. We extended our subset with an `effects` section (`docs/VDESC.md`) so the chain can assert what a sentence promised. Is there interest in standardising something like it?

---

# Other prepared posts (not posted)

| What | Where it would go | Draft |
|---|---|---|
| Canonical-renderer rule, as a PR | `forshtat/mempool-workshop-sidecar` | [note](upstream/canonical-renderer-rule.md), [patch](upstream/canonical-renderer-rule.patch). Its fixture comes from an earlier build: regenerate it with `tools/scripts/canonical-renderer-proof.ts` before opening |
| Four rule findings and others | The track author, as an issue or note | [FINDINGS.md](FINDINGS.md) |
| ERC draft: sentence-bound frame transactions | Ethereum Magicians | [draft](erc/sentence-bound-frame-transactions.md) |
| ERC draft: signed attestation snapshots | Ethereum Magicians | [draft](erc/signed-attestation-snapshots.md) |
