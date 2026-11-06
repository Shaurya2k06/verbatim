# context.md: VERBATIM (final build contract)

> **"The chain is your wallet's screen."**
> Ethereum checks that the owners signed the sentence they read, then checks that what that sentence guaranteed actually happened.

**What this document is:** the single source of truth for the coding agent. It supersedes every earlier spec (`context.md` v7/v8, `verbatim_final.md`, `verbatim_arch_v10.md`, `VERBATIM.md`).

**Status labels:**
- **[BUILT]:** proven in `PROOFS.json`.
- **[SPEC]:** specified and reviewed. Verify it against the repo and build it if missing.
- **[V]:** a protocol fact verified from EIP-8141 (Draft), ERC-8421 (draft), or a live devnet probe.

---

## 0. Rules for the agent
1. **Reconcile first.** Before writing code, audit the repo against every [SPEC] item in this file. Record each one as *done / partial / missing* in `docs/STATUS.md`.
2. **Gates are strict.** Work through §17 in order. A gate passes only with a devnet or chain transaction, or a rejection log, recorded in `PROOFS.json`.
3. **Fail closed.** Anything unknown is rejected: an unknown selector, command, node type, leaf type, risk code, signature scheme, or layout.
4. **The renderers must match byte for byte.** The Solidity and TypeScript renderers must emit identical bytes, enforced by a differential fuzzer in CI (≥ 10k cases).
5. **Measure; don't estimate.** Every gas figure in `GAS.md` comes from a trace. Re-measure the validation prefix after every change; on the deployed sidecar the cap is a flat 100k.
6. **Scope discipline.** Build nothing outside this file. Never claim more than §2 allows.

---

## 1. Problem, claim, novelty

**Problem [V].**
- **Bybit (21 Feb 2025, ~$1.5B):** signers approved what a tampered Safe{Wallet} frontend (injected S3 JavaScript) showed them, not what the transaction did.
- **Clear signing today:** ERC-7730 descriptors, 8176 integrity attestations and 8213 digests, launched by EF in 2026. All of them work wallet-side only. Each wallet renders on its own, **nothing on chain checks that rendering**, and a contract can describe itself truthfully while doing something else.

**The claim.** For every transaction, the chain enforces two things:
1. **Sentence integrity.** The owners signed a canonical display tree, and the transaction is exactly what that tree describes, rendered deterministically from attested, code-pinned descriptors. Otherwise the transaction is **never admitted to the mempool**.
2. **Guarantee integrity.** The asset guarantees in the sentence happen, and no tracked holding of the user decreases, either during the batch or afterwards. No standing approvals survive a batch. Otherwise the **batch reverts**, and the user pays only gas.

**The signing device** only decodes the tree, shows it, and signs. It needs no internet, registry, or metadata. Its decoder, screen, clock and key are its entire trusted base.

**Never done before.** Each piece below is new on the EVM; the prior art it builds past is named.

| # | Contribution | Prior art and the delta |
|---|---|---|
| N1 | **The chain re-renders the signed sentence during validation** and binds the owners' signatures to it | **Cosmos ADR-050** does this only for fixed message types. **Kampela's ERC** checks a display ID inside the target. **ERC-8283** is a registry only. Verbatim handles arbitrary EVM contracts through code-pinned descriptors, and rejects at the mempool. |
| N2 | **Guarantees derived from the signed sentence, enforced in-account, durable across batches** | **EIP-7906** needs a fork and hand-written rules. Safe guards and MetaMask caveats are hand-written. |
| N3 | **Stateless validation through protocol-validated attestation entries.** Trust data travels as EIP-8141 explicit-`msg` signature entries, so validation reads no global state at all. | New pattern for EIP-8141 / ERC-8421. Pull oracles carry signed data, but not as protocol-checked signature entries feeding mempool validation. |
| N4 | **On-chain rendering of Universal Router and v4 calls, with hook-permission risk read from the hook's address bits** | Wallet-side Universal Router (UR) decoders exist. No on-chain renderer existed, and none was bound to what was signed. |
| N5 | **Measured mempool-invalidation comparison between stateful and stateless validation**, plus four ERC-8421 rule findings | New empirical data for the rules' author |

---

## 2. Scope sheet (paste into the README verbatim)

**In scope:**
- A human reading a sentence on a device, with a host or frontend that tampers with the transaction (the Bybit class).
- A contract that describes itself truthfully but has hidden effects on tracked assets.
- Swap frontends that lie about the minimum output, route, recipient, or hook risk.
- Stale pre-signed transactions, killed by a mandatory absolute expiry.

**Out of scope:**
- Compromised **machine** signers (Binance, Oct 2026), stolen keys, and sentences that are accurate but misunderstood.
- Admin-parameter semantics and protocol-internal ledgers beyond what descriptors render.
- **Unattested contracts.** They are refused, and there is no "effects-only" mode.
- **A captured attestor quorum.** It *can* mislabel spenders, tokens or names. The amounts in the signed guarantees, the no-standing-approvals rule, and execution-time revocation still hold.
- **Drift** (Apr 2026) is a footnote only. A truthful sentence would have described those admin calls accurately; expiry is the only mitigation that applies.

---

## 3. Prize tracks (picks: EF + Uniswap + ENS)

The page allows at most three partner prizes. The EF places each project in at most one EF prize.

### EF: Best use of the Frame Transaction Alternative Mempool ($2.5k / $1.5k / $1k)
- **Must show:**
  - an admitted transaction on the devnet explorer, plus a rejection log for a lying transaction;
  - design and trade-offs in `docs/ALTMEMPOOL.md`.
- **What we bring:**
  - the stateless path (N3), the paymaster path with the 4-frame layout, and the routing rule;
  - the invalidation comparison (N5);
  - four rule findings;
  - tooling: `FrameReader` and `ApproveShim`.

### Uniswap: Build with Uniswap ($4k / $3k / $2k / $1k)
- **Blockers:**
  - a public open-source repo;
  - `FEEDBACK.md`;
  - **the feedback form submitted** at https://developers.uniswap.org/hackathon-feedback with the `FEEDBACK.md` link;
  - a README that points to the exact contracts and lines.
- **What we bring:**
  - URRender (N4);
  - hook-risk nodes;
  - the real Uniswap interface attacked Bybit-style;
  - a Hook X-ray page;
  - an upstream package and PR.

