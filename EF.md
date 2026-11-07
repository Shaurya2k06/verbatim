# Verbatim × EIP-8141 frame transactions and the ERC-8421 alt mempool

**Prize:** Ethereum Foundation, Best use of the Frame Transaction Alternative Mempool

Verbatim is built on frame transactions. A VERIFY frame re-renders the SENDER frame's real calldata into the sentence the owners signed. If it differs, the frame never calls APPROVE, so the alt mempool never admits the transaction. After the calls, the account checks every promise the sentence made, and a broken promise reverts the batch.

## How we use it

| Primitive | Use | Code |
|---|---|---|
| VERIFY frame and introspection opcodes | The account's verify frame: layout lock, signature checks, on-chain render | [`VerbatimAccount.verifyFrame`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/account/VerbatimAccount.sol#L744) |
| Layout lock: `[expiry, VERIFY account, VERIFY paymaster, SENDER]` | Only the two canonical layouts can APPROVE | [`_layoutLock`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/account/VerbatimAccount.sol#L782), [`_statelessLock`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/account/VerbatimAccount.sol#L691) |
| Explicit-digest signature entries (`SIGPARAM`) | The protocol validates owner and attestor signatures before any frame runs. We compare digests and never call ecrecover, which matters because the sidecar has no precompiles | [`_checkOwners`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/account/VerbatimAccount.sol#L652), [`_checkAttestors`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/account/VerbatimAccount.sol#L671) |
| Stateless path, valid in any frame mempool | Merkle proofs and attestor-signed snapshots ride inside the transaction, so validation reads no global state | [`_verifyStateless`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/account/VerbatimAccount.sol#L616), [`StatelessRenderer`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/stateless/StatelessRenderer.sol) |
| ERC-8421 staked entity (STORAGE-031/032) | A staked RendererPaymaster renders from its own cached snapshot and rebuilds the owner digest. The canonical rules refuse that storage read; the alt mempool admits it | [`RendererPaymaster.verifyFrame`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/paymaster/RendererPaymaster.sol#L116) |
| Per-nonce fee tickets | Lets one sender keep several transactions pending under the LIFECYCLE-030 limits | [`_checkTicket`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/paymaster/RendererPaymaster.sol#L178) |
| SENDER frame | Charges the fee first, sets the replay guard, runs a bounded batch in an inner self-call, then asserts the spec | [`executeVerified`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/account/VerbatimAccount.sol#L804) |
| New opcodes from Solidity | One Yul contract wraps TXPARAM, FRAMEPARAM, FRAMEDATALOAD and SIGPARAM, and returns the whole frame layout in a single STATICCALL | [`FrameReader.yul`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/lib/FrameReader.yul#L15) |
| APPROVE without DELEGATECALL | We compile `log1(0,0,scope)` and patch that one byte from 0xa1 to 0xaa. CI checks there is exactly one LOG1 and no DELEGATECALL | [`check-bytecode.ts`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/scripts/live/check-bytecode.ts#L17) |

## Evidence, from the public EF frames devnet on the final build

- **69 of 69 recorded cases meet their expected result** ([PROOFS.md](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/docs/PROOFS.md)).
- **Honest transactions mined** through the real Universal Router: HONEST, SWAP and WRAP on the paymaster path; S-HONEST, S-SWAP and S-WRAP on the stateless path, with no stake.
- **Lies refused at the mempool:** `SpecHashMismatch`, `TreeMismatch`, `BadLayout`, `PolicyRefused`, no fee ticket, and an expired expiry frame.
- **Broken promises reverted in the batch,** with only the fee paid: `AssertionFailed`.
- **Canonical vs alt mempool:** ethrex's canonical check reports `StorageReadNonSender` for the paymaster path, and the alt mempool admits it because the paymaster is staked.
- **Invalidation bench, N = 50:**
  - a trust refresh stopped **0 / 0** pending transactions on the paymaster / stateless paths;
  - a snapshot rotation stopped **50 / 0** ([invalidation-bench.json](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/docs/invalidation-bench.json)).
- **Fits the sidecar's 100k validation cap,** signatures included ([GAS.md](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/docs/GAS.md)):
  - paymaster path: transfer **85,429**, v4 swap **90,588**;
  - stateless path: transfer **90,485**, swap **96,542**.

## What we give back to the standard

[FINDINGS.md](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/docs/FINDINGS.md) has four measured rule findings:
1. Proxied tokens fall outside STORAGE-021.
2. The sidecar enforces a flat 100k cap, where BUDGET-010 gives staked entities 1M.
3. The sidecar sets `precompiles: []`, which contradicts CALLING-040.
4. There is no WebAuthn scheme.

We also found:
- a starved expiry frame still gets its transaction mined;
- the expiry verifier is deployed at a different address from the spec's;
- reading frame status masks revert data.

There are two ERC drafts: *Sentence-Bound Frame Transactions* and *Signed Attestation Snapshots for Stateless Validation*.