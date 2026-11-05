# context.md: Verbatim, end-to-end build spec and handoff

> **Audience:** the coding agent (or engineers) who will build Verbatim for ETHGlobal Mumbai (5–7 Nov 2026).
> **Status:** idea frozen at v7. **Nothing below has been run on the devnet yet.** Every protocol assumption the design depends on is listed as a falsifier (§19) and must be checked before building on top of it.
> **Verification labels used throughout:**
> - **[V]** verified from a primary or credible source during research;
> - **[U]** unverified, so check the source before relying on it;
> - **[D]** a design decision, already argued; do not re-litigate without new evidence (see §24).

---

## 0. Ground rules for the builder

1. **Build vertically, not horizontally.**
   - Follow the gates in §18 in order. Do not start a later gate until the earlier one passes on a real devnet transaction.
   - The single biggest risk is that the devnet does not behave like the draft specs.
2. **Measure, don't estimate.** Every gas number in this doc is a design target. Replace it with numbers from traces, and record them in `docs/GAS.md`.
3. **Fail closed everywhere.** Unknown selector, unknown command, renderer mismatch, over-depth recursion, unattested descriptor: all of these reject. They never fall back to "best effort".
4. **The two renderers must be byte-identical.**
   - The Solidity DisplayVM/URRender and the TypeScript twin must produce identical tree bytes.
   - A differential fuzzer (§16) is mandatory, not optional.
5. **Scope discipline.**
   - Do not add features outside this doc.
   - Earlier versions that added surface area scored worse with judges.
   - Cut order if time is short: ENS leg, then the Sepolia leg, then Uniswap v4 (keep v3 only), then the e-ink hardware (use an offline phone or laptop signer instead).
6. **Never claim more than the scope sheet (§2).** In particular: Verbatim does **not** protect compromised *machine* signers (the Binance class).

---

## 1. Product summary

### One line
**The chain checks that you signed the sentence you read, then checks that the asset-level effects you were shown actually happened.**

### Problem [V]
- **Bybit (21 Feb 2025, ~$1.5B):** Safe signers approved what a tampered Safe{Wallet} frontend *showed*. The frontend had been injected via S3 JS.
- **Drift (1 Apr 2026, ~$285M):** Security Council signers were phished into *pre-signing* misleading admin transactions. Durable nonces kept those signatures valid for weeks.
- **The 2026 pattern:** most losses came from compromised signers and signing paths, not code bugs (crypto.news, TRM).
- **Binance (29 Oct 2026, ~$6.36B):** a compromised machine signer plus 50 pre-signed EIP-7702 authorizations. **Out of scope for Verbatim; say so.**
- **Clear signing today is wallet-side only.** ERC-7730 is a JSON descriptor format; EF Clear Signing launched in 2026 [V for ERC-7730; the launch date is reported]. Every wallet renders independently, nothing on chain checks that what was shown matches what executes, and a contract can describe itself truthfully while doing something else.

### What Verbatim is
1. **A smart account (EIP-8141 frame-transaction account)** whose owners sign a **canonical display tree** (the "sentence"), not opaque calldata.
2. **A staked Renderer-Paymaster.** During validation it **re-renders the tree from the transaction's real calldata**, using descriptors pinned to each target's code. If the result doesn't match, it refuses to pay, so the transaction never enters the ERC-8421 alternative mempool.
3. **Execution-time assertions** derived from the tree. Declared deltas must happen, undeclared tracked assets must not decrease, and allowances and operators must not increase. Any violation reverts the batch.
4. **A dumb device is safe.** The signing device needs only a tree decoder and a screen: no internet, no registry, no metadata. A $10 e-ink or offline device is safe, because the chain does the checking.
5. **A Uniswap integration.**
   - The Universal Router (UR) and v4 swaps are rendered and asserted on-chain.
   - Hook permissions are read from the bits of the hook's address and shown as risk nodes.
   - The decoder ships as open-source ecosystem tooling.

### What Verbatim is not
- Not protection against stolen owner keys or compromised automated (machine) signers.
- Not an analysis of protocol-internal ledgers: lending positions, LP accounting, vault share math beyond "shares received ≥ declared".
- Not an AI or simulation-based risk engine. It is deterministic, descriptor-driven and fail-closed.

### Positioning against prior art [V unless marked]
| Work | What it does | Verbatim's delta |
|---|---|---|
| ERC-7730 / EF Clear Signing | Wallet-side rendering from JSON descriptors | Rendering is re-done on-chain; the signature binds the rendered tree; effects are asserted |
| Cosmos ADR-050 SIGN_MODE_TEXTUAL | Chain regenerates textual screens; the signature covers the screens | Same core move (**cite it**). Verbatim adds code-pinned descriptors for arbitrary EVM contracts, post-execution effect assertions, and mempool-level rejection |
| ERC-4430 (described transactions) | The contract supplies a description | Descriptions come from attested, code-pinned descriptors, not from the target |
| Kampela "ERC: Onchain Clear Signing" (Mar 2026) [reported] | Display-ID or hash check inside the target contract | Rendering moves out of the target, and effects are asserted |
| EIP-7906 (POST_TX, TXDIFF) [V] | Assertions via new opcodes; needs a fork and hand-written rules | Works today, with assertions *derived from the signed tree* |
| Safe guards, MetaMask caveat enforcers, Lighthouse (Solana) | Hand-written or simulation-derived checks | Checks are bound to what the user actually read |

---

## 2. Scope sheet (put this in the README verbatim)

**In scope**
- A human signer reading a sentence on a device, approving a transaction whose calldata a frontend or host may have tampered with (the Bybit class).
- An accurate-looking contract call with hidden effects on **tracked** assets or permissions: the "contract told the truth; the chain caught what it did" case.
- Stale pre-signed authority: `VALID_UNTIL` kills it within N blocks. This is a partial Drift mitigation only.
- Swap frontends lying about the minimum output, route, recipient, or hook risk (the Uniswap case).

**Out of scope (say it first)**
- Compromised machine signers with no human reading anything (Binance).
- Stolen owner keys.
- Collusion: a k-of-n attestor quorum compromised together with a compromised ENS publisher.
- A sentence that is accurate but misunderstood.
- Untracked state, protocol-internal ledgers, and admin-parameter-dependent behaviour.
- Off-chain signatures. ERC-1271 is off by default; opting in renders `NO_POST_CHECK`.

---

## 3. Prize tracks and qualification checklists

Rules from the ETHGlobal Mumbai prize page, read 5 Nov 2026 [V]:
- A team selects **at most three partner prizes**.
- **The EF places a project in at most one EF prize**, and EF judges decide which.
- Finalists are the top 10.

### Pick 1 (primary): EF, Best use of the Frame Transaction Alternative Mempool. $2,500 / $1,500 / $1,000 [V]
- **The brief:** build for EIP-8141 frame transactions via the alternative mempool (ERC-8421, ERC-7562-style rules).
  - The track has three areas: apps that need it (high-budget PQ wallets, flexible paymasters), developer tooling, and breaking or improving the rules.
  - **Judging:** creativity, usefulness, practicality, how well it works, and how it relates to the alternative mempool.
- **Requirement: proof of real alt-mempool usage.** Either an admitted transaction link on the devnet explorer, or code that submits one.
- **The team must explain its design and trade-offs.**
- **Our angle:** "POST_TX semantics today."
  - A **staked paymaster** that genuinely needs over 100k verification gas (up to 1M) and reads its own storage.
  - Frame-layout enforcement through introspection.
  - A deliberate design with **no third-party reads during validation**, so it can't be mass-invalidated.
- **Deliverables:**
  - an explorer link to an admitted transaction;
  - an explorer or log proof that a lying transaction was **rejected**;
  - `docs/ALTMEMPOOL.md` listing the rules we rely on and our trade-offs.
- **Resources:** altmempool.wtf, docs.altmempool.wtf, the devnet explorer (linked from the prize page), EIP-8141, ERC-7562.

### Pick 2: Uniswap, Build with Uniswap. $4,000 / $3,000 / $2,000 / $1,000 [V]
- **The brief:** build on or integrate any part of the Uniswap stack (API, v2/v3/v4 AMM, CCA, v4 hooks, extensions or improvements to official repos, ecosystem tooling).
- **Qualification (mandatory):**
  - [ ] a public GitHub repo, open source;
  - [ ] `FEEDBACK.md` in the repo;
  - [ ] a completed **Uniswap Developer Feedback Form** at https://developers.uniswap.org/hackathon-feedback, including the link to `FEEDBACK.md`;
  - [ ] a README that **points to the relevant contracts and line numbers** of the integration.
- **Our angle:**
  - `URRender`, an on-chain renderer for Universal Router and v4 calldata;
  - v4 **hook-permission risk nodes** from the hook address bits;
  - swap effect assertions, including Permit2;
  - a standalone library offered upstream.

### Pick 3 (cuttable): ENS, Best Use of ENSv2. $3,000 / $2,000 / $1,000 / $1,000 [V]
- **Requirements:**
  - [ ] ENSv2 on Ethereum mainnet or Sepolia;
  - [ ] ENSv2 features **central** to the project;
  - [ ] a functional demo with **no hard-coded values**;
  - [ ] a live demo link;
  - [ ] open-source code.
- **Our angle:**
  - The descriptor content hash is published on the protocol's ENSv2 name.
  - An **exclusivity proof** uses PermissionedResolver argument-scoped roles, renounced root roles, parent locks and an expiry horizon.
  - The publisher's name appears in every signed sentence.
  - Names are resolved forward and reverse.
  - **This runs on the Sepolia leg only**, because the frames devnet has no ENS.

### Not targeted
0G, Arkiv, the Swarm bonus, World, 1inch, Arc, Hedera, Whitechain, Definitive and Chainlink: none has an honest hook here. EF CROPS and Anon-RPC are excluded by the one-EF-prize rule.

---

## 4. Background primer (what you must know)

> Read the **current** spec text before coding. These drafts change. Field names, opcode numbers and mode numbers below are **intent-level**. Use whatever the devnet's client implements.

