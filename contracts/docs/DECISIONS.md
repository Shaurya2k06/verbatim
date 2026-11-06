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

### D-A7: no trust epoch in the tree
§8.1 reads as the store's current epoch. That would change every pending tree on any `refreshTrust`, a mass-invalidation bug in the design itself. Each `CALL_BEGIN` carries its own `descHash` and attestation `version` instead. Tested in `test_I9_unrelated_trust_refresh_leaves_pending_tree_valid` and live in `A15`.

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
- **Names are checked both ways at refresh, forward only at execution.** `refreshTrust` requires the name to resolve to the address, and the address's primary name (Universal Resolver `reverse`, read on chain) to be that name. CCIP-read cannot be followed by a contract, so a name needing it fails closed. `NAME_EQ` re-checks forward at execution, as §12.3 specifies.
- **The council is a plain EOA in the demo**, not a multisig.

### D-A12: other cuts and small choices
- **ERC-1271 opt-in is not built.** `isValidSignature` always fails, which is the safe default. `NO_POST_CHECK` is therefore never emitted.
- **e-ink hardware is cut**, per the agreed order. The signer is the offline phone or laptop web app.
- **Policy floor for `NO_MIN_OUT`** is not built: only a minimum of exactly zero is flagged.
- **`withdrawFees` is owner-gated but not delayed**, unlike §7.2. The fees are already earned, not users' deposits.
- **`client/` and `server/`** are untouched boilerplate from the first commit. The spec's `client/apps/` layout replaced them. Delete them if you don't need them.
- **Hardhat boilerplate removed from `contracts/`.** Foundry replaces it, per §16.
- **Kurtosis fallback unused:** the public devnet stayed reachable.

### D-A13: freshness is an absolute timestamp
Replaces `signedAtBlock` and block TTLs, which a device with no chain access could not judge. `validUntil` is in the tree and in the signature. `executeVerified` reverts `Expired` past it and `TtlTooLong` if it is further out than the policy's `maxTtl` (default 300 s, client default 240 s). The device refuses a future-dated tree by its own clock (`DEVICE_MAX_TTL`, 600 s), and refuses an expired one. Validation cannot read TIMESTAMP (OP-011), so this all happens in execution: an expired transaction lands and pays its fee.

### D-A14: fee tickets replace deposits and FEE_HEADROOM (Leg A)
One deposit shared by pending transactions could be overcommitted. `feeTicket[account][nonce]` is funded in advance with `fundTickets(account, firstNonce, count)`, must cover the transaction's maximum cost, and is consumed first in frame 2 (any surplus goes to the account's deposit). A second transaction can only use the same ticket by having the same nonce, and then only one can land (A14). Tokens as fees and their rates are removed, per the checklist's §15. Tickets reclaim on a delay. Leg B uses EntryPoint's own prefund and refunds the difference in `postOp`.

### D-A15: approvals to spenders nobody attested are refused
`SPENDER_UNATTESTED` for ERC-20 `approve`, Permit2 `approve` and `setApprovalForAll`, lifted only by policy, and not raised for an approval to zero, which revokes. `TrustUpdate.spenders` holds the list.

### D-A16: `refreshTrust` takes ERC-8176 attestations
Each descriptor update carries offchain EAS v2 attestations under the canonical schema (`bytes32 descriptorHash`, UID `0xe023...b5c2`), checked against the fixed mainnet EAS EIP-712 domain, in ascending attester order, unexpired, to the attestor threshold. `descriptorHash` is keccak256 of the descriptor's RFC 8785 form. The update's own attestor signatures bind that hash to the compiled `vdesc`, since the chain cannot canonicalise JSON. **Limit:** EAS revocation lives on mainnet, out of reach here, so an EAS revocation only takes effect when attestors send a `Revocation` through `refreshTrust`. Our `jcs()` handles what descriptors contain: not the full number canonicalisation of RFC 8785.

### D-A17: return data is bounded (A18)
Found by Slither's `return-bomb`, confirmed by a failing test, then fixed. Solidity's `.call` copies all return data, so a target reverting with about 500 KB made the outer call run past `OUTER_RESERVE`. That reverted frame 2 whole, taking the fee with it. Both calls now keep at most 256 bytes.

### D-A18: registry import is display-only
ERC-7730 has no effects, so imported descriptors render a sentence and get the default assertions, which fail closed if a tracked token is spent. Fields ERC-7730 marks hidden are shown anyway. `@.to` and `@.from` fields are dropped, since a call node already shows the target and the header the account. See `contracts/docs/REGISTRY.md`.

