# The malicious build step, on Uniswap's real interface

- `src/evil-plugin.ts` is a Vite plugin. It injects a script that rewrites `eth_sendTransaction` into a `minOut = 0` swap through `SkimHook`, while the UI keeps showing the honest quote.
- `src/apply.ts` adds the plugin to a checkout of [`Uniswap/interface`](https://github.com/Uniswap/interface). It changes nothing in this repo.
- `src/ordinary.ts` drives that checkout in a browser, with an injected wallet that signs with `OWNER3_KEY`. It sends RPC to `SEPOLIA_RPC_URL` and Trading API calls to their public host with `UNISWAP_API_KEY`. Other Uniswap backends get a 503, and no origin is spoofed.

The checkout needs its unpublished workspace references removed to install. `contracts/docs/DECISIONS.md`, D-A22, says what changes, including the one stub. Run it only on testnet, and never deploy the result.

```sh
npx tsx src/apply.ts <checkout>
(cd <checkout>/apps/web && npx vite --port 5190 --strictPort --host 127.0.0.1)
npx tsx src/ordinary.ts <folder for screenshots and video>
```

The last command ends with two proofs. `B-UI-eoa`: the page quotes about 26 USDC, an ordinary wallet signs, and the hook takes 99% of the output. `B-UI-verbatim`: the exact bytes the page produced, given to Verbatim, get `PolicyRefused`.

Screenshots: [the quote](../../docs/demo/evidence/uniswap-quote.png), [the review](../../docs/demo/evidence/uniswap-review.png). The same route is also proven without this UI: `B-A2-eoa` and `B-A2b` in [`contracts/docs/PROOFS.md`](../../docs/PROOFS.md).
