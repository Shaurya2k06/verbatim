# The malicious build step, on Uniswap's real interface

**Unfinished:** the attack has not run end to end through this UI. See "The real-interface attack" in [`contracts/docs/STATUS.md`](../../docs/STATUS.md).

- `src/evil-plugin.ts` is a Vite plugin. It injects a script that rewrites `eth_sendTransaction` into a `minOut = 0` swap through `SkimHook`, while the UI keeps showing the honest quote.
- `src/apply.ts` adds the plugin to a checkout of [`Uniswap/interface`](https://github.com/Uniswap/interface). It changes nothing in this repo.
- `src/ordinary.ts` drives that checkout in a browser, with an injected wallet that signs with `OWNER3_KEY`. It sends RPC to `SEPOLIA_RPC_URL` and Trading API calls to their public host with `UNISWAP_API_KEY`. Other Uniswap backends get a 503, and no origin is spoofed.

The checkout needs its unpublished workspace references removed to install. `contracts/docs/DECISIONS.md`, D-A22, says what changes. Run it only on testnet, and never deploy the result.

The same route is proven without this UI: `B-A2-eoa` and `B-A2b` in [`contracts/docs/PROOFS.md`](../../docs/PROOFS.md).
