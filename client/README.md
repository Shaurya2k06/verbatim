# Verbatim client

The hosted site, and the ENS track's live demo link. Vite + React. It replaces `apps/wallet`, `apps/swap-demo`, `apps/evil-frontend`, `apps/hook-xray` and `apps/ens-demo`. The offline signer stays a separate build in `packages/signer`.

```sh
pnpm --filter @verbatim/server dev   # the API, with the secrets
pnpm --filter @verbatim/web dev      # :5173, proxies /api to :8787
```

- `scripts/sync-data.mjs` runs before `dev` and `build`. It publishes `deployments/*.json`, `docs/proofs.json`, the render vectors, registry coverage and the docs the pages render into `public/data`. The site reads addresses only from there and from ENS.
- Keyed services go through the server. Set `VITE_API_URL` to the server's origin in production. No secret is ever a `VITE_` variable.
- Optional: `VITE_SIGNER_URL`, the hosted offline signer, linked from `/wallet`.

Deploy `client/` as a static site (Vercel or Netlify; SPA rewrites are in `vercel.json` and `public/_redirects`).