### D-A19: what G1 changed from context.md, and why
- **Expiry verifier address.** The context's `0x81413f...FfFf` has no code on the devnet. The deployed verifier is at `0x...8141`. The account takes it as a constructor argument.
- **Frame 0 status is not read.** §9.1 implies relying on the frame. A probe showed a frame 0 starved of gas has status 0 and the transaction still mines, which would strip the expiry. Reading FRAMEPARAM STATUS instead broke ethrex's revert-data pass and masked every real revert reason. So the account requires frame 0's gas limit to be at least 3,100, and execution checks the time again.
- **FEE amount.** §7.1 says MAX_FEE. On the deployed node `max_fee` is per gas, and the latest EIP's `max_cost` depends on the base fee at inclusion, so neither is known at signing. The tree shows declared frame limits times the fee cap, which leaves out intrinsic gas. The ticket check still uses the node's true maximum cost.
- **Node deviations in VSPEC.** `IMPL_EQ` and `NAME_EQ` moved to 0x0D and 0x0E to free 0x0C. `P2ALLOW_LE` carries the Permit2 address.
- **Extra leaf types.** ROUTER and SPENDER leaves were added, because §6's five types cannot say which code is a router or which spender is attested. DESC's value also holds publisher and status; PROXY holds upgrader, logic code hash, implementation and getter.
- **Non-membership proofs are implemented, tested and optional.** A host leaving a proof out can only make a render refuse or show hex, never lie, and each proof costs validation gas.
- **Stateless rendering is a separate contract.** It does not fit in an account under EIP-170. The account STATICCALLs it at an immutable address, so D10's no-delegatecall holds.
- **The anchor uses records on `verbatim-anchor.eth`,** not a subname `attestors.verbatim-demo.eth`, because the checker handles second-level names only and `verbatim-demo.eth` is locked. `attestors` and `revoked` are two records, each with one scoped setter, rather than a record per revocation.

### D-A20: what made the prefix fit
The first G1 build measured 99-109k against the 100k cap. Changes, all in both renderers where they touch bytes: one batched reader call that also computes `txCommit` and returns signature entries; the policy word carried in frame 1's data and checked there, so the paymaster does no call or SLOAD for it; the snapshot as one commitment slot, with the rest in frame 2's data; the owner list hashed into 13 bytes of the policy slot, with the list in frame data, removing two SLOADs (a false match needs a 2^104 second-preimage search); publisher inside the descriptor blob; router kind read first on `execute`; a table for item sizes; no bounds checks on already validated descriptor bytes; smaller buffers (tree 3,072 bytes, 8 deltas). The Tick spacing field was dropped: it costs gas and tells a signer nothing they can act on.

### D-A21: no standing approvals changes the swap and A6
D9 means an ERC-20 swap must be `[permit2.approve, execute]` in one batch, which does not fit the deployed sidecar's cap at about 21k a call. The honest swap and A2 use native-ETH pools: one call and no approval. For the same reason EvilVault cannot hold a standing allowance on a real account, so the live A6 is a vault that keeps the ETH and credits no shares. The hidden pull stays as a Foundry test with an out-of-band allowance and a watched token. This conflict is worth raising in the findings: D9 and the flat cap together rule out ERC-20 swaps until BUDGET-010's 1M applies.

### D-A22: the real-interface attack, and what its harness changes
`contracts/scripts/uniswap-evil` applies the malicious build step to a checkout of `Uniswap/interface`. To run at all, the checkout loses references to unpublished workspaces (`tools/uniswap-nx` and others), and defaults testnet mode on. The harness routes RPC to our provider and Trading API paths to its public host with the team's key. Other Uniswap backends refuse a localhost origin; they are not spoofed. See `STATUS.md` for how far this got.

## Every transaction field (Leg A)

Nothing in the envelope is left unexamined. "Committed" means inside the digest owners sign.

