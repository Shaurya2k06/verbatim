# Uniswap developer feedback

From building `URRender`, an on-chain renderer for Universal Router and v4 calldata, at ETHGlobal Mumbai, November 2026. We used the real contracts on a custom devnet and Uniswap's official Sepolia deployments.

## What worked well

- **Hook permissions in the address are excellent for tooling.** Risk comes from pure math on the address, with no state read. It made the "this hook can take your output" warning trivial and let it run in a heavily restricted validation context.
- **`CalldataDecoder` is a clear reference.** Its comments on strict encoding told us exactly what to reject. We mirrored the strict layout checks, so our parser refuses what the router refuses.
- **Commands and Actions are tidy constant libraries.** Easy to check against.
- **Replaying real deployments worked.** v4, the router and Permit2 all behaved on an EIP-8141 devnet with an unusual gas model.

## Friction, most costly first

1. **The Universal Router on Sepolia and the one on mainnet have different calldata layouts, and nothing on chain says which is which.**
   `ExactInputSingleParams` on current `main` has `minHopPriceX36`; the official Sepolia router (`0x3A9D...F98b`, 19.5 KB) does not. The two encode differently, with no version getter. We could only tell by searching runtime bytecode for error selectors (`V4TooLittleReceivedPerHopSingle`, `executeSigned`). We now carry a per-router "legacy" flag in attested config. **Ask: a `version()` view on the router, or a table in the deployments doc mapping each address to its commit.** The docs table links the `dev` branch for the Sepolia router, which does not describe it.

2. **`COMMAND_TYPE_MASK` changed from `0x3f` to `0x7f`, and older write-ups disagree.** Tutorials and our own notes said `0x3f`. A decoder using the wrong mask misreads command bytes above `0x3f`. A note in `Commands.sol` on when it changed would help.

3. **No human-readable description of router calldata exists.** The LedgerHQ ERC-7730 registry has V2 and V3 router descriptors, but none for the Universal Router or v4, and ERC-7730's flat field model does not fit command dispatch well. So every wallet still blind-signs `execute(bytes,bytes[],uint256)`. That is the gap `URRender` fills. We would be glad to see an official decoder here, and to contribute ours.

4. **`SETTLE_ALL` and `TAKE_ALL` semantics are easy to misread when asserting effects.** Exact-in with partial fill means the debt can be under `amountIn`, so an `amountIn` delta assertion is strict by choice. `TAKE_ALL`'s minimum and `amountOutMinimum` are separate protections, and either being zero looks safe when the other is set. A short note on how they interact in the `V4Router` docs would help. We take the larger of the two.

5. **Hook mining has no off-the-shelf path for non-Foundry stacks.** `HookMiner` is a Solidity library. We ported the loop to TypeScript in about 20 lines. A small JS helper in the SDK would save that. A mined address must match the *full* 14-bit mask, with every other flag zero, which is worth stating prominently.

6. **`afterSwapReturnDelta` needed reading `Hooks.sol` to get right.** Which currency is "unspecified", what sign the return takes, and how it nets against the hook's own `take` all came from the source rather than the docs. Once read, our test attacker `SkimHook` worked first time: it took 99% of a swap's output on the real PoolManager.

7. **Permit2's two-step approval takes real gas and two sentences for a human.** `token.approve(Permit2)` then `Permit2.approve(token, router)` is hard to explain on a small screen. We support on-chain approve only, because signed permits cannot be post-checked in our model. A plain-language explanation in the docs of why both exist would help wallet authors.

## Gas notes

Measured on an EIP-8141 devnet, from frame receipts (`contracts/docs/GAS.md`). Rendering a `V4_SWAP` on chain, with hook risk, in a validation frame costs about 68k in total, including all our other validation. Router calldata is cheap to decode if you avoid copying: most of the cost was in our own buffer writes until we made them unchecked.

## What we shipped

- `packages/urrender`: Solidity and TypeScript, byte-identical under a 10k-case differential fuzzer. Standalone: no dependency on the rest of Verbatim.
- Hook flag constants tested against `Hooks.sol`, and exercised on real pools with a mined hook.