### ENS: Best Use of ENSv2 ($3k / $2k / $1k / $1k)
- **Blockers:**
  - ENSv2 on Sepolia or mainnet, and **central** to the project;
  - no hard-coded values;
  - a live demo link;
  - open source.
- **What we bring: ENSv2 is Verbatim's trust root on chains with ENS (§13).** It defines:
  - **who may attest**, through the `attestors.verbatim-demo.eth` records;
  - **who published each descriptor**, through publisher names with an exclusivity proof;
  - **who you are paying**, through recipient names verified forward and reverse;
  - **what is revoked**, through revocation records.

---

## 4. Protocol facts the design depends on [V]

### 4.1 EIP-8141 (Draft; read 5 Nov 2026)

**Transaction envelope** (devnet): `[chain_id, nonce_keys, nonce_seq, sender, frames, signatures, fees, blob_hashes, recent_root_references]`

**Opcodes:**

| Opcode | Byte | What it gives |
|---|---|---|
| TXPARAM | 0xb0 | TYPE 0x00, NONCE 0x01, SENDER 0x02, MAX_PRIORITY_FEE 0x03, **MAX_FEE 0x04** (the total wei cap), BLOB_COUNT 0x07, SIG_HASH 0x08, FRAME_COUNT 0x09, CURRENT_FRAME_INDEX 0x0A, **SIGNATURE_COUNT 0x0B** |
| FRAMEDATALOAD / FRAMEDATACOPY | 0xb1 / 0xb2 | A frame's `data`, selected by index |
| FRAMEPARAM | 0xb3 | RESOLVED_TARGET 0x00, EXECUTION_GAS_LIMIT 0x01, MODE 0x02, FLAGS 0x03, DATA_LENGTH 0x04, STATUS 0x05 (past frames only), ALLOWED_SCOPE 0x06, ATOMIC_BATCH 0x07, VALUE 0x08, STATE_GAS_LIMIT 0x09 |
| SIGPARAM | 0xb4 | RESOLVED_SIGNER 0x00, SCHEME 0x01, MSG 0x02, SIGNATURE_LENGTH 0x03 (ARBITRARY only) |
| SIGDATACOPY | 0xb5 | ARBITRARY entries only |
| APPROVE | 0xaa | `APPROVE(offset, length, scope)`. Scopes: NONE 0, PAYMENT 1, EXECUTION 2 (only when `target == sender`), BOTH 3. It reverts unless `ADDRESS == resolved_target`. |

**Signature entries:** `[scheme, signer, msg, signature]`.
- **Schemes:** SECP256K1 0x1 (2,800 gas), P256 0x2 (6,700 gas), ARBITRARY 0x0 (no signer).
- **`msg`:** empty means the entry signs `sig_hash`. A 32-byte non-zero `msg` is an **explicit digest**.
- **All protocol-validated entries are checked before any frame runs.**

**Frame modes:**
- **VERIFY:** runs as a STATICCALL, and must APPROVE.
- **SENDER:** runs as `tx.sender`.
- **DEFAULT:** runs from the entry point.

**Flags:** bits 0–1 hold the allowed scope; bit 2 is ATOMIC_BATCH, which is not used here.

**Canonical expiry verifier** at `0x81413f0cF12e9b6a49B1D0439E081c577D57FfFf`:
- a VERIFY frame whose data is an 8-byte big-endian timestamp;
- it reverts unless `block.timestamp ≤ expiry`;
- requires flags 0, value 0 and state limit 0;
- at most one per transaction;
- it is an ordinary contract, so **check that it is deployed on the devnet**.

**Public mempool rules:**
- SLOAD only on `tx.sender` storage.
- `EXTCODE*` and `CALL*` only to existing contracts or precompiles, never to EIP-7702-delegated accounts.
- Banned in validation: TIMESTAMP (except inside the expiry verifier), NUMBER, BALANCE, SSTORE, and the rest of the list.
- `MAX_VERIFY_GAS` = 100k, and signature cost counts toward it.

**`sig_hash`** covers **all** frame data. It leaves out only the raw signature bytes of empty-`msg` entries, which is why we never put signatures in frame data.

### 4.2 ERC-8421 (draft)
- **PREFIX-010 shapes:**
  - `[self_verify]` and `[only_verify, pay]`;
  - optional `deploy` / `pre_verify` frames;
  - a leading `expiry_verify` is **always allowed**.
- **PREFIX-060:** a VERIFY frame must end in APPROVE.
- **Storage:**
  - STORAGE-010: the sender's own storage.
  - STORAGE-021: storage associated with the sender inside external contracts, when there is no deploy frame.
  - STORAGE-031/032: a staked entity's own storage, plus read-only access to any non-entity storage.
- **BUDGET-010:** 100k per unstaked entity and **1M per staked entity**; signature cost is charged to the sender.
- **CALLING-040:** precompiles 0x01–0x11 and P256VERIFY are allowed.
- **LIFECYCLE-030:** up to 4 pending transactions per (sender, nonce key) and 64 per unstaked sender. **This is why the paymaster path uses per-nonce fee tickets.**
- **LIFECYCLE-040:** pending transactions are revalidated when a storage dependency changes.
- **Reputation:** seen/included counters; THROTTLED limits an entity to 4 mempool entries for 10 blocks.

### 4.3 Live devnet facts [V, from your probes; see `DECISIONS.md`]
- **Endpoints:**
  - chain 1337, 6-second blocks;
  - gateway `https://altmempoolgateway.forshtat.com/rpc`;
  - ethrex `https://altmempool.forshtat.com`;
  - explorer `https://explorer.altmempool.wtf/`.
- **Pinned commits:** forshtat/ethrex `eip8141-tracer` @ `9aa3645d`; forshtat/mempool-workshop-sidecar @ `2e22ff0`.
- **The sidecar does not match the spec in two ways:**
  1. It enforces a **flat 100k over the whole prefix, staked or not**, where BUDGET-010 says 1M for staked entities.
  2. It sets **`precompiles: []`**, so there is no `ecrecover` and no SHA256, where CALLING-040 allows them.
- **Staking:** `NaiveStakingRegistry` at `0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f`. Call `addStake(uint32)`; `minStake` is 0.01 ETH. Staked entities' own-storage reads are admitted.
- **Opcode behaviour:**
  - TXPARAM, FRAMEPARAM, FRAMEDATALOAD and SIGDATACOPY work at nested depth through STATICCALL, from both VERIFY and SENDER frames.
  - APPROVE needs `ADDRESS == target`.
  - A SENDER frame can read frame 0's data, and its caller is `tx.sender`.
  - VERIFY is dispatched as an ordinary call with `msg.sender == 0xaa`.