### 4.1 EIP-8141 Frame Transactions [V: concept; U: exact opcode semantics]
- **Status:** a new transaction type (0x06), Scheduled for Inclusion in **Hegotá (2027)** on 27 Aug 2026 [V].
- **Frames:** a transaction is a list of up to 64 frames [reported]. Each frame has a mode, target, gas and data. The modes:
  - **VERIFY:** static and validation-like. It must call `APPROVE(scope)`. The scopes are *execution*, *payment*, or both.
  - **SENDER:** `caller = tx.sender`.
  - **DEFAULT:** called from the protocol entry point.
- **`sig_hash`:** the hash of the transaction with **VERIFY frame data elided**. Signatures and other validation data can therefore live in VERIFY data without circularity.
- **Introspection opcodes** (names from the spec drafts; check exact semantics):
  - `TXPARAM(i)`: transaction-level parameters, including `sig_hash`, frame count, and others.
  - `FRAMEPARAM(frameIndex, field)`: a frame's target, mode, gas and flags.
  - `FRAMEDATALOAD(frameIndex, offset)` / `FRAMEDATACOPY`: read **any** frame's data. Reading other frames is falsifier F1.
  - `APPROVE(scope)`.
- **ATOMIC_BATCH flag:** a frame flag that links consecutive frames. The last frame can't carry it. **We do not use it [D].**
- **Transient storage** is discarded between frames [V from judging]. **Do not pass state across frames via TSTORE [D].**
- **Per-frame results** exist in ethrex's `FrameTxContext.frame_results` (status 0 = fail, 1 = success, 3 = skipped) [V], but **it is unconfirmed whether any opcode exposes them [U]. Our design does not depend on it [D].**
- **The ethrex simulate RPC** `ethrex_simulateFrameTransaction` was an open PR in the devnet notes [V]. Use it for admission debugging if present.

### 4.2 The ERC-8421 alternative mempool [V: author and existence; U: exact numbers]
- **What it is:** alt-mempool rules for EIP-8141, modelled on ERC-7562. Author: Alex Forshtat. The draft is at `raw.githubusercontent.com/forshtat/ERCs/refs/heads/pr-clean/ERCS/erc-8421.md`.
- **Numbers from our research (check):**
  - unstaked entity: **100k** verification gas;
  - **staked** entity: **1M**;
  - stake of about USD 1,000 with a **1-day** unstake delay;
  - staked entities may **read non-entity storage** (read-only);
  - keyed nonces;
  - canonical paymasters.
