# Decisions, deviations and answered questions

Evidence-backed changes against `context.md`. Newest facts win over the spec's recalled values; everything else in §24 stands.

## Devnet facts (checked 5 Nov 2026)

Sources: forshtat/ethrex `eip8141-tracer` @ `9aa3645d`, forshtat/mempool-workshop-sidecar @ `2e22ff0`, EIP-8141 text, live probes (see `PROOFS.md`).

| Item | Spec said | Reality | Action |
|---|---|---|---|
| Chain / endpoints | unknown | chain 1337; gateway `https://altmempoolgateway.forshtat.com/rpc`; ethrex `https://altmempool.forshtat.com`; explorer `https://explorer.altmempool.wtf/`; 6 s blocks | used |
| `sig_hash` (F1a) | elides VERIFY frame data | **false**: covers all frame data; elides only raw `signature` bytes of empty-`msg` entries | see D-A1 |
| Budgets (F2) | staked 1M, unstaked 100k | ERC-8421 draft: 100k / 1M. Landing page: 250k / 2.5M. **Deployed sidecar: flat 100k over the whole prefix, staked or not** (`validationPrefix.ts:288`) | see D-A2 |
| Toolchain (F0) | stock solc cannot emit opcodes | true; workshop's `HegotaSupport` uses per-opcode helpers and DELEGATECALL for APPROVE | see D-A3 |
| v4 / UR / Permit2 | self-deploy | real mainnet bytecode already predeployed on the devnet | see D-A4 |

## Answered open questions (§23)

1. **Opcode semantics.** Confirmed by probe: TXPARAM, FRAMEPARAM, FRAMEDATALOAD and SIGDATACOPY work at nested call depth via STATICCALL, from VERIFY and SENDER frames. APPROVE must run with `ADDRESS == resolved_target`. A SENDER frame reads frame 0's data (F1c). A SENDER frame's caller is `tx.sender` (F1b).
2. **Staking registry.** `NaiveStakingRegistry` at `0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f`; `addStake(uint32)` keyed on `msg.sender`, `getDepositInfo(address)`; `minStake` 0.01 ETH. Gas caps: see table. Staked entities may read their own storage (probe admitted; canonical said `StorageReadNonSender`).
3. **VERIFY dispatch.** An ordinary call with `frame.data` as calldata and `msg.sender == 0xaa`; selectors work.
4. **Keyed nonces / ARBITRARY.** Both exist. Envelope is `[chain_id, nonce_keys, nonce_seq, sender, frames, signatures, fees, blob_hashes, recent_root_references]`. We use `nonce_keys = [0]`, the ordinary account nonce.

## Deviations

### D-A1: owner signatures live in an ARBITRARY signature entry, not in frame 0 data
`sig_hash` commits to frame data, so signatures over a digest containing `sig_hash` cannot sit in frame 0 (circular). §6.1's listed fallback applies: frame 0 carries `(treeHash, specHash, signedAtBlock)`, signatures go in `tx.signatures[0]` (scheme ARBITRARY, empty `msg`), read with SIGDATACOPY. The EIP-712 digest is unchanged. Byte-exact length and sorted signers close ARBITRARY malleability.

### D-A2: F2 is false on the deployed sidecar
The live gateway rejects any prefix over 100k regardless of stake, contradicting ERC-8421's `BUDGET-010` (1M staked). This blocks rendering in validation at the budgets the spec assumed. Handling is recorded under "F2 outcome" below as it is resolved.

### D-A3: opcodes via FrameReader plus a one-byte APPROVE patch
A shared Yul `FrameReader` serves reads by STATICCALL. APPROVE stays in the contract's own code without DELEGATECALL (D10): `log1(0, 0, scope)` has APPROVE's stack shape, and the deploy tool flips that one byte after checking the runtime holds exactly one LOG1. Consequently account and paymaster may not emit one-topic logs.

### D-A4: use the predeployed Uniswap stack
§11.4 says self-deploy. The devnet already has the real PoolManager, PositionManager, Universal Router, Permit2 and WETH9 (replayed mainnet bytecode), which is stronger evidence than our own build. We add only demo tokens, pools and SkimHook.

### D-A5: signatures are protocol-validated with an explicit digest, bound through `txCommit` (supersedes D-A1's ARBITRARY entry)
The deployed sidecar has `precompiles: []` and rejects any call to precompile 0x01 as an "un-deployed contract", although CALLING-040 allows core precompiles. Frame 0 therefore cannot run `ecrecover`.
Owners cannot simply sign `sig_hash`: the device cannot check it, so that would reopen v4's fatal bug (a lying frontend gets a signature on a transaction whose tree is the lie). So each owner signs the EIP-712 digest over the tree, in a SECP256K1 entry with that digest as its explicit `msg`; the protocol recovers the signer and the account checks signer, scheme and `msg` with SIGPARAM.
An explicit `msg` cannot contain `sig_hash` (it is part of what `sig_hash` covers), so §8.2's first field becomes `txCommit = keccak(nonce, maxPriorityFee, maxFee, all frame gas limits, keccak(frame 1 data), keccak(frame 2 data))`, computed by frame 0 from introspection. With frame 0's own data in the digest and the layout lock fixing modes, flags, targets and value, this covers what `sig_hash` would, closing EIP-8141's "open-ended SENDER frames" warning. Blobs and keyed nonces are refused rather than committed to. On Leg B the field is `userOpHash`, as specified.