- **Predeployed contracts:** the real mainnet bytecode for PoolManager, PositionManager, Universal Router, Permit2 and WETH9.
- **Measured:** the full validation prefix costs **~88k** for both a transfer and a real v4 swap. Frame 0 is ~19k and the paymaster frame ~51–68k.

---

## 5. Architecture: one trust model, two delivery paths

**The trust model.** All trust data lives in one **snapshot**: a typed, sorted Merkle tree signed by a k-of-n attestor set (§6).

| | **Stateless path** [SPEC], the default | **Paymaster path** [BUILT core + SPEC binding] |
|---|---|---|
| Prefix | `[expiry_verify, self_verify]` | `[expiry_verify, only_verify, pay]` |
| Who renders | The account, in its own VERIFY frame | The staked RendererPaymaster, in its VERIFY frame |
| How trust data arrives | Attestor entries plus Merkle proofs carried **in the transaction** | Snapshot root plus leaves **cached in the paymaster's storage** |
| What validation reads | Sender storage, `EXTCODEHASH` of existing contracts, transaction data | The paymaster's own storage, plus EIP-1967 slots under STORAGE-032 |
| Mempools | Public frame pool **and** ERC-8421 | ERC-8421 only |
| Stake | None | Paymaster staked |
| Fees | Self-paid ETH | Per-nonce fee tickets |
| Global-state invalidation | **None** | Cache writes trigger LIFECYCLE-040 revalidation |
| Revocation | Snapshot TTL in validation, plus a registry check at execution (immediate) | Immediate, in validation |

**Routing rule (the wallet chooses):**
- Use the **stateless path** when the account's VERIFY fits under 100k, signatures and proofs included, with at least 10k to spare.
- Otherwise use the **paymaster path**, but only if it fits the node's real cap.
- On the sidecar both paths are capped at 100k, so **heavy renders are refused today.** Heavy routing becomes available on spec-compliant nodes that give staked entities 1M. That is rule finding (b) in §14.

---

## 6. The snapshot [SPEC]

**Structure.** A **sorted Merkle tree** whose leaves are ordered by `leafKey = keccak(type ‖ abi.encode(key))`.
- **Hashing (domain-separated):**
  - leaf hash: `keccak(0x00 ‖ type ‖ abi.encode(key, value))`;
  - node hash: `keccak(0x01 ‖ left ‖ right)`.
- **Depth:** ≤ 20.
- **Presence proof:** the Merkle path.
- **Non-membership proof:** two *adjacent* leaves, `leafKey_i < k < leafKey_{i+1}`, with consecutive indices.

| type | key | value |
|---|---|---|
| 0x01 DESC | (chainId, codehash, selector) | descHash |
| 0x02 TOKEN | (chainId, address) | (symbol ≤ 11 ASCII, decimals, riskFlags u32) |
| 0x03 HOOK | (chainId, hookCodehash) | attestFlags |
| 0x04 NAME | (chainId, address) | normalized name (≤ 48 ASCII) |
| 0x05 PROXY | (chainId, proxyCodehash) | (template id, implementation slot, expected implementation codehash) |

**`riskFlags` bits:** fee-on-transfer, rebasing, pausable, blacklist, ERC-777 operators, ERC-2771 forwarder, admin seize, non-standard return. **Any set flag makes the token refused by default.**

**Signed statement.**
```
D_snapshot = EIP712(domain{name:"VerbatimSnapshot", version:"1", chainId},
  Snapshot(bytes32 root, uint64 issuedAt, uint64 expiry, uint16 schema))
```

**Proof rules:**
- **Every touched token needs a TOKEN presence proof.** A missing proof means refusal.
- **Names:** a non-membership proof means the address renders as hex.

**Attestors** are an ERC-8176-compatible quorum. On the Sepolia leg, the attestor list is anchored in ENS (§13). Descriptor sources: the public **ERC-7730 registry**, compiled by `vdesc-compiler`, plus Verbatim's **effects extension** for the top contracts (ERC-20, WETH, Permit2, UR, one lending protocol, one vault).

**Revocation, in two layers:**
1. The leaf is left out of the next snapshot. Snapshot TTL ≤ `maxSnapshotTTL`, 6h by default.
2. The **`RevocationRegistry`**:
   - **keyed by leaf hash**, covering every leaf type;
   - governed by the attestors;
   - **read only at execution**, so it never invalidates the mempool;
   - at an **immutable** address in the account;
   - **for liveness only:** it can cause reverts but can't authorize anything.

---

## 7. Formats [BUILT core; v2 fields SPEC]

### 7.1 VTREE v2: the sentence

**Header:**
```
Tree   := MAGIC "VT\0\2" | Header | Node*
Header := chainId u64 | account 20B | expiry u64 | snapshotRoot 32B | policyVersion u32 | path u8
Node   := type u8 | len u16 | payload
```
**No global epoch** appears anywhere in the tree.

**Node types:**

| type | node | payload |
|---|---|---|
| 0x01 / 0x02 | CALL_BEGIN / CALL_END | target 20, codehash 32 (or CODE_FREE flag), selector 4, descHash 32, intent str, publisherName str, attestStatus u8 |
| 0x10 | ADDRESS | label, addr, nameSource (0 = hex, 1 = verified NAME leaf), name, flags (hasCode, isSelf, isRouter) |
| 0x11 | AMOUNT | label, token, symbol, decimals, raw u256 (never rounded) |
| 0x12–0x16 | UINT / BOOL / ENUM / BYTES (hashed) / ETH_VALUE | — |
| 0x20 / 0x21 | GROUP_BEGIN / END | UR command, v4 action, or nested call |
| 0x30 | RISK | code u16, args |
| 0x31 | BLIND | label, keccak, len, boundBy (the index of an assertion, or refusal) |
| 0x40 | FEE | asset, amount = MAX_FEE (the total wei cap) |
| **0x50** | **GUARANTEE** | op u8, args. One node for every VSPEC item, emitted in VSPEC order. **The device shows these first.** |