- **Public-pool baseline** (matt's frame-mempool design) [V]:
  - Validation reads only `tx.sender` storage.
  - Banned: block-dependent, tx-dependent, state-writing and balance-reading opcodes.
  - One pending frame transaction per sender.
  - A canonical paymaster is recognised by exact runtime-code match.
  - Nodes reserve pending balance per paymaster.
- **Consequence for us:** the Renderer-Paymaster must be a **staked entity** in the alt-mempool staking registry. It reads its **own** storage (TrustStore, prepaid deposits), plus target code (EXTCODEHASH, check F2). It makes no other external reads.
- **Workshop resources** (linked from the research file and prize page): `forshtat/mempool-workshop-sidecar`, `forshtat/ethrex` (eip8141-tracer), altmempool.wtf.

### 4.3 ERC-7562 (validation rules, for the Sepolia ERC-4337 leg) [V: rule IDs; U: exact text]
- **STO-010:** access to the sender's own storage.
- **STO-021:** the sender's associated storage in external contracts.
- **STO-033:** a staked entity may read non-entity storage.
- **OP-041:** EXTCODEHASH or EXTCODESIZE on an address with no code is forbidden. Only run it on targets that have code.
- **Banned opcodes:** TIMESTAMP, NUMBER, BLOCKHASH, BALANCE, and others. Do time and block checks **in execution**, not validation.
- **EntryPoint v0.7:** if `postOp` reverts, the paymaster still pays. Our prepaid-deposit model (D16) reserves the fee in the paymaster's own storage during validation, so the debit can't fail and no token pull is needed.

### 4.4 ERC-7730 (clear-signing descriptors) [V: format; U: UR coverage]
- **What it is:** JSON descriptors with context (contract deployments), metadata (owner, token info) and display formats per function. Field formats include `tokenAmount`, `addressName`, `date`, `raw` and `calldata` (nested).
- **Registry:** LedgerHQ `clear-signing-erc7730-registry` on GitHub. Check whether Universal Router descriptors exist and how they handle command dispatch [U, check F6c].
- **How we use it:** Verbatim **compiles a subset** of ERC-7730 into a compact binary descriptor (VDesc, §8.3). The device never sees descriptors, only rendered trees.

### 4.5 EIP-7906 [V]
- **What it is:** POST_TX frame mode plus TXDIFF / TXTRACE / EVENTDATACOPY opcodes. It hard-depends on 8141. The EF blog post was on 5 Oct 2026.
- **How we use it:** we **emulate** POST_TX via in-account snapshot and assertion. Keep the assertion-spec format forward-compatible, so it could compile to a POST_TX frame later.

### 4.6 Uniswap stack (see §11 for details) [V: architecture; U: exact constants]
- **Universal Router:** `execute(bytes commands, bytes[] inputs, uint256 deadline)`. Each command byte selects an ABI for the matching input.
- **v4:** a singleton PoolManager with flash accounting, and **hooks whose permissions are encoded in the least significant bits of the hook address** [V: CertiK, Cyfrin]. PoolKey = (currency0, currency1, fee, tickSpacing, hooks).
- **Permit2:** an allowance-based transfer proxy used by UR.

### 4.7 ENSv2 [V: launch and features; U: exact APIs]
- **What it is:** launched on mainnet 27 Oct 2026, with hierarchical registries, Enhanced Access Control (roles as bit flags on resources), and a PermissionedResolver with **argument-scoped** setter roles (for example, a role that may only set text key `clear-signing`).
- **Rule:** root grants override argument-scoped ones, so we must check that root-level `ROLE_SET_TEXT` and `ROLE_UPGRADE` are **not held by anyone except the intended path**, or have been renounced.
- **Resources:** ENSv2 docs (Permissioned Registry, Permissioned Resolver, Enhanced Access Control, contract developer guide), all linked from the prize page.

---

## 5. System architecture

### 5.1 Components
```
                    ┌────────────────────────── OFF-CHAIN ──────────────────────────┐
  dApp / frontend   │  tx-builder (frames-sdk)      displayvm-ts (renderer twin)      │
  (may be hostile)──┼─► builds calls ──► renders tree T, derives spec S ──► QR(T,S,    │
                    │                                                   sig_hash)     │
                    │                                   ▼                             │
                    │                     SIGNER DEVICE (air-gapped)                  │
                    │   decodes T → shows sentence → owner approves → signs EIP-712   │
                    │   (account, chainId, sig_hash, treeHash, specHash) → QR back    │
                    │                                   ▼                             │
                    │  submitter assembles 0x06 tx: [VERIFY sender | VERIFY RPM |     │
                    │                                SENDER executeVerified]          │
                    └───────────────────────────────────┬────────────────────────────┘
                                                        ▼
                    ┌──────────────── ERC-8421 ALT MEMPOOL (validation sim) ─────────┐
                    │ frame0 VerbatimAccount.VERIFY: layout lock + k-of-n sigs       │
                    │ frame1 RendererPaymaster.VERIFY: re-render(frame2.data)==T,    │
                    │        derive(T)==S, policy, fee checks → APPROVE(payment)     │
                    └───────────────────────────────────┬────────────────────────────┘
                                                        ▼
                    ┌──────────────────── EXECUTION (on chain) ──────────────────────┐
                    │ frame2 VerbatimAccount.executeVerified(fee, calls, spec):      │
                    │   pay fee → [inner self-call: TTL, re-checks, snapshot, CALLs, │
                    │   assert S] → on assert fail: batch reverts, fee kept          │
                    └────────────────────────────────────────────────────────────────┘
  TrustStore (in RPM storage) ◄── refreshTrust(attestations, ENS proofs) ◄── attestor-cli
```
"RPM" is the Renderer-Paymaster.

### 5.2 Trust boundaries
**Trusted:**
- the device's tree decoder and screen;
- the owners' keys;
- the k-of-n attestor quorum, **and** the ENS publisher (both must collude to lie);
- the EVM and the client.

**Untrusted:**
- the frontend, host and SDK output;
- the RPC;
- the submitter or relayer;
- the target contracts (their behaviour is asserted, not trusted);
- the TypeScript renderer (a mismatch fails closed).

### 5.3 Two deployments
| Leg | Chain | Account type | Paymaster logic location | Tracks served |
|---|---|---|---|---|
| A (primary) | EF frames devnet (EIP-8141 + ERC-8421) | `VerbatimAccount` (8141) | `RendererPaymaster` VERIFY frame | EF, Uniswap (self-deployed v4/Permit2/UR) |
| B | Sepolia | `VerbatimAccount4337` | `RendererPaymaster4337.validatePaymasterUserOp` | Uniswap (official Sepolia deployments), ENS |

**Shared code [D]:** DisplayVM, URRender, AssertionKit, the TrustStore format and the EIP-712 types are **identical libraries** across both legs. Only the entry points differ.

---

## 6. Transaction layout: frame-by-frame spec (Leg A)

```
frame 0  VERIFY  target=account (tx.sender)   → APPROVE(EXECUTION)   [unstaked budget ≤100k]
frame 1  VERIFY  target=RendererPaymaster     → APPROVE(PAYMENT)     [staked budget ≤1M]
frame 2  SENDER  target=account   data=executeVerified(fee, calls, spec)
```

### 6.1 Frame 0: `VerbatimAccount` VERIFY (the sender)

**Frame 0 data** (elided from `sig_hash`, but bound by the signatures):
```
abi.encode(
  bytes32 treeHash,
  bytes32 specHash,
  uint64  signedAtBlock,     // also inside tree as VALID_UNTIL basis
  bytes[] ownerSigs          // k-of-n, sorted by signer address, no duplicates
)
```

**Checks, in order. Any failure means revert, with no APPROVE:**
1. **Layout lock**, by introspection:
   - `TXPARAM(frameCount) == 3`;
   - frame 0's mode is VERIFY and its target is `address(this)`;
   - frame 1's mode is VERIFY and its target is `RENDERER_PAYMASTER`, an **immutable** in the account's bytecode;
   - frame 2's mode is SENDER and its target is `address(this)`;
   - frame 2's data selector is `executeVerified.selector`;
   - no ATOMIC_BATCH flags are set.
2. **Signatures:**
   - `digest = EIP712(VerbatimTx{account, chainId, sigHash: TXPARAM(sig_hash), treeHash, specHash, signedAtBlock})`;
   - recover k distinct owners from the owner set in **own storage**, with sorted unique signers;
   - reject trailing or unused signature bytes.
   - Use ecrecover; P256 via the EIP-7951 precompile is optional if present [U].
3. **Nonce:** the 8141 transaction nonce, or keyed nonces if the devnet supports them [U]. Nothing extra is needed.
4. `APPROVE(EXECUTION)`, with the scope **hard-coded**.

**Reads:** own storage only (the owner set and threshold). **No** TIMESTAMP or NUMBER. Budget target ≤ 30k.

**Fallback [D]:** if the devnet's 8141 build has a signature-list / ARBITRARY scheme instead of VERIFY data, signatures may go there. The digest is unchanged.

### 6.2 Frame 1: `RendererPaymaster` VERIFY (staked)

**Inputs:** it takes **none from its own frame data**, because that data is malleable. It reads:
- frame 0 data via FRAMEDATALOAD: `treeHash`, `specHash`, `signedAtBlock`;
- frame 2 data via FRAMEDATALOAD/FRAMEDATACOPY: `(fee, calls, spec)`.

**Checks:**
1. **Sender is canonical:**
   - `EXTCODEHASH(tx.sender) == VERBATIM_ACCOUNT_CODEHASH`;
   - reject EIP-7702-delegated EOAs (code prefix `0xef0100`).
2. **Render:** `T' = DisplayVM.render(chainId, sender, calls, fee, signedAtBlock, TrustStore)`. Require `keccak256(T') == treeHash`.
3. **Derive:** `S' = derive(T')`. Require `keccak256(S') == specHash` **and** `keccak256(spec arg in frame 2) == specHash`.
4. **Policy** (`policyOf[sender]` in own storage, default policy otherwise). Refuse:
   - any `BLIND` node not bounded by an assertion;
   - `UNVERIFIED_CONTRACT`, unless the policy allows it;
   - `NO_MIN_OUT` combined with any `HOOK_CAN_TAKE_*`;
   - `UNLIMITED_APPROVAL`, unless the policy allows it;
   - unknown risk codes. Fail closed.
5. **Fee checks: prepaid deposit model [D16].** The paymaster reads **only its own storage**:
   - `deposits[sender] − reserved[sender] ≥ fee.amount`, where `fee.asset` is ETH or an allowlisted token deposited earlier;
   - `fee.amount ≥ gasLimitTotal × cachedRate × (1 − tolerance)`, where `cachedRate` is updated rarely, with tolerance bands, so that rate updates don't cause pool churn.

   Deposits can decrease only through `charge()` from that account's own transactions, or through a withdrawal request that matures after `WITHDRAW_DELAY` (for example 1 hour). So **the fee cannot be made to fail between validation and execution**. This removes the fee-token balance read, the allowance problem, and the fee-griefing vector.
6. **One pending transaction per sender**, enforced by the mempool. Note it in the docs.
7. `APPROVE(PAYMENT)`.

**Reads:** own storage (TrustStore, policies, deposits, fee config), plus EXTCODEHASH of the sender and of targets with code (F2). **No live ENS reads, no proxy-slot reads, no oracle reads [D].**

### 6.3 Frame 2: `VerbatimAccount.executeVerified(Fee fee, Call[] calls, bytes spec)` (SENDER)
```
require(msg.sender == address(this))            // SENDER frame → caller is tx.sender == this (check F1b)
require(!locked); locked = true
// 0. fee first — failure reverts the frame; protected calls never run
IRendererPaymaster(RENDERER_PAYMASTER).charge(fee.asset, fee.amount)   // debits prepaid deposit; reverts if short
// 1. protected batch in inner self-call; its revert is caught
(bool ok, bytes memory err) = address(this).call{gas: gasleft() - ASSERT_RESERVE}(
    abi.encodeCall(this._protected, (calls, spec)))
emit VerbatimResult(ok, err)
locked = false
```

**`_protected(calls, spec)`:** callable only by `address(this)`, and only while `locked`. Steps:
1. Re-read `specHash` and `signedAtBlock` from frame 0 (FRAMEDATALOAD; check that this works from a SENDER frame, F1c). Require `keccak256(spec) == specHash`.
2. **TTL:** `block.number ≤ signedAtBlock + TTL_BLOCKS`. Default 25 blocks, about 5 minutes; configurable per policy and shown in the tree.
3. **Live re-checks:**
   - every target's EXTCODEHASH equals the value rendered;
   - EOA targets still have no code;
   - the proxy implementation and admin are unchanged, if the tree has `UPGRADEABLE_TARGET`, using the EIP-1967 getter where available;
   - on Leg B, ENS names in the tree still resolve forward and reverse, with CCIP-read and wildcard resolvers rejected;
   - the TrustStore epoch is at least the tree's epoch, and its age is within `maxAge` for high-risk nodes.
4. **Snapshot** the tracked set into memory (§9.5).
5. **Execute** each call with `CALL` only (no DELEGATECALL anywhere in the account), with bounded gas per call. `value` is allowed and is shown in the tree.
6. **Assert** the spec (§9.4). On failure, `revert AssertionFailed(index, expected, actual)`.

**Why the fee comes first [D]:** v5 used a separate non-atomic fee frame. A failed fee transfer still let the protected calls run, and the paymaster ate the gas. Now fee failure means nothing protected runs, and an assertion failure leaves the fee paid. Griefing therefore costs the griefer. With the deposit model, the fee also can't fail after validation passes, because only this account's own pending transaction, or a delayed withdrawal, can lower the deposit.

---

## 7. On-chain contracts

Solidity 0.8.2x. See §17 for the opcode toolchain caveat.

### 7.1 `VerbatimAccount` (Leg A)
**Storage:**
```
address[] owners; uint8 threshold;
mapping(bytes32 => LedgerEntry) approvalLedger; bytes32[] ledgerKeys;   // bounded (MAX_LEDGER=64)
address[] watchlist;                                                     // bounded (MAX_WATCH=32)
bool locked;
```
**Immutables:** `RENDERER_PAYMASTER`, `TTL_BLOCKS_MAX`.

**Functions:**
- **The VERIFY entry**, frame 0 (§6.1). How 8141 dispatches the VERIFY frame to an account is client-specific; check the ethrex examples (F0).
- **`executeVerified(Fee, Call[], bytes spec)`**, frame 2 (§6.3).
- **`_protected(Call[], bytes spec)`**, an internal-external function; it requires `msg.sender == address(this) && locked`.
- **Self-administration, only through a verified batch** (`calls` targeting `address(this)`), each rendered with `TRUST_CHANGE` / owner-change risk nodes:
  - `addOwner`, `removeOwner`, `setThreshold`;
  - `addWatch` / `removeWatch`;
  - `pruneLedger`.
- **Ledger maintenance is automatic:** when a call renders as an `approve`, `setApprovalForAll` or Permit2 `approve`, the account records the spender in the ledger during `_protected`.
- `ledgerHash()` and `owners()` views.

**Invariants:**
- no `delegatecall`, no `selfdestruct`, no upgradeability [D];
- `isValidSignature` returns failure unless ERC-1271 is opted in per domain [D].

### 7.2 `RendererPaymaster` (Leg A)
**Storage:**
- **TrustStore** (§7.6);
- `policyOf[account]`;
- `deposits[account][asset]` and `withdrawRequests[account]` (amount, `readyAt`), plus the fee-asset allowlist and `cachedRate`;
- **stake registration**, in the alt-mempool staking registry (check the address and API on the devnet, F2).

**Functions:**
- the VERIFY entry, frame 1 (§6.2);
- `refreshTrust(TrustUpdate)` (§9.6);
- `deposit(asset, amount)` (payable for ETH);
- `requestWithdraw(asset, amount)` and `withdraw()`, which only works after `WITHDRAW_DELAY`;
- `charge(asset, amount)`, which only `msg.sender == account` may call, during that account's `executeVerified`;
- `setPolicy` (by the account, via a verified batch);
- `withdrawFees` (owner-gated, delayed).

**Immutables:** `VERBATIM_ACCOUNT_CODEHASH`.

### 7.3 `DisplayVM` (library, Solidity) plus `displayvm-ts` (its twin)
- **Inputs:** chainId, account, calls, fee, signedAtBlock, a TrustStore view, and the TTL from policy.
- **Algorithm (§9.1):** look up each call's descriptor by `(EXTCODEHASH(target), selector)`, then decode the ABI fields per the VDesc, emit nodes, recurse into nested calldata fields up to `MAX_DEPTH = 3`, and emit risk nodes. Special targets dispatch to `URRender`: UR, and the PoolManager/Permit2 paths.
- **Output:** canonical tree bytes (§8.1). Hash with keccak256.
- **Gas:** no string building. Labels are **ids** into the descriptor's label table, and the device holds no label strings. **[D]:** label strings are included in the tree as short ASCII (≤ 48 chars, restricted charset) so the device needs no data. Keep them short.

### 7.4 `URRender` (library, Solidity) plus its TS twin (§11)
- **What it is:** a dedicated decoder for the Universal Router `execute(commands, inputs, deadline)` and v4 actions.
- **Why:** more precise and cheaper than generic descriptor recursion.
- **Shipping:** it is the Uniswap ecosystem deliverable, so keep it standalone with no Verbatim dependencies, in its own package, with its own tests.

### 7.5 `AssertionKit` (library)
- **What it does:** snapshot and assert routines over `Spec` (§8.4), working on memory structs.
- **Readers:** `balanceOf`, `allowance`, Permit2 `allowance(owner, token, spender)`, `isApprovedForAll`, `ownerOf`, ERC-1155 `balanceOf`, `getApproved`, EXTCODEHASH, the ETH balance.
- **Each read** is a STATICCALL with bounded gas. A failed read means the assertion fails, closed.

### 7.6 TrustStore (inside `RendererPaymaster` storage)
```
uint64 epoch;                                    // monotonic
mapping(bytes32 codehash => mapping(bytes4 selector => bytes32 descHash)) descriptorOf;
mapping(bytes32 descHash => address) descriptorBlob;   // SSTORE2 pointer to VDesc bytes
mapping(bytes32 descHash => DescMeta) meta;            // publisherNameHash, publisherName(≤48B), attestedEpoch, flags
mapping(bytes32 descHash => bool) revoked;
mapping(address token => TokenInfo) tokens;            // symbol(≤11B ASCII), decimals, flags(FOT, rebasing, pausable)
mapping(bytes32 codehash => ProxyTemplate) proxyTemplates;   // known proxy/beacon/diamond bytecode
mapping(bytes32 hookCodehash => bool) attestedHooks;
mapping(address => NameCache) names;                   // Leg B: addr → ENS name (normalized), verifiedEpoch
address[] attestors; uint8 attestorThreshold;
```

### 7.7 Leg B contracts (Sepolia, ERC-4337 EntryPoint v0.7)
- **`VerbatimAccount4337`:**
  - `validateUserOp` checks k-of-n signatures over the same EIP-712 digest, with `sigHash := userOpHash`;
  - it requires `paymasterAndData[0:20] == RENDERER_PAYMASTER`;
  - it requires `callData` to be `executeVerified(fee, calls, spec)`;
  - **treeHash, specHash and signedAtBlock** travel in `signature` alongside the owner signatures.
- **`RendererPaymaster4337`:**
  - `validatePaymasterUserOp` runs the same render, derive and policy checks;
  - it uses the **same prepaid-deposit model**: it checks and reserves `deposits[sender]` in its own storage during validation, and debits in execution (or in `postOp`, which can't fail, because the deposit was reserved);
  - it reads only its own storage and caches (STO-033) plus EXTCODEHASH on targets that have code (OP-041);
  - **no `transferFrom` happens during validation.**
- **`EnsTrustChecker`:** used by `refreshTrust` on Leg B (§12).
- **Deployment:** use Uniswap's **official Sepolia** v4 PoolManager, UR and Permit2 addresses. Look them up in the Uniswap docs and record them in the README.

### 7.8 Test and demo contracts
- **`EvilVault`:** `deposit(uint256)` renders honestly as "Deposit X USDC" but also does `WETH.transferFrom(msg.sender, attacker, all)` using an old approval.
- **`SkimHook`:** a v4 hook with `afterSwapReturnsDelta` that takes about 99% of the output. Its address must be mined to have the right flag bits; use `HookMiner` from v4-periphery or v4-template.
- **`SweeperDelegate`:** the comparison case for the Binance-style EIP-7702 drain against a plain EOA. This is optional, a narrative slide only.

---

## 8. Data formats (normative)

### 8.1 Display tree canonical encoding (VTREE v1)
**Format:** a byte-oriented, length-prefixed TLV that is deterministic and unambiguous. All integers are big-endian.

```
Tree    := MAGIC(0x56540001 "VT\0\1") Header Node*
Header  := chainId(u64) account(20) signedAtBlock(u64) validUntilBlock(u64) trustEpoch(u64)
Node    := type(u8) len(u16) payload(len)
```

| type | name | payload |
|---|---|---|
| 0x01 | CALL_BEGIN | target(20) codehash(32) selector(4) descHash(32) intentLabel(str) publisherName(str) attestStatus(u8) |
| 0x02 | CALL_END | — |
| 0x10 | FIELD_ADDRESS | label(str) addr(20) nameSource(u8: 0 none, 1 ENS-verified, 2 contact) name(str) flags(u8: hasCode, isSelf) |
| 0x11 | FIELD_AMOUNT | label(str) token(20) symbol(str) decimals(u8) raw(u256) |
| 0x12 | FIELD_UINT | label(str) value(u256) unit(u8) |
| 0x13 | FIELD_BOOL | label(str) v(u8) |
| 0x14 | FIELD_ENUM | label(str) code(u16) text(str) |
| 0x15 | FIELD_BYTES | label(str) keccak(32) len(u32) (opaque data is always hashed, never shown raw) |
| 0x16 | FIELD_ETH_VALUE | raw(u256) |
| 0x20 | GROUP_BEGIN / 0x21 GROUP_END | label(str) (nested calldata, UR command, v4 action) |
| 0x30 | RISK | code(u16) args(bytes) (§8.5) |
| 0x31 | BLIND | label(str) keccak(32) len(u32) boundBy(u16 assertion index or 0xFFFF) |
| 0x40 | FEE | token(20) symbol(str) decimals(u8) amount(u256) gasLimitTotal(u64) |
| 0x41 | VALID_UNTIL | block(u64) |
| 0x42 | POLICY | policyHash(32) |

**Encoding rules:**
- `str` is `len(u8)` followed by ASCII bytes in `[0x20–0x7E]` minus `\`, at most 48 bytes. Any non-conforming name falls back to `nameSource = 0`, with the hex address shown.
- **Amounts are never rounded.** The device formats `raw / 10^decimals` as an exact decimal string with no grouping ambiguity: digits, an optional single `.`, then the symbol.
- `treeHash = keccak256(TreeBytes)`.
- **Device rendering rule:** every node is shown. There is no hidden node type, and risk nodes are shown first, highlighted.

### 8.2 EIP-712 types
```
EIP712Domain(string name="Verbatim",string version="1",uint256 chainId,address verifyingContract=account)
VerbatimTx(bytes32 sigHash,bytes32 treeHash,bytes32 specHash,uint64 signedAtBlock)
```
**About `sigHash`:**
- On Leg A it is `TXPARAM(sig_hash)`.
- On Leg B it is `userOpHash`.
- The device **cannot check** `sigHash`. It displays the tree and trusts the chain to bind it, and that binding is what the layout lock plus the re-render provides.

### 8.3 VDesc: the compiled descriptor format
```
VDesc := MAGIC(0x56440001) intentLabel(str) nFields(u8) Field* nEffects(u8) Effect* riskFlags(u16)
Field := abiPath(bytes: tuple/array path) kind(u8) label(str) params(bytes)
   kind: 1 ADDRESS(role: recipient|spender|operator|other)
         2 TOKEN_AMOUNT(tokenSource: TARGET | FIELD(path) | CONST(addr))
         3 UINT(unit) 4 BOOL 5 ENUM(table) 6 BYTES_OPAQUE 7 CALLDATA(targetSource, valueSource) 8 ETH_VALUE
Effect := kind(u8) params
   1 OUT_EXACT(token, amountPath, toPath)            → DELTA_EQ(account, token, -amount)
   2 IN_MIN(token, amountPath)                       → DELTA_GE(account, token, +amount)
   3 APPROVE_SET(token, spenderPath, amountPath)     → ALLOWANCE_EQ(token, spender, amount) + ledger add
   4 OPERATOR_SET(collection, operatorPath, boolPath)→ OPERATOR_EQ(...)
   5 SHARES_MIN(shareToken, minPath)                 → DELTA_GE(account, shareToken, min)
   6 NFT_OUT(collection, idPath, toPath)             → OWNER_EQ(collection, id, to)
riskFlags: UNLIMITED_APPROVAL_IF(amount==max), OPERATOR_APPROVAL, ADMIN_FUNCTION, ...
```
- **The compiler** (`vdesc-compiler`, TS) turns ERC-7730 JSON plus a Verbatim "effects" extension into VDesc bytes. It is written with SSTORE2 by `refreshTrust`.
- `descHash = keccak256(VDesc bytes)`.
- **The effects extension is ours.** ERC-7730 has no effects section [D]. Document it in `docs/VDESC.md` and propose it upstream.

### 8.4 Assertion spec (VSPEC v1)
```
Spec := MAGIC(0x56530001) nItems(u16) Item*
Item := op(u8) args
  0x01 DELTA_EQ     (holder=account, asset, int256 delta)      asset: 0x0 = ETH
  0x02 DELTA_GE     (holder, asset, uint256 min)               holder may be displayed recipient
  0x03 ALLOW_LE     (token, spender, uint256 max)               ERC-20 allowance(account,spender)
  0x04 P2ALLOW_LE   (token, spender, uint160 max)               Permit2 allowance(account,token,spender).amount
  0x05 OPERATOR_EQ  (collection, operator, bool)
  0x06 OWNER_EQ     (collection, id, owner)
  0x07 CODEHASH_EQ  (target, bytes32)
  0x08 NO_CODE      (addr)
  0x09 TRACKED_NO_DECREASE   ()   // every tracked asset not named by an exact item: post ≥ pre
  0x0A TRACKED_NO_ALLOW_INC  ()   // every ledger allowance/operator: post ≤ pre unless named
  0x0B ACCOUNT_INVARIANT     ()   // owners, threshold, code, policy unchanged unless TRUST_CHANGE node
```
- **Derivation:** `derive(tree)` is deterministic. Effects come from each call's VDesc; the defaults `0x09`, `0x0A` and `0x0B` are always appended.
- `specHash = keccak256(SpecBytes)`.
- **Forward compatibility:** each item maps 1:1 to an EIP-7906 TXDIFF-based POST_TX check.

### 8.5 Risk codes
| code | name | emitted when |
|---|---|---|
| 0x0001 | UNLIMITED_APPROVAL | approve amount ≥ 2^255 or == max |
| 0x0002 | OPERATOR_APPROVAL | setApprovalForAll(true) |
| 0x0003 | UPGRADEABLE_TARGET(upgrader) | target codehash matches a proxy template |
| 0x0004 | UNVERIFIED_CONTRACT | no attested descriptor for (codehash, selector) |
| 0x0005 | TRUST_CHANGE | call to account self-admin or paymaster policy |
| 0x0006 | NO_POST_CHECK | opted-in ERC-1271 message |
| 0x0007 | RECIPIENT_HAS_CODE | recipient address has code (incl. 7702 delegation prefix) |
| 0x0008 | RECIPIENT_NOT_SELF | swap/transfer output to address ≠ account |
| 0x0101 | NO_MIN_OUT | swap amountOutMinimum == 0 or < policy floor |
| 0x0102 | HOOK_CAN_TAKE_INPUT | v4 hop hook has beforeSwapReturnsDelta flag |
| 0x0103 | HOOK_CAN_TAKE_OUTPUT | v4 hop hook has afterSwapReturnsDelta flag |
| 0x0104 | HOOK_DYNAMIC_FEE | PoolKey.fee has dynamic-fee flag |
| 0x0105 | HOOK_UNVERIFIED | hook codehash not in attestedHooks |
| 0x0106 | SWEEP_TO_OTHER | UR SWEEP/PAY_PORTION recipient ≠ account |
| 0x0107 | PERMIT2_ALLOWANCE_CHANGE | Permit2 approve in batch |
| 0x0108 | UR_ALLOW_REVERT | a UR command has the allow-revert flag (partial execution) |
| 0x0201 | TTL_LONG | validUntil − signedAt > policy default |

---

## 9. Algorithms

### 9.1 `render`
```
render(ctx, calls, fee):
  emit Header(chainId, account, signedAtBlock, signedAtBlock+ttl, trust.epoch)
  emit FEE(fee...); emit VALID_UNTIL(...)
  for call in calls: renderCall(call, depth=0)
  emit POLICY(policyHash)

renderCall(c, depth):
  require depth ≤ MAX_DEPTH
  ch = EXTCODEHASH(c.target)
  if ch == 0: render plain ETH transfer (FIELD_ETH_VALUE + FIELD_ADDRESS); if data nonempty → UNVERIFIED_CONTRACT
  if isUR(c.target, ch): return URRender.render(c, depth)
  if proxyTemplates[ch]: emit RISK(UPGRADEABLE_TARGET, upgraderFromTemplate); use descriptor keyed by
        (template-declared logic codehash cached at attestation)  // no live slot reads in validation
  desc = descriptorOf[ch][selector]; if none or revoked → emit RISK(UNVERIFIED_CONTRACT); emit BLIND(...)
  emit CALL_BEGIN(...publisherName, attestStatus)
  for f in desc.fields: decode ABI at f.abiPath → emit FIELD_*; CALLDATA → renderCall(nested, depth+1)
  emit risk flags; CALL_END
```

**The proxy rule [D]:**
- Validation can't read a proxy's implementation slot. That would be a third-party read and an invalidation risk, and the EVM has no EXTSLOAD for reads without a getter.
- So validation renders `UPGRADEABLE_TARGET` from the cached attestation, and `_protected` re-checks the implementation **live** at execution.
- If it has changed, the transaction reverts.

### 9.2 `derive`
- Walk the tree, and for each CALL, map the VDesc effects to Spec items, using the decoded field values.
- Append `TRACKED_NO_DECREASE`, `TRACKED_NO_ALLOW_INC` and `ACCOUNT_INVARIANT`.
- `BLIND` nodes must be referenced by a bounding item; otherwise policy rejects.

### 9.3 Policy
- **The default policy refuses:**
  - `UNVERIFIED_CONTRACT`;
  - an unbounded `BLIND`;
  - `UNLIMITED_APPROVAL`;
  - `NO_MIN_OUT` combined with `HOOK_CAN_TAKE_*`;
  - `HOOK_UNVERIFIED` combined with any `HOOK_CAN_TAKE_*`;
  - `TTL_LONG`.
- **`policyHash`** is in the tree, so the user signs the policy in force.

### 9.4 Assertion evaluation
- **For each item:** compute `post` and compare it with `pre` from the snapshot.
- **Delta semantics:** `delta = post − pre`, measured on the **holder** named in the item.
- **The tracked set** = ledger tokens ∪ assets touched (every token in any FIELD_AMOUNT) ∪ watchlist ∪ ETH.
- **Rebasing and fee-on-transfer tokens:** flagged in TokenInfo. Policy bans them by default.

### 9.5 Snapshot
- **What is captured, into a memory array:**
  - for every tracked asset: `balanceOf(account)`, plus the recipient's balance for DELTA_GE items with a non-self holder;
  - for every ledger entry: ERC-20 `allowance`, Permit2 `allowance`, or `isApprovedForAll`;
  - the owners hash and threshold;
  - EXTCODEHASH of `address(this)`.
- **Bound:** at most `MAX_LEDGER + MAX_WATCH + touched` reads. Record the measured gas.

### 9.6 `refreshTrust(TrustUpdate u)`
This runs outside validation, as a normal transaction, so live reads are fine here.
1. `require(u.epoch > epoch)`. This is the monotonic-epoch rule.
2. Verify ≥ `attestorThreshold` attestor signatures over `keccak256(u)`. These are ERC-8176/EAS-style signatures; plain EIP-712 is fine for the hackathon.
3. For each descriptor:
   - on Leg B, call `EnsTrustChecker.check(publisherName, descHash)` (§12);
   - on Leg A (no ENS), require attestors only, and mark `attestStatus = ATTESTED_NO_ENS`;
   - store via SSTORE2 and set `descriptorOf`.
4. Apply revocations, token info, proxy templates and attested hooks.
5. **Version the caches:** each tree records `trustEpoch`. A descriptor revocation invalidates only the pending transactions that use it.

---

## 10. Off-chain components (TypeScript monorepo, pnpm)

| Package | Purpose | Key requirements |
|---|---|---|
| `packages/displayvm-ts` | Twin of DisplayVM, URRender and derive | Byte-identical output; exported `render()`, `derive()`, `decodeTree()`, `formatForDevice()` |
| `packages/vdesc-compiler` | ERC-7730 JSON plus the effects extension → VDesc bytes | Deterministic; golden tests |
| `packages/frames-sdk` | Build, serialize and submit type-0x06 transactions (viem extension) | Frame encoding, `sig_hash` computation, submission to the alt-mempool RPC, an admission-error decoder; uses `ethrex_simulateFrameTransaction` if available |
| `packages/signer` | Device app | Scans QR(tree, specHash, sigHash, meta), shows the sentence, signs EIP-712, returns a signature QR. Targets: (1) **an offline web app on a phone in airplane mode** (the baseline); (2) a stretch e-ink build (ESP32/RPi Zero + e-ink + camera) |
| `packages/attestor-cli` | Builds a TrustUpdate | Compiles descriptors, collects k attestor signatures, publishes the ENS record on Leg B, submits `refreshTrust` |
| `apps/wallet` | Demo wallet UI | Composes a batch, shows the TS-rendered tree, hands off to the signer, submits to Leg A or B |
| `apps/evil-frontend` | The "attack us" kit | Toggles: swap recipient, minOut=0 plus SkimHook route, drop the renderer frame, swap the spec, poison a descriptor (wrong descHash), replay a stale signature, a lookalike ENS name |
| `apps/swap-demo` | A Uniswap swap page (honest mode and evil mode) | Uses the UR SDK (or hand-built commands) on the devnet's self-deployed v4 and the Sepolia official contracts |
| `tools/difffuzz` | Differential fuzzer | Random calls and descriptors → Solidity render (via forge FFI or a local node) and TS render → assert equal bytes; at least 10k cases per CI run |
| `tools/gas-report` | Trace-based gas sheet | Writes `docs/GAS.md` |

**Device format details:**
- The QR payload is tree bytes plus metadata, compressed with deflate. Use an animated QR (UR/BC-UR style) if it exceeds about 2 KB.
- The device decodes VTREE strictly and **refuses unknown node types**.

---

## 11. Uniswap integration (detailed)

> **Every constant below is from memory and must be checked against the source repos** (`Uniswap/universal-router` `Commands.sol` and `ActionConstants`, `Uniswap/v4-periphery` `Actions.sol`, and `Uniswap/v4-core` `Hooks.sol` and `LPFeeLibrary`) **before coding [U].**

### 11.1 Universal Router
- **The entry point:** `execute(bytes commands, bytes[] inputs, uint256 deadline)`. Also handle `execute(bytes, bytes[])` without a deadline. In that case the TTL is the only expiry, and `TTL_LONG` policy applies.
- **The command byte:**
  - low bits are the command type (mask `0x3f`) [U];
  - the high bit `0x80` is `FLAG_ALLOW_REVERT` [U], which emits `UR_ALLOW_REVERT`.
- **v1 command whitelist, with recalled values [U]:**

  | Command | Value |
  |---|---|
  | `V3_SWAP_EXACT_IN` | `0x00` |
  | `SWEEP` | `0x04` |
  | `PAY_PORTION` | `0x06` |
  | `WRAP_ETH` | `0x0b` |
  | `UNWRAP_WETH` | `0x0c` |
  | `V4_SWAP` | `0x10` |

  Everything else renders `BLIND` and is refused.
- **Recipient constants [U]:** `MSG_SENDER = address(1)` maps to "this account" and `ADDRESS_THIS = address(2)` maps to "router (transient)". Render them explicitly as `isSelf` or `ROUTER`.
- **`V3_SWAP_EXACT_IN` input:** `(recipient, amountIn, amountOutMin, path, payerIsUser)`.
  - Decode the packed path as `token(20) | fee(3) | token(20) …` and render every hop.
  - Assert the first token's `DELTA_EQ(-amountIn)` when `payerIsUser`, and the last token's `DELTA_GE(recipient, amountOutMin)`.
- **`V4_SWAP`:** its input is `(bytes actions, bytes[] params)`.
  - **v1 action whitelist** (check the values in `Actions.sol`): `SWAP_EXACT_IN_SINGLE`, `SETTLE_ALL`, `TAKE_ALL`. Optionally `SWAP_EXACT_IN` (multi-hop PathKeys).
  - `SWAP_EXACT_IN_SINGLE` params are `(PoolKey poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)` [U].
  - `hookData` renders as FIELD_BYTES (hashed) plus the hook risk nodes.
- **`WRAP_ETH` / `UNWRAP_WETH`:** `(recipient, amount)`. The ETH value must equal the call's `value` (assert `DELTA_EQ(ETH, -value)` net).
- **`SWEEP` / `PAY_PORTION`:** a recipient other than self emits `SWEEP_TO_OTHER`.

### 11.2 v4 hook risk from address bits [V: concept; U: positions]
- **How it works:** hook permissions are encoded in the least significant bits of the hook address, and v4-core validates them.
- **Recalled positions** from `Hooks.sol` (check them):

  | Flag | Bit |
  |---|---|
  | BEFORE_INITIALIZE | 13 |
  | AFTER_INITIALIZE | 12 |
  | BEFORE_ADD_LIQUIDITY | 11 |
  | AFTER_ADD_LIQUIDITY | 10 |
  | BEFORE_REMOVE_LIQUIDITY | 9 |
  | AFTER_REMOVE_LIQUIDITY | 8 |
  | BEFORE_SWAP | 7 |
  | AFTER_SWAP | 6 |
  | BEFORE_DONATE | 5 |
  | AFTER_DONATE | 4 |
  | **BEFORE_SWAP_RETURNS_DELTA** | **3** |
  | **AFTER_SWAP_RETURNS_DELTA** | **2** |
  | AFTER_ADD_LIQUIDITY_RETURNS_DELTA | 1 |
  | AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA | 0 |

- **The dynamic fee flag:** `PoolKey.fee == 0x800000` [U] emits `HOOK_DYNAMIC_FEE`.
- **Node mapping:**
  - `BEFORE_SWAP_RETURNS_DELTA` → `HOOK_CAN_TAKE_INPUT`;
  - `AFTER_SWAP_RETURNS_DELTA` → `HOOK_CAN_TAKE_OUTPUT`;
  - a hook codehash not in `attestedHooks` → `HOOK_UNVERIFIED`;
  - `hooks == address(0)` → no hook nodes.
- **Cost:** pure calldata math plus one EXTCODEHASH of the hook. It adds no invalidation surface.

### 11.3 Permit2
- **Flow:** UR pulls tokens from the account via `Permit2.transferFrom` when `payerIsUser`. The account must have done both:
  - `token.approve(Permit2, X)`, rendered as an ERC-20 approve with a spender label of "Permit2";
  - `Permit2.approve(token, UR, amount, expiration)` **on-chain**, rendered with `PERMIT2_ALLOWANCE_CHANGE`, the amount and the expiration.
- **We do not support Permit2 signatures** in v1, because ERC-1271 is off. Render `PERMIT2_PERMIT` commands as refused.
- **Swap assertions add:** `P2ALLOW_LE(token, UR, preAllowance − amountIn)`, so no leftover allowance can appear.

### 11.4 Demo pools (Leg A devnet, self-deployed)
1. Deploy WETH9, two ERC-20s (dUSDC, dWETH), the v4 PoolManager, PositionManager (for liquidity), Permit2 and the Universal Router. Use the official repos and record the commit hashes.
2. Create an honest pool `(dWETH, dUSDC, 3000, 60, hooks=0)` and the evil pool with the same pair, using `SkimHook` with a mined address that has `AFTER_SWAP_RETURNS_DELTA`.
3. Add liquidity to both, then add the attested descriptors and hooks via `refreshTrust`. Do **not** attest SkimHook.

### 11.5 Ecosystem deliverable and FEEDBACK.md
- **`URRender`:** a standalone package (Solidity plus TS) with README examples. It provides "on-chain human-readable UR/v4 calldata, with hook risk".
- **Upstream:** open an issue or PR to the relevant Uniswap repo, or to the ERC-7730 registry, describing UR rendering. Link it in the README.
- **`FEEDBACK.md`:** friction from deploying v4 on a custom devnet, UR command docs, hook mining, Permit2 UX, gas notes. Then submit the form.

---

## 12. ENS integration (Leg B only)

> **Check every ENSv2 API name in the ENSv2 docs [U].** The roles are bit flags on resources (EAC). The PermissionedResolver supports argument-scoped setter roles. Root grants override argument-scoped grants [V from earlier research].

### 12.1 Publishing (attestor-cli, by the protocol or our demo protocol)
- **The name:** the protocol owns, for example, `demo-vault.verbatim-test.eth` on Sepolia ENSv2.
- **The resolver:** a PermissionedResolver. It grants the **argument-scoped** text-setter role for key `clear-signing` to the security council (a multisig address).
- **What is renounced:** root-level `ROLE_SET_TEXT` and `ROLE_UPGRADE` on the resolver, for all holders except as documented.
- **The record:** text `clear-signing` = `descHash` (hex), optionally with an `epoch`.

### 12.2 `EnsTrustChecker.check(name, descHash)`
This runs in `refreshTrust`, outside validation. Each step must pass:
1. Resolve the name's resolver via the ENSv2 registry. **Reject wildcard resolution and CCIP-read [D].**
2. The resolver's codehash equals the pinned PermissionedResolver codehash.
3. `text(node, "clear-signing") == descHash`.
4. **Exclusivity:**
   - no root-level `ROLE_SET_TEXT` or `ROLE_UPGRADE` holder other than the expected ones (via `hasRoles` or the equivalent);
   - the argument-scoped setter for `clear-signing` is held only by the council.
5. **Registry-level locks:** for the name and **every parent up to the TLD**, nobody but the expected parties can change the resolver or subregistry (check the ENSv2 registry roles API).
6. **Expiry:** `expiry(name) ≥ now + HORIZON` (for example 365 days) for the name and every parent.
7. Cache `publisherName` (ENSIP-15 normalized off-chain by the CLI and checked against restricted ASCII on-chain), and the verified epoch.

**Irreducible trust:** the ENS DAO and root. State this in the README.

### 12.3 Names in sentences
- **In validation:** a recipient's name comes only from `names[addr]` in the TrustStore, refreshed by `refreshTrust` with forward and reverse checks.
- **In execution:** `_protected` re-resolves forward (name → addr) live on Leg B. A mismatch reverts.

---

## 13. Validation-rule compliance matrix

| Step | Leg A frame 0 (unstaked) | Leg A frame 1 (staked) | Leg B account | Leg B paymaster (staked) |
|---|---|---|---|---|
| Own storage | ✅ owners, threshold | ✅ TrustStore, policy | ✅ (STO-010) | ✅ |
| Frame introspection | ✅ | ✅ | n/a | n/a |
| EXTCODEHASH | ❌ not needed | ✅ sender + targets with code | ❌ | ✅ targets with code only (OP-041) |
| Fee check | ❌ | ✅ own `deposits[sender]` | ❌ | ✅ own `deposits[sender]` |
| Fee transfer in validation | ❌ | ❌ (`charge` in frame 2) | ❌ | ❌ (debit of the reserved deposit) |
| TIMESTAMP / NUMBER | ❌ | ❌ | ❌ | ❌ (TTL checked in execution) |
| Live ENS / proxy / oracle reads | ❌ | ❌ | ❌ | ❌ (cache only) |
| Writes | ❌ | ❌ | nonce only | own deposit / fee accounting per the rules |

**Mass-invalidation surface.** A pending transaction is invalidated only by:
- (a) the sender's own state changes;
- (b) revocation of a descriptor or hook the transaction uses;
- (c) code deployed at an empty target (OP-041 avoids touching such targets);
- (d) the sender's own deposit changes, which only it or a delayed withdrawal can cause.

Document this in `docs/ALTMEMPOOL.md` and measure it with a scripted revocation test.

---

## 14. Gas budget (targets; replace them with measured values)

| Component | Target |
|---|---|
| Frame 0: layout lock (~10 introspection ops) + 2 ecrecover + owner reads | 20–30k (cap 100k) |
| Frame 1: transfer/approve sentence render + hash | 60–120k |
| Frame 1: UR `V4_SWAP` (SWAP_EXACT_IN_SINGLE + SETTLE_ALL + TAKE_ALL) + WRAP_ETH via URRender | **≤ 300k (F6)** |
| Frame 1: TrustStore reads (~15 cold SLOAD) + SSTORE2 copies | ~40–80k |
| Frame 1: derive + policy | 20–40k |
| **Frame 1 total** | **≤ 600k (cap 1M)** |
| Frame 2: fee transfer + snapshot/assert (~10–20 STATICCALL reads) + live re-checks | 60–150k on top of the calls |

**Tactics:**
- hash structured bytes incrementally;
- use no string concatenation;
- copy descriptors via SSTORE2 EXTCODECOPY;
- keep recursion depth at most 3.

---

## 15. Security: invariants and threat model

**Invariants.** Each must have a test (§16).
- **I1:** if frame 2's protected batch succeeds, then `keccak256(render(executed calls)) == signed treeHash` under the attested descriptors at `trustEpoch`.
- **I2:** if the protected batch succeeds, every Spec item holds, and `hash(spec) == signed specHash`.
- **I3:** no transaction with a renderer frame other than the canonical Renderer-Paymaster, or with any frame count other than 3, gets `APPROVE(EXECUTION)` from the account.
- **I4:** if the fee transfer fails, no protected call executes.
- **I5:** if an assertion fails, no protected call's effects persist, and the fee is paid.
- **I6:** a signature older than `TTL` blocks cannot execute protected calls.
- **I7:** the account cannot be delegatecalled into or upgraded; owners change only through a rendered `TRUST_CHANGE` batch.
- **I8:** the Solidity and TS renderers are byte-identical, checked by the differential fuzzer.
- **I9:** validation of a pending transaction depends only on the state listed in §13.
- **I10:** `refreshTrust` cannot lower the epoch or un-revoke a descriptor.

**Attack kit.** Each must fail, and the test names should match these:

| Attack | Expected outcome |
|---|---|
| A1: swap the recipient | mempool reject (tree mismatch) |
| A2: minOut=0 via SkimHook | honest tree mismatch → reject; if the user signs the true tree, policy rejects it |
| A3: drop the renderer frame / use a self-pay layout | frame 0 rejects |
| A4: substitute a weaker spec | frame 1 or frame 2 hash mismatch |
| A5: poisoned descriptor (unattested) | `UNVERIFIED_CONTRACT` → policy reject |
| A6: EvilVault hidden WETH pull | assertion revert, fee kept |
| A7: stale pre-signed transaction past TTL | revert |
| A8: lookalike ENS name | name not in the cache, so hex is shown; or the exclusivity check fails at refresh |
| A9: fee griefing (an empty deposit, or a withdrawal raced against a pending transaction) | frame 1 rejects an insufficient deposit; a withdrawal can't mature within the transaction's lifetime (`WITHDRAW_DELAY` is greater than the TTL) |
| A10: 7702-delegated sender | frame 1 rejects |
| A11: reentrancy into `executeVerified` / `_protected` | reverts |
| A12: gas griefing (a call burns all its gas) | assertion reserve keeps the assertion phase alive, or the transaction reverts; either way safe |

**Residual risks** (for the README):
- attestor and ENS publisher collusion;
- stolen keys;
- a misunderstood sentence;
- untracked state;
- revocation staleness until the next refresh;
- machine signers.

---

## 16. Testing strategy
1. **Unit tests (Foundry)** for DisplayVM, URRender, derive, AssertionKit and TrustStore.
   - Abstract frame introspection behind a `FrameIntrospection` interface with a **mock** for Foundry.
   - The real implementation uses the devnet opcodes (§17).
2. **Golden vectors:** `test/vectors/*.json` hold calls, descriptors, the expected tree hex and the expected spec hex. Both renderers must match them.
3. **Differential fuzzing:** `tools/difffuzz` generates random ABI values for whitelisted selectors and UR commands and compares the bytes. Run it in CI.
4. **Fork tests:** use Sepolia forks for Leg B, with the official UR, Permit2 and v4 contracts.
5. **Devnet integration:** scripts for an honest transaction (admitted, lands) plus attacks A1–A12. Save the explorer links to `docs/PROOFS.md`.
6. **Invalidation test:** submit N pending transactions, revoke one descriptor, and confirm only the dependent ones drop.
7. **Gas:** produce trace-based reports for each demo transaction into `docs/GAS.md`.

---

## 17. Environment and toolchain

### 17.1 The EF frames devnet (Leg A) [U]: work these out first (F0)
- **Endpoints:** get the RPC, chain ID, explorer, faucet, alt-mempool submission endpoint and staking registry address from altmempool.wtf, docs.altmempool.wtf, the prize page links and the EF team at the venue.
- **Clients:** devnet notes list ethrex and nethermind. The EL activates the fork at the configured epoch.
- **Local devnet:** the ethpandaops Kurtosis `ethereum-package` with the frames config (ethrex plus Dora). Use it to iterate without the public devnet.
- **Debugging admission:** use `ethrex_simulateFrameTransaction` if available, and the `forshtat/mempool-workshop-sidecar` plus the ethrex eip8141-tracer.

### 17.2 Emitting the new opcodes (F0, critical) [U]
- **The problem:** stock solc does not know TXPARAM, FRAMEPARAM, FRAMEDATALOAD or APPROVE. Inline assembly in `.sol` **cannot** use `verbatim`.
- **Options, in order of preference:**
  1. **A toolchain the EF or workshop provides**, such as a patched solc, a Foundry fork, or helper libraries. Check the workshop repos first.
  2. **Write the VERIFY entry points as standalone Yul objects** using `verbatim_<n>i_<m>o(hex"..", ...)` for the new opcodes, compiled with `solc --strict-assembly`. Keep the heavy logic (render, derive) in normal Solidity libraries called from the Yul entry, or deploy them as separate contracts reached by STATICCALL.
  3. **Huff or ETK** for the tiny opcode shims.
- **Confirm:**
  - whether FRAMEDATALOAD, TXPARAM and APPROVE work from **nested call depth** (a library contract called by the account), or only in the frame's top-level code;
  - whether APPROVE must be executed by the frame target itself.
- **Design for the worst case:** APPROVE and introspection happen at top level in the account and paymaster code, and the data is passed into the libraries as memory.

### 17.3 Sepolia (Leg B)
- **EntryPoint v0.7:** confirm its Sepolia address in the eth-infinitism docs.
- **Bundler:** one that supports staked paymasters and the ERC-7562 rules, such as Pimlico, Alchemy, or a self-run Rundler or Skandha. Check which enforce STO-033 properly.
- **Contracts:** Uniswap's official Sepolia v4 PoolManager, UR and Permit2 addresses (from the Uniswap docs), and the ENSv2 Sepolia contracts (from the ENSv2 docs).

### 17.4 Keys and roles (demo)
- 2-of-3 account owners: device key, laptop key, backup;
- 3 attestor keys, threshold 2;
- a council multisig for ENS;
- a paymaster owner;
- a separate "attacker" key for the kit.
- **No keys are committed.** Use a `.env.example`.

---

## 18. Build plan: gates (do not skip)

| Gate | Goal | Exit criteria | Est. |
|---|---|---|---|
| **G0** | Toolchain + devnet access (F0) | One plain 0x06 transaction with a VERIFY frame admitted and included; explorer link | 2–4h |
| **G1** | Layout lock + paymaster skeleton (F1, F2, F7) | Account and Renderer-Paymaster deployed; the paymaster is staked; an honest transfer lands; a dropped-renderer transaction is rejected; fee-fail and assert-fail behaviour proven by transaction | 4–6h |
| **G2** | DisplayVM v1 + TS twin + signer | Sentences for `transfer`/`approve` render identically in Solidity and TS; the offline signer signs; A1, A3, A4 and A5 rejected; the EvilVault revert (A6) | 6–8h |
| **G3** | URRender + Uniswap v4 on the devnet (F6) | Self-deployed v4, UR and Permit2; an honest swap lands; minOut=0 with SkimHook (A2) rejected; gas measured ≤ 300k render | 6–8h |
| **G4** | TTL + scope sheet | A7 passes; README scope section | 1–2h |
| **G5** | Leg B Sepolia + ENS (F4, F8) | The 4337 account and paymaster with official Uniswap contracts; `refreshTrust` with ENS exclusivity; A8 | 6–8h (**cut first**) |
| **G6** | Polish + submission | Demo video, README, FEEDBACK.md and the form, PROOFS.md, GAS.md, ALTMEMPOOL.md | 3–4h |

**Cut lines:**
1. If G3 slips: v3 only (`V3_SWAP_EXACT_IN`). If even that fails, drop the Uniswap pick.
2. If G5 slips: drop ENS and submit to EF plus Uniswap.
3. If G0, G1 or G2 fail on the devnet: the EF leg becomes "code that submits" plus a local Kurtosis devnet. Disclose this honestly, and move the weight to Leg B and Uniswap.

---

## 19. Day-1 falsifiers (with tests and fallbacks)

| # | Assumption | How to test | If false |
|---|---|---|---|
| F0 | We can emit the 8141 opcodes and hit the devnet / alt mempool | A minimal VERIFY account in Yul with `verbatim`; submit | Use the workshop toolchain; otherwise a local Kurtosis devnet |
| F1 | VERIFY can FRAMEDATALOAD/FRAMEPARAM **other** frames; `sig_hash` elides VERIFY data; (F1b) a SENDER frame's caller is `tx.sender`; (F1c) a SENDER frame can read frame 0's data | Probe contract that logs reads | If (a) fails, the design collapses on Leg A, so move to Leg B. If (c) fails, carry specHash and signedAt in frame 2 data, where they are bound by `sig_hash` anyway |
| F2 | A staked paymaster gets 1M gas and may read its own storage + EXTCODEHASH of other accounts | Submit with increasing gas; probe the reads | Without EXTCODEHASH: pin by the attested address plus an execution-time codehash check only (weaker; document it). Below 600k: cut the UR render depth |
| F3 | DisplayVM render fits (transfer/approve ≤ 120k) | Trace | Simplify the tree |
| F4 | ENSv2 Sepolia exposes the role queries for the exclusivity proof | Read the docs; call on Sepolia | Weaker check (resolver codehash + record only), stated honestly, or cut ENS |
| F5 | Descriptors exist or can be written for the demo targets | Compile our own | Write our own (expected) |
| F6 | URRender for V4_SWAP ≤ 300k; hook bit positions as recalled; v4, UR and Permit2 deploy on the devnet | Trace; read `Hooks.sol`; deploy | v3 only, then drop Uniswap |
| F7 | Fee-first-then-inner-call semantics behave (I4, I5) | Two transactions | Fix the code; this is non-negotiable |
| F8 | The Leg B bundler accepts a staked paymaster doing heavy validation (render) over its own storage, within its verification gas limit | Submit through 2 bundlers | Self-run Rundler or Skandha with raised limits; document it |

---

## 20. Demo script (3 minutes; pre-record a fallback)

**0:00–0:20, the hook**
> "Bybit, Feb 2025, $1.5B. Drift, April, $285M. Signers approved what a screen told them. Binance last week was a hacked machine, which is a different problem, and we'll say so. Verbatim fixes the human case: the chain checks you signed what you read, then checks it actually happened."

**0:20–1:20, beat 1: the swap lie**
1. Evil frontend: "Swap 1 ETH for at least 3,000 USDC".
2. Its calldata sets minOut = 0 and routes through the SkimHook pool.
3. On a normal wallet, the output is gone (shown on the explorer).
4. On Verbatim, the honest sentence's hash doesn't match the re-render, so the ERC-8421 mempool rejects it. Show the rejection log.
5. If the user is shown the *true* sentence, the device displays `NO MINIMUM OUTPUT` and `HOOK CAN TAKE YOUR OUTPUT`, and policy refuses it.
6. The honest swap lands, with its explorer link.

**1:20–2:10, beat 2: "The contract told the truth; the chain caught what it did"**
- EvilVault renders "Deposit 100 USDC", which is accurate.
- During execution it pulls WETH through an old approval.
- The assertion reverts it; show `AssertionFailed(TRACKED_NO_DECREASE, WETH)`.

**2:10–2:50, beat 3: "Attack us"**
- Judges pick an attack from the evil-frontend kit: recipient swap, drop renderer, spec swap, poisoned descriptor, stale signature.
- The team signs whatever the offline device shows. Every lie fails live.

**2:50–3:00, close**
> "Clear signing, enforced by the chain. Runs today on the frame-transaction alt mempool; ships as a Uniswap renderer anyone can use."

**Q&A prep:**
- **ADR-050 prior art:** cite it, then give the delta.
- **Binance:** out of scope; machine signers need human-signed standing policies, which is our next step.
- **Who attests descriptors?** k-of-n attestors plus ENS exclusivity.
- **Gas:** show `GAS.md`.
- **Why the alt mempool?** Staked paymaster rendering at over 100k gas, plus mempool-level rejection.
- **Protocol-internal ledgers:** out of scope; we track assets and permissions.

---

## 21. Submission checklist
- [ ] Public repo, open-source license (MIT or Apache-2.0).
- [ ] README with: the one-liner, the scope sheet (§2), the architecture diagram, how to run (both legs), the deployed addresses, the **Uniswap contracts and the line references for URRender usage**, the ENS names used, and the trust assumptions.
- [ ] `docs/PROOFS.md`: devnet explorer links for admitted transactions, rejected-transaction logs (alt-mempool usage proof), and the Sepolia transactions.
- [ ] `docs/ALTMEMPOOL.md`: the rules relied on, the staking, the invalidation surface, the trade-offs (EF requires "explain design and trade-offs").
- [ ] `docs/GAS.md` (measured), `docs/VDESC.md`, `docs/VTREE.md`, `docs/VSPEC.md`.
- [ ] `FEEDBACK.md`, plus the **Uniswap Developer Feedback Form submitted** with its link.
- [ ] A live demo link (ENS requirement): a hosted wallet and swap demo pointing at Sepolia.
- [ ] A demo video of 3 minutes or less.
- [ ] Prize selection: EF Frame Tx Alt Mempool, Uniswap Build, ENS ENSv2 (if G5 shipped).
- [ ] AI-usage disclosure, if the event requires it.

---

## 22. Repository layout
```
verbatim/
  contracts/
    src/
      account/VerbatimAccount.sol  account/VerifyEntry.yul (if needed)
      paymaster/RendererPaymaster.sol  paymaster/VerifyEntry.yul (if needed)
      lib/DisplayVM.sol  lib/VTree.sol  lib/VSpec.sol  lib/VDesc.sol  lib/AssertionKit.sol
      lib/FrameIntrospection.sol (interface + devnet impl)  lib/SSTORE2.sol
      uniswap/URRender.sol  uniswap/HookFlags.sol
      trust/TrustStore.sol  trust/EnsTrustChecker.sol
      leg-b/VerbatimAccount4337.sol  leg-b/RendererPaymaster4337.sol
      demo/EvilVault.sol  demo/SkimHook.sol  demo/TestTokens.sol
    test/  (unit, vectors, attacks A1–A12, invariants I1–I10)
    script/ (deploy-devnet, deploy-sepolia, seed-uniswap, refresh-trust)
  packages/ displayvm-ts  vdesc-compiler  frames-sdk  signer  attestor-cli  urrender (standalone lib: sol+ts)
  apps/ wallet  evil-frontend  swap-demo
  tools/ difffuzz  gas-report
  descriptors/ (ERC-7730 JSON + effects ext for demo targets, ERC-20, Permit2, UR)
  docs/ PROOFS.md ALTMEMPOOL.md GAS.md VTREE.md VSPEC.md VDESC.md SCOPE.md
  FEEDBACK.md  README.md  LICENSE
```

---

## 23. Open questions register
Resolve these and record the answers in `docs/DECISIONS.md`.
1. Exact EIP-8141 opcode semantics on the devnet build: depth restrictions, the APPROVE caller, and reads of a VERIFY frame's data from a SENDER frame (F1).
2. ERC-8421 staking registry address and API; actual gas caps; the non-entity read scope (F2).
3. How the devnet dispatches VERIFY to an account: a function selector, or raw code entry (F0).
4. Whether keyed nonces or the ARBITRARY signature scheme exist on the build.
5. Universal Router command and v4 action byte values on the commit we deploy (F6).
6. ENSv2 role-query APIs and registry-level lock semantics (F4).
7. Bundler verification-gas limits for a heavy staked paymaster (F8).
8. Whether ERC-7730 has a UR descriptor and how it handles command dispatch (used for positioning only).
9. Whether P256 (EIP-7951) is available on the devnet (optional passkey owners).

---

## 24. Decisions log (do not re-litigate without new evidence)
| # | Decision | Why |
|---|---|---|
| D1 | Rendering happens in a **shared staked paymaster**, not the account | Avoids about $1,000 of stake per user; the account stays within the unstaked 100k budget |
| D2 | **Layout lock in the sender's VERIFY** | v4 was FATAL: a lying frontend could drop the renderer frame because the device can't check `sig_hash` |
| D3 | **No third-party reads during validation**; live re-checks happen in execution | Prevents ERC-8421 mass invalidation through one shared paymaster |
| D4 | **Proxies rendered as UPGRADEABLE_TARGET**, with the implementation checked live at execution | The EVM has no EXTSLOAD; getters can lie depending on the caller |
| D5 | **Per-descriptor content hashes are signed**, not a global root | A root rotation would invalidate the whole pool |
| D6 | **Both trust gates** (attestors **and** ENS exclusivity) on Leg B | ENS-only allows lookalike self-publishing; attestor-only has no public accountability |
| D7 | **3 frames, with the fee paid first inside executeVerified** | v5's separate fee frame failed open |
| D8 | **No transient storage across frames, no ATOMIC_BATCH** | TSTORE is discarded between frames; the last frame can't be atomic |
| D9 | **ERC-1271 off by default** | Off-chain signatures cannot be post-checked |
| D10 | **The account has no delegatecall, no upgrade path, no 7702** | Removes the account-takeover class |
| D11 | **Undeclared items use "no decrease / no allowance increase"**, not "unchanged" | Dust and upward rebases would otherwise cause false reverts |
| D12 | **VALID_UNTIL TTL** in every tree | Durable pre-signed authority (Drift, Binance) |
| D13 | **Uniswap via the dedicated URRender**, not generic recursion | Precision, gas, and a reusable ecosystem deliverable |
| D14 | **Binance-class machine signers are out of scope** | Honesty; a judge will ask. A machine mode adds surface area and has low novelty against Fireblocks policies and Safe allowance modules |
| D15 | **ENS is cut first** | It has the weakest fit and runs on Leg B only |
| D16 | **Fees come from a prepaid deposit in the paymaster's own storage**, with a delayed withdrawal | Validation reads only own storage; nothing can empty the fee after validation; no allowance conflict with swaps; no `transferFrom` during validation on Leg B |

---

## 25. Glossary
| Term | Meaning |
|---|---|
| **Sentence / display tree (VTREE)** | The canonical, device-renderable description of a transaction; its hash is what owners sign |
| **Spec (VSPEC)** | The list of post-execution assertions derived from the tree |
| **VDesc** | A compiled descriptor (ERC-7730 subset plus effects), keyed by (codehash, selector) |
| **RPM** | The Renderer-Paymaster, the staked entity that re-renders and pays |
| **TrustStore** | The paymaster's storage of attested descriptors, tokens, hooks, names and the epoch |
| **Leg A / Leg B** | The EF frames devnet (EIP-8141) / Sepolia (ERC-4337) |
| **Layout lock** | The sender VERIFY's check that the transaction is exactly the 3-frame shape with the canonical RPM |
| **TTL / VALID_UNTIL** | The block-height expiry of a signed tree |

---

## 26. Resources and links

**Event**
- ETHGlobal Mumbai prizes: https://ethglobal.com/events/mumbai/prizes
- Uniswap feedback form: https://developers.uniswap.org/hackathon-feedback

**Frames, alt mempool, validation**
- EIP-8141 discussion: https://ethereum-magicians.org/t/eip-8141-frame-transaction/27617
- ERC-8421 draft: https://raw.githubusercontent.com/forshtat/ERCs/refs/heads/pr-clean/ERCS/erc-8421.md
- Frame mempool design (matt): https://hackmd.io/@matt/frame-mempool
- frames-devnet-0 notes: https://notes.ethereum.org/@ethpandaops/frames-devnet-0
- Alt-mempool docs and devnet: altmempool.wtf, docs.altmempool.wtf (linked from the prize page)
- Workshop repos: `forshtat/mempool-workshop-sidecar`, `forshtat/ethrex` (eip8141-tracer)
- ethrex FrameTxContext: https://docs.rs/ethrex-levm/30.0.0/ethrex_levm/vm/struct.FrameTxContext.html
- EIP-7906: https://eips.ethereum.org/EIPS/eip-7906
- ERC-7562: https://eips.ethereum.org/EIPS/eip-7562
- Hegotá / EIP-8141 timing: https://coinmarketcap.com/academy/article/ethereum-locks-eip-8141-into-2027-hegota-upgrade

**Clear signing and prior art**
- ERC-7730 tutorial: https://ethereum.org/developers/tutorials/clear-signing (registry: LedgerHQ `clear-signing-erc7730-registry`)
- ERC: Onchain Clear Signing (Kampela): https://ethereum-magicians.org/t/erc-onchain-clear-signing/28068
- Cosmos ADR-050: https://docs.cosmos.network/sdk/latest/reference/architecture/adr-050-sign-mode-textual.md
- ERC-4430: https://eips.ethereum.org/EIPS/eip-4430

**Uniswap**
- Repos: `Uniswap/v4-core` (`Hooks.sol`, `LPFeeLibrary`), `Uniswap/v4-periphery` (`Actions.sol`, `HookMiner`), `Uniswap/universal-router` (`Commands.sol`, `ActionConstants`), `Uniswap/permit2`
- Docs: docs.uniswap.org (deployment addresses incl. Sepolia)
- Hook security: https://www.certik.com/blog/uniswap-v4-hooks-security-considerations
- Hook flags: https://updraft.cyfrin.io/courses/uniswap-v4/hooks/encode-hook-flags

**ENS**
- ENSv2 docs (Permissioned Registry, Permissioned Resolver, Enhanced Access Control, developer guides): linked from the prize page
- ENSIP-26 (agent records, context only): https://ensips.pages.dev/ensip/26

**Incidents (for the pitch)**
- Binance (TRM): https://www.trmlabs.com/resources/blog/north-korea-steals-usd-6-36-billion-from-binance-in-the-largest-hack-in-history
- Binance and EIP-7702 (Fireblocks, vendor): https://www.fireblocks.com/blog/binance-hack-eip-7702
- Drift (BlockSec): https://blocksec.com/blog/drift-protocol-incident-multisig-governance-compromise-via-durable-nonce-exploitation
- 2026 losses pattern: https://crypto.news/defi-hacks-2026-billion-lost-same-attack-keeps-working/

**Internal design history** (in this workspace)
- `verbatim_final.md`: the full design with judging logs
- `loop/round2_research.md`, `loop/ideas_round2.md`: round-2 research and alternatives
- `loop/prize_terms_verified.md`: condensed prize terms