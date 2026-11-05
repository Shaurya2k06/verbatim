# Verbatim

**The chain checks that you signed the sentence you read, then checks that the asset-level effects you were shown actually happened.**

Bybit's signers approved what a tampered frontend showed them. Clear signing today only lives in the wallet: nothing on chain checks that what was shown matches what runs. Verbatim makes the chain do that check, on [EIP-8141](https://eips.ethereum.org/EIPS/eip-8141) frame transactions through the [ERC-8421](https://www.altmempool.wtf/) alternative mempool, and ships the Uniswap part as a standalone renderer.

Owners sign a **sentence**, not calldata:

```
! HOOK CAN TAKE YOUR OUTPUT                     Uniswap swap (by Uniswap) at 0x5e22...e2be
! NO MINIMUM OUTPUT                               Uniswap v4 swap
! UNVERIFIED HOOK                                   You pay: 1 dWETH
                                                    Minimum received: 2000 dUSDC
    the evil route, on the device                the honest route, on the device
```

A staked paymaster re-renders that sentence from the transaction's real calldata during validation. If it differs from what the owners signed, the paymaster refuses to pay, so the transaction never enters the mempool. In execution, the account asserts what the sentence promised, and any violation reverts the batch.

## Scope

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

(The ERC-1271 opt-in itself is not built, so `isValidSignature` always fails.)

## It runs today

All on live networks; every row links to a transaction or a named revert in **[docs/PROOFS.md](docs/PROOFS.md)**. Gas is measured from receipts in **[docs/GAS.md](docs/GAS.md)**.

| Attack | What happened |
|---|---|
| A1 swap the recipient | Mempool rejects: `TreeMismatch` |
| A2 minOut = 0 through SkimHook | Lying sentence: `TreeMismatch`. True sentence: device warns, `PolicyRefused`. Same route on a plain wallet: the hook takes 99% |
| A3 drop or swap the renderer | Frame 0 rejects: `FrameReadFailed`, `BadLayout(4)` |
| A4 weaker spec | `SpecHashMismatch`, both ways |
| A5 poisoned descriptor | Renders blind: `PolicyRefused` |
| A6 EvilVault's hidden pull | Admitted, then `AssertionFailed` names dWETH. Everything undone, fee kept |
| A7 stale signature | `Expired`. Fee kept |
| A8 lookalike ENS name | `WrongResolverCode`, and `RootRolesHeld` even when pinned to its own code. Shows as hex |
| A9 empty deposit | `InsufficientDeposit` |
| A10 7702-delegated sender | Rejected in frame 0, and in frame 1 by the code hash pin |
| A11 reentrancy | `CallFailed`; nothing moved |
| A12 a call burns all its gas | The assertion reserve holds. Batch reverts, frame survives |

Tests: 62 Foundry tests for I1-I7, I9, I10, A1-A12, plus packages. I8 (the renderers are byte-identical) is a differential fuzzer: 10,000 random cases per CI run, zero mismatches.

## Architecture

```
  frontend (may be hostile)
        |  calls
        v
  displayvm-ts renders sentence T and spec S  --QR-->  OFFLINE SIGNER: decodes T itself, shows every line,
        |                                     <--QR--  signs EIP-712(txCommit, hash(T), hash(S), signedAtBlock)
        v
  0x06 transaction: [VERIFY account | VERIFY paymaster | SENDER account.executeVerified]
        |
        v  ERC-8421 ALT MEMPOOL simulates validation
  frame 0  account:   layout lock; protocol-recovered owner signatures over the digest
  frame 1  paymaster: re-render(frame 2 calldata) == T ? derive == S ? policy ? deposit ? then APPROVE(PAYMENT)
        |
        v  EXECUTION
  frame 2  account:   charge fee -> [inner self-call: TTL, live re-checks, snapshot, calls, assert S]
                      assertion failure undoes the batch, and the fee stays paid
```

Trusted: the device's decoder and screen, the owners' keys, the attestor quorum and the ENS publisher (both must collude to lie), the EVM. Untrusted: frontend, host, RPC, relayer, target contracts (their behaviour is asserted), and our own TypeScript (a mismatch fails closed).