**String rules:** printable ASCII `0x20–0x7E` excluding `\`, at most 48 bytes, with fixed decimal formatting. **The device refuses** unknown types, over-length strings, and characters outside that set.

`treeHash = keccak(tree)`

### 7.2 VSPEC: the guarantees

`specHash = keccak(spec)`, where `spec = derive(tree)`. The spec must equal the encoding of the tree's GUARANTEE section, byte for byte.

**Items:**

| Byte | Item | Arguments |
|---|---|---|
| 0x01 | DELTA_EQ | holder, asset, int256 |
| 0x02 | DELTA_GE | holder, asset, uint256 |
| 0x03 | ALLOW_LE | token, spender, max |
| 0x04 | P2ALLOW_LE | token, spender, max |
| 0x05 | OPERATOR_EQ | — |
| 0x06 | OWNER_EQ | — |
| 0x07 | CODEHASH_EQ | — |
| 0x08 | NO_CODE | — |
| 0x09 | TRACKED_NO_DECREASE | — |
| 0x0A | TRACKED_NO_ALLOW_INC | — |
| 0x0B | ACCOUNT_INVARIANT | — |
| 0x0C | **APPROVALS_CLEARED** | Every ERC-20, Permit2 sub-allowance and operator approval created in the batch must be back to 0 afterwards. The only exception is the ERC-20 base allowance to Permit2. |

**`derive` always appends** 0x09, 0x0A, 0x0B and 0x0C.

### 7.3 Risk codes

| Code | Name | Code | Name |
|---|---|---|---|
| 0x0001 | UNLIMITED_APPROVAL | 0x0101 | NO_MIN_OUT |
| 0x0002 | OPERATOR_APPROVAL | 0x0102 | HOOK_CAN_TAKE_INPUT |
| 0x0003 | UPGRADEABLE_TARGET(upgrader) | 0x0103 | HOOK_CAN_TAKE_OUTPUT |
| 0x0004 | UNVERIFIED_CONTRACT | 0x0104 | HOOK_DYNAMIC_FEE |
| 0x0005 | TRUST_CHANGE | 0x0105 | HOOK_UNVERIFIED |
| 0x0007 | RECIPIENT_HAS_CODE | 0x0106 | SWEEP_TO_OTHER |
| 0x0008 | RECIPIENT_NOT_SELF | 0x0107 | PERMIT2_ALLOWANCE_CHANGE |
|  |  | 0x0108 | UR_ALLOW_REVERT |
|  |  | 0x0201 | TTL_LONG |

### 7.4 Owner digest (both paths, and ERC-4337)
```
D_owner = EIP712(domain{name:"Verbatim", version:"11", chainId, verifyingContract: account},
  Tx(bytes32 treeHash, bytes32 specHash, uint64 expiry, bytes32 snapshotRoot, uint8 path, bytes32 txCommit))
path     = 1 stateless | 2 paymaster | 3 erc4337
txCommit = frames: keccak( CHAINID, SENDER, NONCE, MAX_PRIORITY_FEE, MAX_FEE, FRAME_COUNT,
                    for each frame f: MODE, FLAGS, RESOLVED_TARGET, VALUE, EXECUTION_GAS_LIMIT, STATE_GAS_LIMIT,
                                      (f == 1 ? 0 : keccak(FRAMEDATA(f))),
                    SIGNATURE_COUNT, BLOB_COUNT )
           erc4337: userOpHash
