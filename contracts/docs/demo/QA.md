# Q&A cards

**"ADR-050 already does this."** ADR-050 is the same core move and we credit it: the chain regenerates what the signature covers. It handles fixed message types. Verbatim handles arbitrary EVM contracts through code-pinned descriptors, rejects at the mempool, and asserts effects after the calls.

**"What about Kampela's ERC, or ERC-8283?"** Kampela's checks a display ID inside the target contract, so the target must opt in and is trusted. Verbatim renders outside the target and checks what it did. ERC-8283 is a registry for descriptors and attestations: complementary, and our snapshots could be built from it.

**"Why the mempool, and not just reverts?"** Lies about the sentence never land, so nobody pays and nothing is exposed. Lies about effects can only be seen by running them: those revert and the user pays only gas.

**"Who attests?"** A k-of-n quorum, compatible with ERC-8176. A captured quorum can mislabel spenders, tokens or names. It cannot change the amounts in signed guarantees, the no-standing-approvals rule, or execution-time revocation. On Sepolia, ENS records govern who may attest.

**"What about Binance?"** Out of scope, and we say so first. Machine signers read nothing, so a sentence protects nothing.

**"Gas?"** Point to `contracts/docs/GAS.md`. Everything there comes from receipts or traces. The honest limit is one call per transaction under the deployed sidecar's flat 100k.

**"So no ERC-20 swaps?"** Not on this node yet. No standing approvals means `permit2.approve` and the swap share a batch, and two calls do not fit 100k. ETH-input swaps fit today. Under the specified 1M for staked entities, ERC-20 fits with no contract change. It is in our findings.

**"Before Hegotá?"** The ERC-4337 leg works today on any bundler: no paymaster, no stake. Sepolia proofs exist through Pimlico and Alchemy.

**"Is the Uniswap UI really unmodified?"** Say exactly what `DECISIONS.md` D-A22 says, including what the harness had to stub.

**"Audited?"** No. See `SECURITY.md`, including what has not been reviewed independently.
