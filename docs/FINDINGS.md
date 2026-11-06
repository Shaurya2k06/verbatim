# Findings for the ERC-8421 author

Ready to file; none has been posted. Reproduced on the public devnet: ethrex `eip8141-tracer` @ `9aa3645d`, sidecar @ `2e22ff0`.

## (a) Unstaked senders cannot use proxied tokens

**Status: from the rules, not measured.** STORAGE-021 covers storage associated with the sender. A proxied token's `balanceOf` also reads the EIP-1967 implementation slot, which is not associated with anyone. So an unstaked sender cannot read a USDC-style balance in validation. Verbatim avoids this by not reading balances in validation at all. **Proposal:** exempt EIP-1967 slots.

## (b) A flat 100k cap, staked or not

BUDGET-010 gives a staked entity 1,000,000. The sidecar's `validationPrefix.ts:288` applies one `MAX_VERIFY_GAS` of 100,000 to the whole prefix, with signature cost counted (proof `G0c`: 100,000 admitted, 100,001 refused). Every frame also pays a flat 3,000 entry charge, so a three-frame prefix has 9,000 gone before any code runs. **Consequence:** with no-standing-approvals, an ERC-20 swap needs two calls and does not fit (`DECISIONS.md`, D-A21).

## (c) `precompiles: []`

CALLING-040 allows core precompiles. The deployed config treats 0x01 as an undeployed contract, so bespoke-signature wallets cannot use `ecrecover`, and neither can the canonical paymaster.

## (d) No WebAuthn scheme

**Status: from the rules, not measured.** P256 entries take raw digests, while a passkey signs a hash of client data with SHA-256 inside. With `precompiles: []` there is no SHA-256 either. **Proposal:** a `WEBAUTHN` scheme, or SHA-256 under CALLING-040.

## Also found

- **The expiry verifier is not where EIP-8141 says.** No code at `0x81413f0cF12e9b6a49B1D0439E081c577D57FfFf`. The devnet has it at `0x0000000000000000000000000000000000008141` (`G0a`), and the sidecar's own constant is marked a placeholder.
- **A starved expiry frame still mines.** With a limit below the entry charge it has status 0, and the transaction lands. Anything relying on the frame must check its gas limit. PREFIX-060 reads as if this cannot happen.
- **`revertData` can mislead.** After a frame reverted, `ethrex_simulateFrameTransaction` reported revert data from another read: a contract reading FRAMEPARAM STATUS got that failure in place of the real reason. This cost us a debugging session.
- **The public devnet stalled at block 408262** for over 80 minutes on 6 November 2026. The sidecar still answered, and no error reached clients: transactions simply timed out.