```
**Rules:**
- **The blanked frame is always frame 1**, the account's VERIFY, for every verifier.
- `BLOB_COUNT` must be 0.
- Frame 1's data carries `treeHash`, `specHash`, `snapshotRoot` and `path`, which are bound through `D_owner`, and on the stateless path the proofs, which are bound through `snapshotRoot`.
- **Policy inputs come only from sender storage.**
- **Every verifier rebuilds `D_owner` from its own render and requires that every owner entry's `MSG` equals it** (D2).

### 7.5 The attestor statement is `D_snapshot` (§6).

---

## 8. Contracts [BUILT unless marked]

| Contract | Responsibility |
|---|---|
| `VerbatimAccount` | Contains both paths' VERIFY logic and `executeVerified`. It has no delegatecall, no upgrade path and no 7702, and ERC-1271 is off by default. |
| `RendererPaymaster` | Paymaster-path VERIFY. It holds the snapshot cache in its own storage, plus fee tickets. |
| `DisplayVM` (library) | Renders VTREE v2 from VDesc descriptors. |
| `URRender` (library) | Renders Universal Router and v4 calls (§12). |
| `AssertionKit` (library) | Takes the snapshot of holdings and asserts VSPEC. |
| `SnapshotVerifier` (library) [SPEC] | Checks sorted-Merkle presence and adjacency proofs, and the domain-separated hashes. |
| `RevocationRegistry` [SPEC] | `isRevoked(bytes32 leafHash)`. Writes require an attestor k-of-n. |
| `FrameReader` (Yul) | Exposes the new opcodes to Solidity through STATICCALL. |
| `ApproveShim` | Emits APPROVE by patching one byte of a LOG1. The deploy tool checks there is exactly one LOG1, and the account and paymaster emit no other one-topic logs. |
| `VerbatimAccount4337` [SPEC] | ERC-4337 account with stateless semantics (§11). |
| `EnsTrustAnchor` [SPEC] | Reads the ENSv2 attestor list and revocation records at execution, on Sepolia (§13). |
| Demo contracts | `EvilVault`, `SkimHook` (address mined for the afterSwapReturnsDelta flag), test tokens. |

**Account storage:**
- `owners[]`, `threshold`;
- `attestors[]`, `attestorThreshold`;
- `policy`: maxTTL, maxSnapshotTTL, risk rules, policyVersion;
- `ledger` (≤ 16 entries; Permit2 base allowances only);
- `watchlist` (≤ 32);
- **`consumed[bytes32 D_owner]`**, the replay guard (D23);
- `locked`.

**Self-administration:** owners, attestors, policy and watchlist change **only** through a rendered batch that carries `TRUST_CHANGE`.

---

## 9. Validation

### 9.1 Account VERIFY (frame 1 on both paths)
1. **Layout lock (FRAMEPARAM):**
   - frame 0 is VERIFY targeting `EXPIRY_VERIFIER`;
   - frame 1 is the current frame;
   - **stateless path:** 3 frames total, and frame 2 is SENDER on `self` with the `executeVerified` selector;
   - **paymaster path:** 4 frames total, frame 2 is VERIFY targeting the immutable `RENDERER_PAYMASTER`, and frame 3 is SENDER on `self` with `executeVerified`;
   - no ATOMIC_BATCH, no value, and `path` (from frame 1 data) must match.
2. **Signatures:**
   - `SIGNATURE_COUNT` must be exactly `k_owners` (paymaster path) or `k_owners + k_attestors` (stateless path);
   - every entry must be SECP256K1 with a 32-byte `MSG`;
   - owner entries: their signers must be distinct members of `owners`, meet the threshold, and each `MSG` must equal `D_owner`, built from frame 1's fields, frame 0's expiry, and `txCommit`;
   - attestor entries (stateless only): distinct, meeting `attestorThreshold`, each with `MSG == D_snapshot`.
3. **Freshness and replay:**
   - `expiry` comes from frame 0's data;
   - stateless path: `expiry ≤ expiry_s` and `expiry_s − issuedAt ≤ maxSnapshotTTL`;
   - `!consumed[D_owner]`.
4. **Stateless path only:**
   - verify the proofs;
   - render frame 2's calls with DisplayVM and URRender;
   - for every existing-contract target, `EXTCODEHASH(target)` must equal the attested codehash;
   - EOA targets carry the `CODE_FREE` flag and are checked at execution;
   - hook flags come from the address bits;
   - `keccak(tree) == treeHash` and `derive(tree) == specHash`;
   - then apply policy (§9.3).
5. **APPROVE:** `EXECUTION_AND_PAYMENT` on the stateless path, `EXECUTION` on the paymaster path.

### 9.2 RendererPaymaster VERIFY (frame 2, paymaster path)
1. Render frame 3's calls from the **cached** leaves, checking proxy implementations here (STORAGE-032). Then derive the spec and apply policy.
2. Rebuild `D_owner` from **its own** render and derivation, frame 0's expiry, the cached root, `path = 2`, and `txCommit`. Require `SIGNATURE_COUNT == k_owners` and that **every** `MSG` equals that digest. Together with §9.1 step 2, this forces frame 1's claimed tree to equal the paymaster's render.
3. Check frame 0's expiry against the cached snapshot's `expiry_s`. The root must be cached and not expired, and its TTL must be within the cap.
4. Check `feeTicket[account][NONCE] ≥ TXPARAM(MAX_FEE)`.
5. `APPROVE(PAYMENT)`.

### 9.3 Policy (identical on both paths)
**Refuse:**
- unattested targets, and approvals or operators granted to unattested spenders;
- `NO_MIN_OUT` together with any `HOOK_CAN_TAKE_*`, and `HOOK_UNVERIFIED` together with any `HOOK_CAN_TAKE_*`;
- unbounded `BLIND` nodes, unknown risk codes and unknown UR commands, and `UR_ALLOW_REVERT` unless the policy allows it;
- TTL above `maxTTL`;
- any token with a nonzero `riskFlags`.

---

## 10. Execution: `executeVerified(calls, spec)` (SENDER frame)
1. **Paymaster path:** consume the fee ticket first. If that fails, the frame fails and nothing protected runs [BUILT F7].
2. Require `keccak(spec) == specHash`, read from frame 1's data. Set `consumed[D_owner] = true`.
3. **Execution-time checks.** These never invalidate the mempool:
   - every leaf used is not revoked (`RevocationRegistry`, plus `EnsTrustAnchor` on Sepolia);
   - stateless path: EIP-1967 proxy implementations match the PROXY leaf;
   - `CODE_FREE` targets still have no code;
   - names are re-resolved live where ENS exists;
   - `block.timestamp ≤ expiry` (belt and braces).
4. **Run the batch:**
   - snapshot the tracked set (touched tokens, ledger and watchlist) into memory;
   - an `onlySelf` inner call makes CALLs only, under a reentrancy lock, with bounded gas per call and a reserve kept for the assertions;
   - assert VSPEC, including APPROVALS_CLEARED;
   - **if an assertion fails, the batch reverts.** On the paymaster path the fee is kept [BUILT A6].
5. **Update the ledger:** add Permit2 base allowances, prune entries at 0, and enforce the cap of 16.

**Lemma (README, with proof sketch).** The account never delegatecalls and runs only rendered CALLs. Its only standing approvals are Permit2 base allowances, whose sub-allowances are 0. Under those conditions, **it can lose a token only by calling that token contract inside a rendered, asserted batch.** The exceptions are tokens with nonzero `riskFlags`, which are refused.

---

## 11. Deployments

| Leg | Chain | Paths | Purpose |
|---|---|---|---|
| Frames | EF devnet, chain 1337 | stateless + paymaster | EF track; rejection at the mempool; the A-vs-B measurement |
| Production [SPEC] | Base or Optimism mainnet, ERC-4337 | `VerbatimAccount4337` (path 3) | Usable today; **live bounty** (§16.4); official Uniswap contracts |
| Names | Sepolia, ERC-4337 [BUILT; ENS anchor SPEC] | path 3 plus `EnsTrustAnchor` | ENS track |

**ERC-4337 semantics:**
- `validateUserOp` reads only the account's own storage (STO-010), so it works with **any bundler**, with no paymaster and no stake.
- Owner and attestor signatures and the proofs travel in `userOp.signature`, verified with `ecrecover`, which ERC-4337 allows.
- `txCommit := userOpHash`.
- **`validUntil = D_owner.expiry`**, and validation also requires `expiry ≤ expiry_s`.
- Execution is identical to §10.

---

## 12. Uniswap integration

**URRender [BUILT core].**
- **Decodes:** `execute(commands, inputs, deadline)`. `COMMAND_TYPE_MASK` is `0x7f`; bit `0x80` is allow-revert and raises `UR_ALLOW_REVERT`. Commits are pinned.
- **Supported commands:** `V3_SWAP_EXACT_IN` (single and multi-hop path decode), `V4_SWAP` (`SWAP_EXACT_IN_SINGLE`, `SWAP_EXACT_IN`, `SETTLE_ALL`, `TAKE_ALL`), `WRAP_ETH`, `UNWRAP_WETH`, `SWEEP`, `PAY_PORTION`. Any other command renders `BLIND` and is refused.
- **Special recipients:** `MSG_SENDER` (address 1) renders as "you", and `ADDRESS_THIS` (address 2) renders as "router".
- **Measured:** a real v4 swap renders in **68k gas** [BUILT SWAP]. Each new command must keep at least 10k of prefix headroom.

**Hook risk.**
- Flags come from the low address bits, as defined in v4-core `Hooks.sol` at the pinned commit: `beforeSwapReturnsDelta` raises `HOOK_CAN_TAKE_INPUT`, and `afterSwapReturnsDelta` raises `HOOK_CAN_TAKE_OUTPUT`.
- A dynamic-fee flag in the PoolKey raises `HOOK_DYNAMIC_FEE`.
- A hook codehash with no HOOK leaf raises `HOOK_UNVERIFIED`.

**Swap guarantees:**
- the input token changes by exactly `−amountIn`;
- the output token reaches the displayed recipient in at least the displayed minimum;
- `P2ALLOW_LE(token, UR, 0)` after the batch.

**Real-app attack [SPEC].**
- Fork the open-source Uniswap web interface and add a malicious build step, the way Bybit's S3 was injected: it rewrites the swap to minimum output 0 and routes through the SkimHook pool.
- A Verbatim wallet connects over WalletConnect.
- **Side by side:** an ordinary wallet receives 28 USDC while the hook takes 2,807 [BUILT A2-eoa]. Verbatim gets `TreeMismatch` at the mempool. When the user is shown the true sentence it carries `! HOOK CAN TAKE YOUR OUTPUT`, and policy refuses it [BUILT A2/A2b].

**Hook X-ray [SPEC]:** a public page where anyone pastes a PoolKey or pool ID and sees the hook's flags and risk lines.

**Upstream [SPEC]:**
- `@verbatim/urrender`, in Solidity and TypeScript, with tests and CI;
- an issue or PR to Uniswap's repos;
- `FEEDBACK.md` covering devnet quirks, the hook-flag encoding, Permit2 UX, and the measured gas.

---

## 13. ENS integration: ENSv2 as the trust root [BUILT A8; anchor SPEC]

ENS answers four questions on Sepolia:
1. **Who you're paying.** NAME leaves give recipients names, re-resolved live forward and reverse at execution. CCIP-read and wildcard resolvers are refused. Lookalikes render as hex [BUILT A8].
2. **Who published each descriptor.** The publisher's ENSv2 name has a PermissionedResolver with an argument-scoped `clear-signing` setter. The exclusivity proof checks the root roles with `roleCount` and `getAssigneeCount` against the expected holders, plus a horizon on the parent chain and expiry. Upstream ENS DAO and registry control is disclosed.
3. **Who may attest.** `EnsTrustAnchor` reads a text record on `attestors.verbatim-demo.eth`, covering the attestor addresses and threshold. That record is written only by an argument-scoped role held by a governance multisig. **At execution, every attestor whose entry was used must be listed**; if one isn't, the batch reverts.
4. **What is revoked.** Revocations are records `revoked:<leafHash>` under the same name, checked at execution alongside the `RevocationRegistry`.

**Acceptance:** ENSv2 is central and nothing is hard-coded, because every address and threshold comes from records. There must be a live demo link.

---

## 14. Standards and findings (the EIP-level deliverables) [SPEC]
1. **ERC draft: "Sentence-Bound Frame Transactions"**, specifying VTREE v2, VSPEC, the layout lock, `D_owner` and `txCommit`. Post it on Ethereum Magicians and link it.
2. **ERC draft: "Signed Attestation Snapshots for Stateless Validation"**, specifying the sorted Merkle tree, `D_snapshot`, the TTL rules, execution-time revocation, and how it generalizes to sponsors and oracles. Post it on Ethereum Magicians and link it.
3. **ERC-8421 rule findings, filed with the sidecar and draft author, each with measurements:**
   - (a) For **unstaked** senders, STORAGE-021 can't cover proxied tokens such as USDC: `balanceOf` reads the implementation slot, which isn't associated with the sender. Proposal: exempt EIP-1967 slots.
   - (b) The sidecar caps validation at a flat 100k, where BUDGET-010 gives staked entities 1M.
   - (c) The sidecar sets `precompiles: []`, contradicting CALLING-040. This also breaks the canonical paymaster's `ecrecover`.
   - (d) There is no WebAuthn scheme, so P256 entries only accept raw digests. Proposal: a `WEBAUTHN` scheme, or SHA256 under CALLING-040.
4. **Tooling:** `FrameReader` and `ApproveShim`, published with docs.

---

## 15. Off-chain components

| Package | Purpose |
|---|---|
| `displayvm-ts` | TypeScript twin of DisplayVM, URRender and `derive`, producing byte-identical output |
| `vdesc-compiler` | Compiles ERC-7730 JSON plus the effects extension into VDesc. **Ingests the LedgerHQ registry**, and reports the number compiled and the failures with reasons. |
| `snapshot-cli` [SPEC] | Builds the sorted Merkle tree, emits proofs, collects attestor signatures, publishes the snapshot, and updates the ENS records |
| `frames-sdk` | Builds, serializes and submits type-0x06 transactions; chooses the route; decodes admission errors |
| `signer` | Offline app and device firmware. Reads QR, decodes strictly, **shows guarantees first**, refuses an expiry more than `maxTTL` past its clock, signs `D_owner`, returns a QR. Optional hardware: ESP32 or Raspberry Pi Zero with e-ink, a camera and a button. |
| `wallet` | WalletConnect wallet that routes requests through Verbatim |
| `attack-kit` | Hosted page with one button per attack in §16.2 |
| `uniswap-interface-evil` [SPEC] | The interface fork with the malicious build step |
| `hook-xray` [SPEC] | The Hook X-ray page |
| `bounty-oracle` [SPEC] | The policy-bounded signing oracle (§16.4) |
| `difffuzz`, `gas-report`, `invalidation-bench` [SPEC] | CI tools |

---

## 16. Assurance

### 16.1 Invariants (Foundry invariant tests, run in CI)

| # | Invariant |
|---|---|
| I1 | A batch that succeeds was rendered to exactly the signed `treeHash`, under the signed root |
| I2 | A batch that succeeds satisfies every VSPEC item |
| I3 | No layout other than the two canonical ones receives an APPROVE |
| I4 | If the fee fails, no protected call runs |
| I5 | If an assertion fails, no protected effect persists |
| I6 | A transaction past its expiry is never included, and the device refuses an expiry beyond its cap |
| I7 | No takeover is possible: no delegatecall, no upgrade, no 7702, and trust changes only through a rendered `TRUST_CHANGE` |
| I8 | The Solidity and TypeScript renderers produce identical bytes |
| I9 | Validation reads only what §5 allows on each path |
| I10 | A snapshot from another chain, beyond its TTL, or expired is never accepted, on either path |
| I11 | A revoked leaf never executes |
| I12 | No approval survives a batch, except Permit2 base allowances with zero sub-allowances |
| I13 | The same `D_owner` can never execute twice |

### 16.2 Attack matrix
Every attack has a test, an entry in `PROOFS.json`, and a button in the attack kit.

**[BUILT]:**
- A1 recipient swap; A2 / A2b / A2-eoa SkimHook; A3 / A3b layout; A4 / A4b weak spec; A5 unattested target; A6 hidden pull; A7 expired; A8 ENS lookalike; A9 empty fee; A10 7702 sender; A11 reentrancy; A12 gas burn; F7 fee-first.
- Real Universal Router swap and wrap. Sepolia via Pimlico and Alchemy.

**[SPEC]:**
- A13 future-dated expiry; A14 fee-ticket overcommit; A15 revocation while transactions are pending; A16 UR allow-revert; A17 unknown command.
- B1 NFT drainer through an unattested collection; B2 vault `withdraw(to=attacker)`; B3 cross-chain snapshot; B4 older but valid snapshot with a revoked leaf; B5 leaf-type confusion; B6 signature-list padding; B7 omitted TOKEN leaf; B8 proxy implementation swap; B9 far-future `expiry_s`; B10 registry revocation while pending; B11 replaying A1–A12 on the stateless path.
- **B12:** replaying the same signed content under a different nonce key. Expected: rejected by `consumed[D_owner]`.
- **B13:** an attestor missing from the ENS anchor (Sepolia). Expected: revert.
- **B14:** an approval left standing after the batch. Expected: `APPROVALS_CLEARED` fails.

### 16.3 Measurement (publish in `ALTMEMPOOL.md` and the README)

| Metric | Stateless | Paymaster |
|---|---|---|
| Prefix gas per frame, including signatures, and headroom | measured | measured (88k today) |
| Accepted by the public pool / ERC-8421 | yes / yes | no / yes |
| **Pending transactions revalidated or evicted per trust update.** Queue N = 50 across several senders (LIFECYCLE-030 limits), then `refreshTrust` versus rotating the snapshot. | expected 0 | measured |
| Revocation latency (mempool / execution) | ≤ TTL / immediate | immediate / immediate |
| Transaction size | measured (+2–3.5 KB) | measured |
| Attacks caught | everything in §16.2 | A1–A17, B12, B14 |

### 16.4 Security posture
**`SECURITY.md`** covers the threat model (§2), the trust assumptions, static-analysis triage (Slither or Aderyn), and how to report a bug.

**Red-team:** at least 2 hours by someone who didn't write the code, **before the bounty goes live**.

**Bounty design** (production leg):
- **A policy-bounded signing oracle** holds one owner key and signs *any* submitted sentence that meets a published policy. The example policy:
  - only attested pools, with output to the account itself;
  - minimum output ≥ 98% of a pinned oracle price;
  - at most $100 per transaction;
  - no approval outlives its batch.
- **To win**, an attacker must lose the wallet's value *beyond the guarantees of a sentence the oracle signed*, or land a transaction that differs from its signed tree. The payout is the measured excess.
- **Attestor keys** are held by at least two parties outside the team, on separate devices.
- **Safe-harbour terms are published in writing.** Social engineering of the team, and attacks on the oracle server, are excluded.

---

## 17. Gates (in order; record every one in `PROOFS.json`)

| Gate | Work | Exit criterion | If it fails |
|---|---|---|---|
| **G0** | Status reconciliation (§0.1). Probes: (a) the expiry verifier is deployed on the devnet; (b) multiple explicit-`msg` SECP256K1 entries plus a SIGPARAM loop; (c) whether the sidecar counts signature gas toward 100k; (d) `EXTCODEHASH` on contracts that aren't entities; (e) the `[expiry_verify, self_verify]` and `[expiry_verify, only_verify, pay]` prefixes | All probes logged | (a) fails: keep the timestamp check in execution plus the device clock, with no frame 0. (b), (d) or (e) fails: **the stateless path becomes rule finding (e)** and the paymaster path ships alone. |
| **G1** | Paymaster-path upgrade: 4 frames, `txCommit` v11, the D2 rebuild-and-match, the snapshot cache checks, `consumed[]`, APPROVALS_CLEARED | A1–A17, B12, B14 green | Fix before anything else |
| **G2** | Stateless path minimum: sorted Merkle tree, attestor entries, 2 descriptors (transfer, v4 swap), `RevocationRegistry` | B1–B11 green; prefix ≤ 90k | Ship it as a measured finding plus the ERC draft |
| **G3** | Uniswap: the real-interface attack, Hook X-ray, URRender package, `FEEDBACK.md`, **the form** | Side-by-side recorded; form submitted | Never cut the form |
| **G4** | ERC-4337 production leg on an L2, the bounty oracle, the red-team, then go live | Honest swap on mainnet; bounty live after the red-team | Keep Sepolia only |
| **G5** | ENS anchor (§13); B13 | Records drive the attestor set; demo link live | Keep A8 plus names |
| **G6** | Measurement (§16.3); file the 4 findings; post the 2 ERC drafts | Links in the README | — |
| **G7** | **Feature freeze.** Rehearse three times, once with a devnet failure handled live; record the fallback video; submit | §19 checklist complete | — |

**Never cut:** the real-interface attack, "attack us", the proofs, the Uniswap blockers, the scope sheet.

**Cut order:**
1. hardware signer;
2. Hook X-ray;
3. ENS anchor (keep names);
4. stateless path (keep it as a finding plus the draft);
5. L2 bounty (keep Sepolia).

---

## 18. Demo (3 minutes or less)

**0:00–0:20.** "Bybit lost $1.5B because signers approved what a tampered screen told them. This is the real Uniswap app, compromised the same way."

**0:20–1:10.** Side by side. The ordinary wallet loses 99% to the hook. Verbatim rejects the transaction at the mempool, and the true sentence shows `! HOOK CAN TAKE YOUR OUTPUT`.

**1:10–1:40.** "The contract told the truth; the chain caught what it did." EvilVault fails with `AssertionFailed`.

**1:40–2:30.** "Attack us." Judges use the attack kit against the device they are holding. Every lie about the sentence is rejected at the mempool, and every lie about effects reverts. If G4 shipped, show the bounty counter.

**2:30–3:00.** Choose the close that matches what shipped:
- if G2 shipped: "zero stake and zero global state; invalidations per trust update, N versus 0";
- always: "two ERC drafts, four measured rule findings, a Uniswap renderer anyone can use, and ENS as the trust root. The chain is your wallet's screen."

**Q&A cards:**

| Question | Answer |
|---|---|
| "ADR-050 already does this" | Its delta table (§1) |
| "Why the mempool?" | Lies about the sentence never land. Lies about effects revert, and the user pays only gas. |
| "Who attests?" | Same answer as the captured-quorum line in §2 |
| "What about Binance?" | Out of scope |
| "Before Hegotá?" | ERC-4337 leg, any bundler |
| "Gas?" | Point to `GAS.md` |

---

## 19. Submission checklist
- [ ] **Prize picks:** EF Frame Transaction Alternative Mempool, Uniswap Build, ENS ENSv2.
- [ ] **Uniswap:** `FEEDBACK.md`, **the form**, and README line references.
- [ ] **ENS:** live demo link; no hard-coded values.
- [ ] **EF:** admitted transaction plus rejection logs in `PROOFS.md`; `ALTMEMPOOL.md`.
- [ ] **README:** one-liner, scope sheet, architecture, quickstart for each leg, addresses, the coverage count, and the ERC and findings links.
- [ ] **Docs:** `GAS.md`, `DECISIONS.md`, `STATUS.md`, `SECURITY.md`, `VTREE.md`, `VSPEC.md`, `VDESC.md`, `SNAPSHOT.md`.
- [ ] **Videos:** the main video and the fallback, each 3 minutes or less.
- [ ] A license.
- [ ] Every link works from a logged-out browser.

---

## 20. Decisions (do not re-litigate without new evidence)

| # | Decision | Reason |
|---|---|---|
| D1 | One snapshot trust model, two delivery paths, routed by gas | Stateless by default; the alt mempool for heavy renders and immediate revocation |
| D2 | Owner signatures use explicit-`msg` entries over `D_owner`, and every verifier rebuilds `D_owner` from its own render | `sig_hash` covers frame data; the sidecar has no `ecrecover`; this binds the render to what was signed |
| D3 | `txCommit` always blanks frame 1 and covers every other transaction field | Every verifier computes the same commitment; no padding or replay |
| D4 | Canonical expiry frame, plus the device clock, plus a TTL cap | A block number chosen by the host proves nothing |
| D5 | No global epoch; every call binds its descHash | No mass invalidation |
| D6 | Revocation keyed by leaf hash, checked at execution, liveness-only | Immediate revocation with no effect on the mempool |
| D7 | Unattested targets are refused; there is no effects-only mode | The host controls the effect list, so that mode is unsound |
| D8 | TOKEN presence proofs are mandatory; flagged tokens are refused | Risk metadata can't be omitted silently |
| D9 | No standing approvals, except the Permit2 base allowance with zero sub-allowances | The guarantees hold over time, not just within one batch |
| D10 | No delegatecall, no upgrade, no 7702; ERC-1271 off | Removes the takeover class |
| D11 | Fee charged first; per-nonce tickets on the paymaster path | ERC-8421 allows several pending transactions per sender |
| D12 | SECP256K1 owners; no native WebAuthn | No SHA256 precompile; P256 accepts raw digests only |
| D13 | Machine signers out of scope; no mandate mode | Honesty; heavy prior art |
| D14 | `COMMAND_TYPE_MASK = 0x7f`; pinned commits | Matches the real router |
| D15 | ERC-4337 production leg with `validUntil = expiry` and `txCommit = userOpHash` | Usable now; short expiries enforced |
| D16 | Heavy routing depends on the 1M staked budget | No overclaim on the sidecar |
| D17 | The bounty uses a policy-bounded oracle and independent attestor keys | It tests the claim, not just key secrecy |
| **D23** | **`consumed[D_owner]`, checked in VERIFY and set in execution** | Replay protection that doesn't depend on keyed-nonce semantics, which no TXPARAM exposes |
| **D24** | **ENSv2 records govern the attestor set and revocations on Sepolia, checked at execution** | Makes ENS central (who attests, who published, who you're paying, what's revoked) without validation reads |

---

## 21. Resources
- **Event:**
  - https://ethglobal.com/events/mumbai/prizes
  - Uniswap feedback form: https://developers.uniswap.org/hackathon-feedback
- **Protocol:**
  - EIP-8141: https://eips.ethereum.org/EIPS/eip-8141
  - ERC-8421: https://raw.githubusercontent.com/forshtat/ERCs/refs/heads/pr-clean/ERCS/erc-8421.md
  - Frame mempool: https://hackmd.io/@matt/frame-mempool
  - Devnet notes: https://notes.ethereum.org/@ethpandaops/frames-devnet-0
  - EIP-7906: https://eips.ethereum.org/EIPS/eip-7906
  - ERC-7562: https://eips.ethereum.org/EIPS/eip-7562
- **Devnet tooling:**
  - forshtat/ethrex (`eip8141-tracer`)
  - forshtat/mempool-workshop-sidecar
  - https://explorer.altmempool.wtf/
- **Clear signing and prior art:**
  - ERC-7730 and the LedgerHQ `clear-signing-erc7730-registry`
  - ERC-8176: https://ethereum-magicians.org/t/erc-8176-integrity-verification-for-erc-7730/27911
  - ERC-8283: https://ethereum-magicians.org/t/erc-8283-on-chain-registry-for-erc-7730-clear-signing-descriptors/28717
  - Kampela: https://ethereum-magicians.org/t/erc-onchain-clear-signing/28068
  - ADR-050: https://docs.cosmos.network/sdk/latest/reference/architecture/adr-050-sign-mode-textual.md
  - ERC-4430: https://eips.ethereum.org/EIPS/eip-4430
- **Uniswap:**
  - Uniswap/v4-core (`Hooks.sol`), v4-periphery (`Actions.sol`, HookMiner), universal-router (`Commands.sol`), permit2
  - Hook security: https://www.certik.com/blog/uniswap-v4-hooks-security-considerations
- **ENS:** the ENSv2 docs (Permissioned Registry, PermissionedResolver, Enhanced Access Control), linked from the prize page.
- **Incident:** the Bybit post-mortems (Safe{Wallet} S3 JavaScript injection).
