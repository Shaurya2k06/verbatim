# Verbatim × Uniswap

**Prize:** Uniswap Foundation

Wallets blind-sign the Universal Router's `execute(bytes,bytes[],uint256)`. No ERC-7730 descriptor exists for it, and command dispatch doesn't fit ERC-7730's flat field model.

**URRender** is an on-chain renderer for the Universal Router and v4. It turns router calldata into the sentence the owner signs, inside transaction validation. It reads a v4 hook's risk from the hook's own address bits, and the account then enforces the swap's promises after execution.

## How we use it

| What | Code |
|---|---|
| Router dispatch. `COMMAND_TYPE_MASK` is 0x7f. The allow-revert bit raises `UR_ALLOW_REVERT`. Unknown commands render BLIND and are refused | [`URRender.render`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/uniswap/URRender.sol#L73) |
| `V4_SWAP`, decoded as strictly as `CalldataDecoder` | [`_v4Swap`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/uniswap/URRender.sol#L166) |
| `SWAP_EXACT_IN_SINGLE`, `SETTLE_ALL` and `TAKE_ALL`. The minimum is the larger of the two signed minimums; a minimum of 0 raises `NO_MIN_OUT` | [`_v4Single`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/uniswap/URRender.sol#L200) |
| Hook risk from address bits: `afterSwapReturnsDelta` → HOOK CAN TAKE YOUR OUTPUT, plus input, dynamic-fee and unverified-hook flags | [`_poolRisks`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/uniswap/URRender.sol#L246), [`HookFlags.sol`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/uniswap/HookFlags.sol#L11) |
| Multi-hop `SWAP_EXACT_IN` | [`_v4Multi`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/uniswap/URRender.sol#L278) |
| Swap guarantees enforced after the calls: exact input, minimum output to the shown recipient, Permit2 sub-allowance back to 0 | [`_swapEffects`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/uniswap/URRender.sol#L264) |
| v3, WRAP_ETH, UNWRAP_WETH, SWEEP and PAY_PORTION | [`_v3Swap`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/uniswap/URRender.sol#L375), [`_wrap`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/uniswap/URRender.sol#L324) |
| The malicious hook, mined to an address carrying `afterSwapReturnsDelta` | [`SkimHook.sol`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/demo/SkimHook.sol#L38) |
| A standalone package, Solidity plus TypeScript, usable by any wallet | [`packages/urrender`](https://github.com/Shaurya2k06/verbatim/blob/main/packages/urrender) |

## Evidence

**Uniswap's real web interface, compromised at build time** (Bybit-style; D-A22):
- The page quoted **26.19 USDC** for 0.001 ETH from the real Trading API.
- An ordinary wallet signed what the page sent. The victim got **0.026**, and the hook took **2.55**.
- Verbatim was given the identical bytes. The device showed three risk lines, and the chain answered **`PolicyRefused(56)`**.
- The only stub is token metadata.

**Uniswap's official Sepolia contracts** (Universal Router, PoolManager, Permit2):
- side by side: the ordinary wallet lost about 99%, and Verbatim refused the same route;
- a two-hop v4 swap landed above its signed minimum;
- a WalletConnect dapp session: the honest swap landed, the evil route was refused.

**Frames devnet,** with replayed mainnet bytecode for PoolManager, Universal Router and Permit2: a v4 swap was mined in a **90,588 gas** validation prefix. A malicious route, an allow-revert flag and an unknown command were all refused.

**Renderer agreement:** a differential fuzzer keeps the Solidity and TypeScript renderers byte-identical, with 10,000 cases per CI run and 0 mismatches.

**Hook X-ray:** [/xray](https://verbatim-wallet.vercel.app/xray) shows any hook's permissions and risk lines.

Developer feedback: [FEEDBACK.md](https://github.com/Shaurya2k06/verbatim/blob/main/FEEDBACK.md).