| Where | What |
|---|---|
| `contracts/src/account/VerbatimAccount.sol` | Frame account: layout lock, batch, assertions. No DELEGATECALL, checked on the bytecode |
| `contracts/src/paymaster/RendererPaymaster.sol` | The staked renderer: render, derive, policy, fees |
| `contracts/src/lib/DisplayVM.sol` | The renderer. `packages/displayvm-ts` is its twin |
| `contracts/src/uniswap/URRender.sol` | Universal Router and v4 decoder. Standalone as `packages/urrender` |
| `contracts/src/trust/` | TrustStore, `refreshTrust`, the ENS exclusivity proof |
| `contracts/src/leg-b/` | The same logic behind ERC-4337 |
| `packages/signer` | Offline signer: one HTML file |
| `apps/` | Wallet, swap demo, attack kit, ENS publisher check |
| `tools/` | `difffuzz`, `gas-report`, `e2e` (demo and video), `scripts` (deploy and proofs) |

Formats: [VTREE](docs/VTREE.md), [VSPEC](docs/VSPEC.md), [VDESC](docs/VDESC.md). Design and trade-offs for the mempool: **[docs/ALTMEMPOOL.md](docs/ALTMEMPOOL.md)**. Everything that changed from the original design, and why: [docs/DECISIONS.md](docs/DECISIONS.md).

## Run it

