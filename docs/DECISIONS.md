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

### D-A1: signatures do not live in frame 0 data
`sig_hash` commits to frame data, so signatures over a digest containing `sig_hash` cannot sit in frame 0 (circular). §6.1's fallback (an ARBITRARY entry) worked in probes, but was then superseded by D-A5, since it still needed `ecrecover`.

### D-A2: F2 is false on the deployed sidecar, so render fits under 100k
The live sidecar rejects any prefix over 100k regardless of stake, contradicting ERC-8421's `BUDGET-010` (1M staked). F2's listed fallback (cut render depth) would not have been enough, and running a patched sidecar would have left the demo off the public mempool. So render was rewritten to fit: batched frame reads, unchecked buffers over bounds-checked cursors, one SLOAD per lookup. The whole prefix is now about 87-94k, on the unmodified sidecar. **Cost: one call per transaction** there, since each extra call adds about 21.5k. Reported in `ALTMEMPOOL.md` as a finding; worth raising with the alt-mempool team, because the draft allows far more.

### D-A3: opcodes via FrameReader plus a one-byte APPROVE patch
A shared Yul `FrameReader` serves reads by STATICCALL, with one batched call for the frame layout. APPROVE stays in the contract's own code without DELEGATECALL (D10): `log1(0, 0, scope)` has APPROVE's stack shape, and the deploy tool flips that one byte after checking the runtime holds exactly one LOG1. Consequently account and paymaster may not emit one-topic logs.

### D-A4: use the predeployed Uniswap stack
§11.4 says self-deploy. The devnet already has the real PoolManager, PositionManager, Universal Router, Permit2 and WETH9 (replayed mainnet bytecode), which is stronger evidence than our own build. We add only demo tokens, pools and SkimHook.

### D-A5: signatures are protocol-validated with an explicit digest, bound through `txCommit` (supersedes D-A1's ARBITRARY entry)
The deployed sidecar has `precompiles: []` and rejects any call to precompile 0x01 as an "un-deployed contract", although CALLING-040 allows core precompiles. Frame 0 therefore cannot run `ecrecover`.
Owners cannot simply sign `sig_hash`: the device cannot check it, so that would reopen v4's fatal bug (a lying frontend gets a signature on a transaction whose tree is the lie). So each owner signs the EIP-712 digest over the tree, in a SECP256K1 entry with that digest as its explicit `msg`; the protocol recovers the signer and the account checks signer, scheme and `msg` with SIGPARAM.
An explicit `msg` cannot contain `sig_hash` (it is part of what `sig_hash` covers), so §8.2's first field becomes `txCommit = keccak(nonce, maxPriorityFee, maxFee, all frame gas limits, keccak(frame 1 data), keccak(frame 2 data))`, computed by frame 0 from introspection. With frame 0's own data in the digest and the layout lock fixing modes, flags, targets and value, this covers what `sig_hash` would, closing EIP-8141's "open-ended SENDER frames" warning. Blobs and keyed nonces are refused rather than committed to. On Leg B the field is `userOpHash`, as specified.

### D-A6: render and derive are one pass
§9.2 describes `derive(tree)` as a second walk. Effects need the descriptors, which the tree does not contain, so render emits tree and spec together. `derive()` in the TypeScript package returns that second output. Same determinism, less gas.

### D-A7: the tree's `trustEpoch` is the maximum over descriptors it used
§8.1 reads as the store's current epoch. That would change every pending tree on any `refreshTrust`, a mass-invalidation bug in the design itself. Tested in `test_I9_unrelated_trust_refresh_leaves_pending_tree_valid` and live in `INVALIDATION`.

### D-A8: code-bearing addresses come as signed hints
§9.1 renders EOAs by reading `EXTCODEHASH`. CALLING-010 forbids touching a code-free address in validation, and recipients are usually EOAs. So frame 1's data lists addresses claimed to have code. A listed address must actually have code or render refuses; an unlisted one is rendered as code-free and asserted so at execution. Frame 1 data is bound by `txCommit`.

