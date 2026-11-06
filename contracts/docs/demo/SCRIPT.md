# Demo script (3 minutes or less)

| Time | Show | Say |
|---|---|---|
| 0:00 | Uniswap's app | "Bybit lost $1.5B because signers approved what a tampered screen told them. This is the real Uniswap app, compromised the same way." |
| 0:20 | Ordinary wallet, side by side with Verbatim | "Same swap, same evil calldata. The ordinary wallet gets 1% and the hook takes 99%. Verbatim's device says HOOK CAN TAKE YOUR OUTPUT, and the mempool refuses." |
| 1:10 | Attack kit: "The contract tells the truth, then does more" | "The contract told the truth; the chain caught what it did." `AssertionFailed`. |
| 1:40 | Hand the device to a judge. Attack kit | "Attack us." Every lie about the sentence dies at the mempool; every lie about effects reverts. |
| 2:30 | `contracts/docs/GAS.md`, the ERC drafts, `contracts/docs/FINDINGS.md` | "Zero stake and zero global state on the stateless path. Two ERC drafts, four rule findings, a Uniswap renderer anyone can use, and ENS as the trust root. The chain is your wallet's screen." |

Say the bounty counter only if it is live. Say the stateless line only with its proof green.

## Before going on stage

```sh
cd contracts/scripts/live
npx tsx health.ts            # is the devnet producing blocks?
npx tsx legb-deploy.ts       # reissues the Sepolia snapshot, which lasts 6 hours
```

If the devnet is down, go to [OFFLINE.md](OFFLINE.md) straight away. Do not wait on stage.
