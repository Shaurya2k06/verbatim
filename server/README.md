# Verbatim server

The only place secrets live. The client in `../client` calls it under `/api`.

```sh
pnpm --filter @verbatim/server dev     # :8787, reads ../.env
```

| Route | What |
|---|---|
| `GET /api/config` | What is configured. Never a secret. |
| `POST /api/rpc/sepolia` | Sepolia JSON-RPC, read methods only. `eth_getLogs` goes to `SEPOLIA_LOGS_RPC_URL` (Alchemy's free tier allows 10 blocks), falling back to Etherscan for history the public endpoint has pruned. |
| `POST /api/bundler` | ERC-4337 bundler, only for the deployment's account. Falls back to `BUNDLER_URL_2`. |
| `GET /api/snapshot/sepolia` | The published snapshot, re-signed with fresh timestamps when it is within 90 minutes of expiry. Same root, same leaves. |
| `POST /api/demo/eoa-swap` | `/demo`'s ordinary wallet: one ETH-in swap of at most 0.001 ETH on a deployment pool, from `DEMO_EOA_KEY`. |
| `POST /api/uniswap/quote` | Uniswap Trading API quote. |
| `GET /api/suites` | The demo suites, what is funded, and recent runs. |
| `POST /api/suites/run` | Queues one case by id. It really runs on Sepolia, one at a time. |
| `GET /api/suites/run/:id` | That run so far: its steps, sentences, and the transaction URL or the refusal. |
| `/api/session/...` | `/attack` sessions shared by polling. In memory: one instance only. |

**Owner keys.** `/suites` lets a visitor run real transactions, and a visitor has no owner key, so the server holds `OWNER1_KEY` and `OWNER2_KEY` of the Sepolia demo account. That is safe only because of how `src/suites.js` works: it signs operations it builds itself from a fixed list, and a request only names a case. No route accepts anything to sign. Never point these at an account with real funds. In real use owners sign on the offline signer, and every other page still works that way.

Deploy anywhere that runs Node: `pnpm --filter @verbatim/server start`, with the variables in `.env.example`, and `CLIENT_ORIGIN` set to the site's origin.