### D-A9: small format changes, kept minimal
Publisher names and symbols fit a storage word (31 and 11 bytes against the spec's 48). VDesc gained `exactWords`. VSPEC changed as `VSPEC.md` lists. Added `TOKEN_UNSAFE` (0x0202), because §9.4 bans these tokens by policy but §8.5 had no code.

### D-A10: Uniswap details differ from §11
Checked against `Uniswap/universal-router@edf19bf`, `v4-periphery@c6e4754` and `v4-core@bea7f6d`, and fingerprinted against the deployed bytecode. The command mask is `0x7f`, not `0x3f`. `ExactInputSingleParams` has `minHopPriceX36`; the official Sepolia router is an older build without it, so routers carry an attested layout flag. Hook bit positions and `0x800000` were right. v3 inputs have a sixth `minHopPriceX36[]` argument; we ignore it. v3 renders and is unit-tested, but cannot run on the devnet, where the router has no v3 factory.

### D-A11: ENS on Leg B
- **The record lists hashes:** `clear-signing` holds a comma-separated list of `descHash`, because one publisher has several descriptors. §12.1's single value could only ever cover one.
- **Pinned resolver code covers one instance.** VerifiableFactory proxies differ per instance, so `RESOLVER_CODEHASH` pins the publisher's own resolver rather than the implementation. Fails closed, but each new publisher needs its own checker today. A better version verifies the implementation.
- **Second-level `.eth` names only** in the checker; §12.1's subname example is not built.
- **Parents.** Sepolia's `.eth` and root registries have no direct `SET_RESOLVER` or `SET_SUBREGISTRY` holders, which the checker enforces. Their admin roles remain with ENS; that is §12's irreducible trust.
- **Forward checks only on chain.** `refreshTrust` and `NAME_EQ` check name to address. §3's reverse direction is **not** checked. Universal Resolver reverse lookups were not built, and the demo's recipient has no primary name set.
- **The council is a plain EOA in the demo**, not a multisig.

### D-A12: other cuts and small choices
- **ERC-1271 opt-in is not built.** `isValidSignature` always fails, which is the safe default. `NO_POST_CHECK` is therefore never emitted.
- **e-ink hardware is cut**, per the agreed order. The signer is the offline phone or laptop web app.
- **Policy floor for `NO_MIN_OUT`** is not built: only a minimum of exactly zero is flagged.
- **`withdrawFees` is owner-gated but not delayed**, unlike §7.2. The fees are already earned, not users' deposits.
- **`client/` and `server/`** are untouched boilerplate from the first commit. The spec's `apps/` layout replaced them. Delete them if you don't need them.
- **Hardhat boilerplate removed from `contracts/`.** Foundry replaces it, per §16.
- **Kurtosis fallback unused:** the public devnet stayed reachable.

## Day-1 falsifiers (§19)

| # | Result | Evidence |
|---|---|---|
| F0 | **True.** Opcodes are emitted through `FrameReader` and a one-byte patch | Probe tx `0xc6f40e93...` |
| F1 | **(a) reads: true; the elision clause: false. (b) and (c): true.** `sig_hash` covers VERIFY data; see D-A1 and D-A5 | Same probe logged every value, and `sigHash` matched ours |
| F2 | **Partly false.** A staked paymaster may read its own storage and EXTCODEHASH, but the gas cap is 100k, not 1M | D-A2; refused at 120k while staked |
| F3 | **True.** Transfer sentence: 62k | `GAS.md` |
| F4 | **True.** `roleCount`, `hasRoles`, `getState` and `grantSetterRoles` all exist on the live Sepolia deployment | A8 and `refreshTrust` in `PROOFS.md` |
| F5 | **True.** We wrote our own, as expected | `descriptors/` |
| F6 | **True.** 68k for the whole of frame 1. Bits as recalled; everything was already predeployed | `SWAP` |
| F7 | **True.** Fee failure runs nothing; assertion failure undoes the batch and keeps the fee | `F7`, `A6` |
| F8 | **True, with care.** Pimlico and Alchemy both accept it. Alchemy's 40% verification-efficiency rule rejected our first gas plan, so the limits had to be tightened | `B-honest-*` |

## Other answered questions (§23)

5. **Command and action bytes:** V3_SWAP_EXACT_IN 0x00, SWEEP 0x04, PAY_PORTION 0x06, WRAP_ETH 0x0b, UNWRAP_WETH 0x0c, V4_SWAP 0x10; SWAP_EXACT_IN_SINGLE 0x06, SETTLE_ALL 0x0c, TAKE_ALL 0x0f.
6. **ENSv2 role queries:** see F4. A resource's `roleCount` is a nybble-per-role holder count, which makes "nobody holds this" a single read.
7. **Bundler limits:** see F8.
8. **ERC-7730 and the Universal Router:** the LedgerHQ registry has Uniswap V2 and V3 router descriptors, and none for the Universal Router or v4.
9. **P256:** the protocol has a P256 scheme. We did not test or use it.
