# URRender

On-chain, human-readable Universal Router and Uniswap v4 calldata, with hook risk read from the hook's address bits. Solidity and TypeScript, byte-identical.

Every wallet signs `execute(bytes,bytes[],uint256)` blind. URRender turns it into a sentence and the effects that sentence implies:

```
Uniswap swap (by Uniswap) at 0x5e22...e2be
  Deadline: timestamp 1793903782
  Uniswap v4 swap
    You pay: 1 dWETH
    Minimum received: 2000 dUSDC
    Pool fee: 3000
    Tick spacing: 60
```

Point the same page at an evil route and the risks come first:

```
! NO MINIMUM OUTPUT
! HOOK CAN TAKE YOUR OUTPUT
! UNVERIFIED HOOK
```

It fails closed. Anything off the whitelist renders as an unbounded `BLIND` node for you to refuse.

| Supported | |
|---|---|
| Commands | `V4_SWAP`, `V3_SWAP_EXACT_IN`, `WRAP_ETH`, `UNWRAP_WETH`, `SWEEP`, `PAY_PORTION` |
| v4 actions | `SWAP_EXACT_IN_SINGLE` + `SETTLE_ALL` + `TAKE_ALL` |
| Refused | `PERMIT2_PERMIT` (signed permits can't be post-checked), and everything else |
| Routers | Current `main` layout, and the older layout without `minHopPriceX36`, selected per router |

Tested live against the real Universal Router on an EIP-8141 devnet and Uniswap's official Sepolia deployment. Fuzzed for byte equality between the two languages across more than 10,000 cases per CI run.

## Solidity

No dependencies beyond the three files in `solidity/`. Pass your own lookups for token metadata, hook attestation and address fields:

```solidity
import {URRender} from "./URRender.sol";
import {Buf, VSpec} from "./VTree.sol";

Buf.B memory t = Buf.alloc(4096);
URRender.Ctx memory c;
c.cfg = URRender.Config(router, account, permit2, weth, false);
c.fn = URRender.Lookups(_amount, _hookAttested, _addressField);
VSpec.init(c.effects, 2048);
c.value = callValue;

URRender.render(t, calldataOfTheRouterCall, c);

bytes memory nodes = Buf.toBytes(t);             // the sentence
bytes memory spec = VSpec.finish(c.effects, false); // what must hold afterwards
uint256 risk = c.risk;                           // bit set: blind, no min out, hook can take...
```

`contracts/src/lib/DisplayVM.sol` in this repo is a complete host.

## TypeScript

```ts
import { renderUR, Buf, Effects, executeData, v4ExactInSingleInput, CMD } from "@verbatim/urrender";

const data = executeData([CMD.V4_SWAP], [v4ExactInSingleInput({ key, zeroForOne: true, amountIn, amountOutMinimum })], deadline);
const t = new Buf(4096);
renderUR(t, hexToBytes(data), ctx);
```

## Format

Nodes and effects are specified in `docs/VTREE.md` and `docs/VSPEC.md`. Constants are checked against `Uniswap/universal-router`, `v4-periphery` and `v4-core`; see the top-level README for commits and line references.