Needs Node 20+, pnpm, and [Foundry](https://book.getfoundry.sh).

```sh
pnpm install
pnpm test:contracts                 # Foundry: invariants and attacks
pnpm -r --if-present test           # TypeScript packages, golden vectors
cd tools/difffuzz && pnpm fuzz      # 10,000 cases against a local anvil
```

**The demo, against what is already deployed.** Start the pages:

```sh
pnpm --filter @verbatim/signer dev         # :5173  open on a phone or a second window, then go offline
pnpm --filter @verbatim/wallet dev         # :5174
pnpm --filter @verbatim/swap-demo dev      # :5175
pnpm --filter @verbatim/evil-frontend dev  # :5176  "attack us"
pnpm --filter @verbatim/ens-demo dev       # :5177  ENS exclusivity for any name, read from Sepolia
```

The account is 2-of-3, so each page needs two owners. Paste an owner key into the signer, and another into the page's "Laptop owner" field. Keys stay in the browser. The camera needs HTTPS or localhost; otherwise copy and paste the request and signature. `pnpm --filter @verbatim/signer build` gives a single `dist/index.html` to load once and use in airplane mode.

**Everything in a browser, unattended,** or a captioned fallback video (needs `ffmpeg`, and `pnpm exec playwright install chromium` once):

```sh
cd tools/e2e && pnpm demo     # needs OWNER1_KEY and OWNER2_KEY in .env
cd tools/e2e && pnpm record   # writes docs/demo/verbatim-demo.mp4
```

**Your own deployment.** Generated devnet keys go to the git-ignored `.env`; see `.env.example`.

```sh
cd tools/scripts
./fresh-deploy.sh                   # Leg A: contracts, stake, attestation, pools
npx tsx attacks.ts                  # the attack kit, against the live mempool
npx tsx swap.ts                     # honest swap, WRAP_ETH, A2
npx tsx invalidation.ts             # revoking one descriptor
npx tsx legb-ens.ts my-label        # Leg B: ENSv2 name and lock-down (edit LABEL in legb-deploy.ts)
npx tsx legb-deploy.ts && npx tsx legb-run.ts
cd ../gas-report && pnpm report     # regenerate docs/GAS.md and docs/PROOFS.md
```

## Deployed addresses

Full lists: [deployments/devnet.json](deployments/devnet.json), [deployments/sepolia.json](deployments/sepolia.json).

**Leg A, EF frames devnet (chain 1337).** Explorer: https://explorer.altmempool.wtf/

| Contract | Address |
|---|---|
| RendererPaymaster (staked) | `0xee656b20237fbadf51ba251a2512ef1bd2494382` |
| VerbatimAccount | `0xd797194917479e6072bf5a91d057ddf7a61292db` |
| TrustAdmin | `0x0b713622f1e05ec27bf134c703a624342af28cd9` |
| FrameReader | `0xd0d73854916c7bed37313fd14e7292749da75922` |
| dUSDC / dWETH | `0x4dfef81b27f0d4241b279f93bc3ba822d93235b6` / `0xf0447975d6fe039a027029891c1b08191fd267c9` |
| SkimHook (mined, unattested) | `0x5922EaBd0E54cAb41215937A531C71562e748044` |
| EvilVault | `0x1bd44ce016e484235c91d2327ed1aa775989c4c0` |
| Universal Router / PoolManager / Permit2 (predeployed) | `0x5e2250a42608a5cc9f62e23ab24824ee25b5e2be` / `0x6bF9Aa9c04fd001385742d61f6818C3236429848` / `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

**Leg B, Sepolia.**

| Contract | Address |
|---|---|
| RendererPaymaster4337 (staked at EntryPoint v0.7) | `0xc242b797a9ab3f151f434d902cec2f5acef31701` |
| VerbatimAccount4337 | `0x59092c8916926f8ddab8421e7b4e8c08834a542c` |
| EnsTrustChecker | `0x38a831cfbcef623f0fdf4978d1e61fc7576e143c` |
| TrustAdminEns | `0x9625a7abd1cc169bc8dc4620589d9adaa97b96ec` |
| dUSDC / dWETH | `0x7e068face3fc4a6826d182b1ec0e80d7d8979e0f` / `0x42808f35830dfe250ad998b3b239c0776f01be97` |
| Universal Router / PoolManager / PositionManager (official) | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` / `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` / `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` |
| ENS | `verbatim-demo.eth`, resolver `0xc449d31B38414D39ad733f8A676027956B7a1E88` |

## Uniswap integration: contracts and lines

**Our code**

| What | Where |
|---|---|
| Router dispatch, fails closed on anything unknown | [`URRender.sol:71`](contracts/src/uniswap/URRender.sol#L71) |
| `V4_SWAP` strict decoding | [`URRender.sol:161`](contracts/src/uniswap/URRender.sol#L161) |
| `SWAP_EXACT_IN_SINGLE`, `SETTLE_ALL`, `TAKE_ALL`, hook risk | [`URRender.sol:193`](contracts/src/uniswap/URRender.sol#L193), risk nodes at [`:238`](contracts/src/uniswap/URRender.sol#L238) and [`:242`](contracts/src/uniswap/URRender.sol#L242) |
| Swap effect assertions, including Permit2 | [`URRender.sol:258`](contracts/src/uniswap/URRender.sol#L258) |
| `WRAP_ETH`, `SWEEP`, `V3_SWAP_EXACT_IN` | [`:262`](contracts/src/uniswap/URRender.sol#L262), [`:289`](contracts/src/uniswap/URRender.sol#L289), [`:313`](contracts/src/uniswap/URRender.sol#L313) |
| Hook flag constants | [`HookFlags.sol:7-9`](contracts/src/uniswap/HookFlags.sol#L7-L9), tested against upstream in [`URRender.t.sol`](contracts/test/URRender.t.sol) |
| Where the renderer dispatches to it | [`DisplayVM.sol:186`](contracts/src/lib/DisplayVM.sol#L186) |
| Permit2 allowance reads in assertions | [`AssertionKit.sol:53`](contracts/src/lib/AssertionKit.sol#L53) |
| The evil hook | [`SkimHook.sol:38`](contracts/src/demo/SkimHook.sol#L38) |
| Pool creation and liquidity through PositionManager | [`seed-uniswap.ts:58-66`](tools/scripts/seed-uniswap.ts#L58-L66) |

**Upstream, as checked**

| Constant | Source |
|---|---|
| Commands: mask, `V3_SWAP_EXACT_IN`, `SWEEP`, `PAY_PORTION`, `WRAP_ETH`, `UNWRAP_WETH`, `V4_SWAP` | [`Commands.sol`](https://github.com/Uniswap/universal-router/blob/edf19bfde87e6cf5b29046f6ca2f483a4ffd6ae6/contracts/libraries/Commands.sol#L9-L35) lines 9, 15, 19, 21, 28, 29, 35 |
| Actions: `SWAP_EXACT_IN_SINGLE`, `SETTLE_ALL`, `TAKE_ALL` | [`Actions.sol`](https://github.com/Uniswap/v4-periphery/blob/c6e4754dab11bd38c6f08ac51c3c868569e93d64/src/libraries/Actions.sol#L28-L44) lines 28, 40, 44 |
| `MSG_SENDER`, `ADDRESS_THIS` | [`ActionConstants.sol`](https://github.com/Uniswap/v4-periphery/blob/c6e4754dab11bd38c6f08ac51c3c868569e93d64/src/libraries/ActionConstants.sol#L16-L19) lines 16, 19 |
| Hook flags | [`Hooks.sol`](https://github.com/Uniswap/v4-core/blob/bea7f6d1c11cd5dc4f0d5151ffa37a1c239feee6/src/libraries/Hooks.sol#L44-L45) lines 44-45 |
| Dynamic fee flag | [`LPFeeLibrary.sol`](https://github.com/Uniswap/v4-core/blob/bea7f6d1c11cd5dc4f0d5151ffa37a1c239feee6/src/libraries/LPFeeLibrary.sol#L15) line 15 |

**Contracts used, not self-deployed:** on the devnet, the replayed mainnet PoolManager, PositionManager, Universal Router and Permit2; on Sepolia, Uniswap's official deployments. Only demo tokens, pools and SkimHook are ours. `URRender` ships standalone: **[packages/urrender](packages/urrender)**. Friction report: **[FEEDBACK.md](FEEDBACK.md)**.

## ENS

`verbatim-demo.eth` on Sepolia ENSv2 publishes the descriptor hashes it stands behind, and appears in signed sentences (`Send tokens (by verbatim-demo.eth)`, `To: verbatim-demo.eth (0x3ac4...)`). A name only gets there through both gates: k-of-n attestors **and** a live exclusivity proof in `refreshTrust` ([`EnsTrustChecker.sol:104`](contracts/src/trust/EnsTrustChecker.sol#L104)):

- the resolver is the pinned code, and is reached directly (no wildcard, no CCIP-read);
- the `clear-signing` text record lists this descriptor's hash;
- nobody holds root `SET_TEXT`, `LINK` or `UPGRADE`, or their admins, on the PermissionedResolver;
- exactly one holder of the **argument-scoped** setter for `clear-signing`, the council, with no admin;
- nobody can change the name's resolver or subregistry, and parents hold no direct right to;
- registered at least a year past now.

A shown name must resolve forward and reverse at `refreshTrust`, and is re-resolved at execution, where a mismatch reverts. `apps/ens-demo` runs the same checks live for any name you type. See `docs/DECISIONS.md` (D-A11) for limits: only second-level `.eth` names work, and the demo's council is an EOA.

## Trust assumptions and residual risks

- **Attestor and ENS publisher collusion** can publish a false descriptor (Leg B). On the frames devnet there is no ENS, so attestors alone: sentences there say `ATTESTED_NO_ENS` in `attestStatus`.
- **The ENS DAO and root** are irreducible trust.
- **Stolen keys** sign whatever they like.
- **A misunderstood sentence** is still a signed one.
- **Untracked state:** assertions cover balances, allowances, operators and owners of tracked assets, not protocol-internal ledgers.
- **Revocation is only as fresh as the last `refreshTrust`.**
- **Machine signers:** out of scope.
- **The paymaster is a shared service.** Its stake prices identity only, and it is not slashed.

## Status and limits

Hackathon code, unaudited. Known limits: one call per transaction on the deployed sidecar, and others in [docs/DECISIONS.md](docs/DECISIONS.md). The devnet is a throwaway network that may reset, in which case its addresses change and `fresh-deploy.sh` rebuilds everything.

**Built with AI.** Most of this repo was written with Claude Code, directed and reviewed by the team.

MIT licensed. Prior art we build on: Cosmos ADR-050 SIGN_MODE_TEXTUAL has the chain regenerate the screens a signature covers, which is the same core move; ERC-7730 for descriptors; EIP-7906 for what the assertions become.