| Field | Status | How | Test |
|---|---|---|---|
| `chain_id` | Committed | EIP-712 domain, tree header | `test_sig_other_chain_refused` |
| `nonce_keys` | Irrelevant to safety | Not in `txCommit`, and no TXPARAM needs it: `consumed[D_owner]` stops the same content under another key (D23) | `test_B12_I13_same_digest_cannot_execute_twice`, B12 |
| `nonce_seq` | Committed | `txCommit` | `test_txCommit_covers_every_committed_field` |
| `sender` | Committed | Domain, tree, layout lock `BadLayout(2)` | `test_I3_signature_binds_fees_gas_and_frames` |
| Frame count | Locked | 4 on the paymaster path, 3 on the stateless path, `BadLayout(0)` | A3 |
| Frame modes, flags, targets | Locked | `BadLayout(3-5)` | A3, A3b |
| Frame 2 value | Locked | Must be zero, `BadLayout(5)`; ETH moves through signed calls. EIP-8141 requires 0 on VERIFY frames | `test_I3_signature_binds_fees_gas_and_frames` |
| Frame 2 selector | Locked | `executeVerified`, `BadLayout(6)` | `test_I3_signature_binds_fees_gas_and_frames` |
| All frame gas limits (execution, state) | Committed | `txCommit` | `test_txCommit_covers_every_committed_field` |
| Frame 0 (expiry) | Locked and committed | Target, flags, value, 8-byte data, gas floor: `BadLayout(8)`. Data hash in `txCommit` | `test_A7b_failed_expiry_frame_is_refused`, `test_A7c_expiry_frame_must_be_the_real_verifier` |
| Frame 1 data | Blanked | Its tree hash, spec hash, root and path are in the digest; proofs are bound by the root | `test_I3_signature_binds_fees_gas_and_frames` |
| Other frames' data | Committed | Hashes in `txCommit` | `test_txCommit_covers_every_committed_field` |
| `max_priority_fee`, `max_fee` | Committed | `txCommit` | `test_txCommit_covers_every_committed_field` |
| `blob_hashes` | **Refused** if any | `BadLayout(7)` | `test_refused_field_blobs` |
| `max_fee_per_blob_gas` | Irrelevant | Blobs are refused, so nothing is paid at this rate | |
| `signatures` | Checked | Count, scheme, `msg`, owner, ascending | `test_sig_*` |
| `recent_root_references` | Irrelevant | Read by nothing in validation or the batch. A relayer changing it changes the transaction hash, not one effect. Our client always sends none | |

## Pinned commits

| Dependency | Commit |
|---|---|
| ethrex, `eip8141-tracer` | `9aa3645d` |
| `forshtat/mempool-workshop-sidecar` | `2e22ff0` |
| Uniswap `universal-router` | `edf19bfde87e6cf5b29046f6ca2f483a4ffd6ae6` |
| Uniswap `v4-periphery` | `c6e4754dab11bd38c6f08ac51c3c868569e93d64` |
| Uniswap `v4-core` | `bea7f6d1c11cd5dc4f0d5151ffa37a1c239feee6` |
| Uniswap `permit2` | `cc56ad0` |
| ENS `contracts-v2` | `07e55a05` |

## Day-1 falsifiers (§19)

| # | Result | Evidence |
|---|---|---|
| F0 | **True.** Opcodes are emitted through `FrameReader` and a one-byte patch | Probe tx `0xc6f40e93...` |
| F1 | **(a) reads: true; the elision clause: false. (b) and (c): true.** `sig_hash` covers VERIFY data; see D-A1 and D-A5 | Same probe logged every value, and `sigHash` matched ours |
| F2 | **Partly false.** A staked paymaster may read its own storage and EXTCODEHASH, but the gas cap is 100k, not 1M | D-A2; refused at 120k while staked |
| F3 | **True.** Transfer sentence: 62k | `GAS.md` |
| F4 | **True.** `roleCount`, `hasRoles`, `getState` and `grantSetterRoles` all exist on the live Sepolia deployment | A8 and `refreshTrust` in `PROOFS.md` |
| F5 | **True.** We wrote our own, as expected | `contracts/descriptors/` |
| F6 | **True.** 68k for the whole of frame 1. Bits as recalled; everything was already predeployed | `SWAP` |
| F7 | **True.** Fee failure runs nothing; assertion failure undoes the batch and keeps the fee | `F7`, `A6` |
| F8 | **True, with care.** Pimlico and Alchemy both accept it. Alchemy's 40% verification-efficiency rule rejected our first gas plan, so the limits had to be tightened | `B-honest-*` |

## Other answered questions (§23)

5. **Command and action bytes:** V3_SWAP_EXACT_IN 0x00, SWEEP 0x04, PAY_PORTION 0x06, WRAP_ETH 0x0b, UNWRAP_WETH 0x0c, V4_SWAP 0x10; SWAP_EXACT_IN_SINGLE 0x06, SETTLE_ALL 0x0c, TAKE_ALL 0x0f.
6. **ENSv2 role queries:** see F4. A resource's `roleCount` is a nybble-per-role holder count, which makes "nobody holds this" a single read.
7. **Bundler limits:** see F8.
8. **ERC-7730 and the Universal Router:** the LedgerHQ registry has Uniswap V2 and V3 router descriptors, and none for the Universal Router or v4.
9. **P256:** the protocol has a P256 scheme. We did not test or use it.
