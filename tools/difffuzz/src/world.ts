// A deterministic world shared by the Solidity harness and the TypeScript twin, plus the random case generator.
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { packStr, type Desc, type RenderIn, type TokenInfo, type Trust } from "@verbatim/displayvm-ts";
import { compile, type FunctionSpec } from "@verbatim/vdesc-compiler";
import { v4ExactInSingleInput, executeData, wrapInput, sweepInput, payPortionInput, v3Input, MSG_SENDER, ADDRESS_THIS, CMD, type PoolKey } from "@verbatim/urrender";

export const ACCOUNT: Address = "0x00000000000000000000000000000000000a11ce";
export const TOKEN: Address = "0x0000000000000000000000000000000000007070";
export const TOKEN2: Address = "0x0000000000000000000000000000000000008080";
export const UNSAFE: Address = "0x0000000000000000000000000000000000009999";
export const UNKNOWN: Address = "0x000000000000000000000000000000000000abcd";
export const VAULT: Address = "0x0000000000000000000000000000000000005555";
export const MULTI: Address = "0x0000000000000000000000000000000000006666";
export const PROXY: Address = "0x0000000000000000000000000000000000007777";
export const UNATTESTED: Address = "0x000000000000000000000000000000000000dead";
export const ROUTER: Address = "0x0000000000000000000000000000000000003333";
export const LEGACY_ROUTER: Address = "0x0000000000000000000000000000000000003334";
export const NAME_RESOLVER: Address = "0x0000000000000000000000000000000000004444";
export const PERMIT2: Address = "0x0000000000000000000000000000000000002222";
export const WETH: Address = "0x0000000000000000000000000000000000009090";
export const BOB: Address = "0x0000000000000000000000000000000000000b0b";
export const CONTRACT_RECIPIENT: Address = "0x000000000000000000000000000000000000c0de";
export const IMPL: Address = "0x0000000000000000000000000000000000001111";
export const UPGRADER: Address = "0x0000000000000000000000000000000000001234";
/** Low bits: afterSwapReturnsDelta | afterSwap. */
export const SKIM_HOOK: Address = "0x0000000000000000000000000000000000004044";
/** Low bits: beforeSwapReturnsDelta | beforeSwap. Attested. */
export const INPUT_HOOK: Address = "0x0000000000000000000000000000000000004088";
export const PLAIN_HOOK: Address = "0x0000000000000000000000000000000000004040";

const ch = (s: string): Hex => keccak256(toHex(s));
export const CODE: Record<string, Hex> = {
  [TOKEN]: ch("token"),
  [TOKEN2]: ch("token"),
  [UNSAFE]: ch("token"),
  [UNKNOWN]: ch("token"),
  [VAULT]: ch("vault"),
  [MULTI]: ch("multi"),
  [PROXY]: ch("proxy"),
  [UNATTESTED]: ch("unattested"),
  [ROUTER]: ch("router"),
  [LEGACY_ROUTER]: ch("legacy router"),
  [CONTRACT_RECIPIENT]: ch("wallet"),
  [SKIM_HOOK]: ch("skim"),
  [INPUT_HOOK]: ch("inputhook"),
  [PLAIN_HOOK]: ch("plainhook"),
};
const LOGIC = ch("logic");
const PUBLISHER = packStr("Demo Publisher");
export const ROUTER_PUBLISHER = packStr("Uniswap");

const SPECS: Record<string, FunctionSpec[]> = {
  token: [
    { signature: "transfer(address,uint256)", intent: "Send tokens", exactWords: 2, fields: [{ path: "0", label: "To", format: "address", role: "recipient" }, { path: "1", label: "Amount", format: "tokenAmount", token: { kind: "target" } }], effects: [{ kind: "OUT_EXACT", token: { kind: "target" }, amount: "1", to: "0" }] },
    { signature: "approve(address,uint256)", intent: "Approve spending", exactWords: 2, fields: [{ path: "0", label: "Spender", format: "address", role: "spender" }, { path: "1", label: "Amount", format: "tokenAmount", token: { kind: "target" } }], effects: [{ kind: "APPROVE_SET", token: { kind: "target" }, spender: "0", amount: "1" }], flags: ["UNLIMITED_IF"] },
    { signature: "setApprovalForAll(address,bool)", intent: "Approve all NFTs", exactWords: 2, fields: [{ path: "0", label: "Operator", format: "address", role: "operator" }, { path: "1", label: "Approved", format: "bool" }], effects: [{ kind: "OPERATOR_SET", token: { kind: "target" }, operator: "0", approved: "1" }], flags: ["OPERATOR"] },
    { signature: "safeTransferFrom(address,address,uint256)", intent: "Send NFT", exactWords: 3, fields: [{ path: "1", label: "To", format: "address", role: "recipient" }, { path: "2", label: "Token id", format: "uint" }], effects: [{ kind: "NFT_OUT", token: { kind: "target" }, id: "2", to: "1" }] },
    { signature: "approve(address,address,uint160,uint48)", intent: "Permit2 approve", exactWords: 4, fields: [{ path: "1", label: "Spender", format: "address", role: "spender" }, { path: "2", label: "Amount", format: "tokenAmount", token: { kind: "field", path: "0" } }, { path: "3", label: "Expires", format: "uint", unit: "timestamp" }], effects: [{ kind: "P2_APPROVE_SET", token: { kind: "field", path: "0" }, spender: "1", amount: "2" }] },
  ],
  vault: [
    { signature: "deposit(uint256,uint8)", intent: "Deposit", exactWords: 2, fields: [{ path: "0", label: "Amount", format: "tokenAmount", token: { kind: "const", address: TOKEN } }, { path: "1", label: "Mode", format: "enum", enum: { "0": "Safe", "1": "Fast" } }], effects: [{ kind: "OUT_EXACT", token: { kind: "const", address: TOKEN }, amount: "0", to: "0" }, { kind: "SHARES_MIN", token: { kind: "target" }, min: "0" }] },
    { signature: "note(bytes)", intent: "Leave a note", fields: [{ path: "0", label: "Note", format: "bytes" }] },
    { signature: "setAdmin(address)", intent: "Change admin", exactWords: 1, fields: [{ path: "0", label: "Admin", format: "address" }], flags: ["ADMIN"] },
    { signature: "mint(uint256)", intent: "Mint shares", exactWords: 1, fields: [{ path: "0", label: "Minimum", format: "uint" }, { label: "Paying", format: "ethValue" }], effects: [{ kind: "IN_MIN", token: { kind: "target" }, amount: "0" }] },
  ],
  multi: [
    { signature: "forward(address,uint256,bytes)", intent: "Forward a call", fields: [{ path: "2", label: "Inner call", format: "calldata", callTarget: "0", callValue: "1" }] },
    { signature: "wrapped((address,uint256),bytes)", intent: "Tuple head", fields: [{ path: "0.0", label: "Who", format: "address", role: "recipient" }, { path: "0.1", label: "How much", format: "uint" }, { path: "2", label: "Blob", format: "bytes" }] },
  ],
  logic: [{ signature: "transfer(address,uint256)", intent: "Send via proxy", exactWords: 2, fields: [{ path: "0", label: "To", format: "address", role: "recipient" }, { path: "1", label: "Amount", format: "tokenAmount", token: { kind: "target" } }], effects: [{ kind: "OUT_EXACT", token: { kind: "target" }, amount: "1", to: "0" }] }],
};

const compiled = (k: string) => SPECS[k].map((f) => compile(f));

export interface WorldDesc {
  codehash: Hex;
  selector: Hex;
  vdesc: Hex;
  publisher: Hex;
  epoch: number;
  status: number;
}

export function worldDescriptors(): WorldDesc[] {
  const out: WorldDesc[] = [];
  let epoch = 1;
  for (const [k, codehash] of [["token", ch("token")], ["vault", ch("vault")], ["multi", ch("multi")], ["logic", LOGIC]] as const) {
    for (const d of compiled(k)) out.push({ codehash, selector: d.selector, vdesc: d.vdesc, publisher: PUBLISHER, epoch: epoch++, status: 2 });
  }
  return out;
}

const TOKENS: Record<string, TokenInfo & { text: string; len: number }> = {
  [TOKEN]: { symbol: packStr("dUSDC"), decimals: 6, flags: 0, known: true, text: "dUSDC", len: 5 },
  [TOKEN2]: { symbol: packStr("dWETH"), decimals: 18, flags: 0, known: true, text: "dWETH", len: 5 },
  [UNSAFE]: { symbol: packStr("REBASE"), decimals: 9, flags: 2, known: true, text: "REBASE", len: 6 },
};
export const worldTokens = () => Object.entries(TOKENS).map(([token, t]) => ({ token: token as Address, symbol: t.text, len: t.len, decimals: t.decimals, flags: t.flags }));

export const worldProxy = { codehash: ch("proxy"), upgrader: UPGRADER, logic: LOGIC, impl: IMPL, getter: "0x5c60da1b" as Hex };
export const worldSpenders: Address[] = [BOB, PERMIT2];
export const worldHooks = [ch("inputhook"), ch("plainhook")];
export const worldRouterCode = ch("router");
export const worldLegacyRouterCode = ch("legacy router");
export const worldNames: Record<string, Hex> = { [BOB]: packStr("bob-demo.eth"), [CONTRACT_RECIPIENT]: packStr("contract-demo.eth") };

export function tsTrust(): Trust {
  const descs = new Map(worldDescriptors().map((d) => [`${d.codehash}:${d.selector}`, d]));
  const ZERO32 = `0x${"00".repeat(32)}` as Hex;
  return {
    codehashOf: (a) => CODE[a.toLowerCase()] ?? ZERO32,
    descriptor: (c, s) => {
      const d = descs.get(`${c}:${s}`);
      return d ? ({ blob: d.vdesc, publisher: d.publisher, epoch: BigInt(d.epoch), status: d.status } satisfies Desc) : null;
    },
    tokenInfo: (t) => TOKENS[t.toLowerCase()] ?? { symbol: ZERO32, decimals: 0, flags: 0, known: false },
    nameOf: (a) => worldNames[a.toLowerCase()] ?? ZERO32,
    nameResolver: () => NAME_RESOLVER,
    hookIsAttested: (c) => worldHooks.includes(c),
    spenderIsAttested: (a) => worldSpenders.includes(a.toLowerCase() as Address),
    codeKind: (c) => (c === worldRouterCode ? 1 : c === worldLegacyRouterCode ? 3 : c === worldProxy.codehash ? 2 : 0),
    routerConfig: () => ({ permit2: PERMIT2, weth: WETH, publisher: ROUTER_PUBLISHER }),
    proxyTemplate: () => ({ upgrader: UPGRADER, logicCodehash: LOGIC, impl: IMPL, getter: worldProxy.getter }),
  };
}

// ------------------------------------------------------------------------------------------ cases --

/** Small deterministic PRNG (mulberry32), so a failing seed reproduces. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)];
  const bytes = (n: number): Hex => `0x${Array.from({ length: n }, () => int(256).toString(16).padStart(2, "0")).join("")}` as Hex;
  const uint = (): bigint => {
    const bits = pick([0, 1, 8, 32, 64, 128, 159, 160, 254, 255, 256]);
    if (bits === 0) return 0n;
    let v = 0n;
    for (let i = 0; i < 8; i++) v = (v << 32n) | BigInt(int(2 ** 32));
    if (next() < 0.1) return (1n << BigInt(bits)) - 1n;
    return v & ((1n << BigInt(bits)) - 1n);
  };
  return { next, int, pick, bytes, uint };
}

export interface Call {
  target: Address;
  value: bigint;
  data: Hex;
}

const ALL_HINTS = Object.keys(CODE) as Address[];
const ABI = parseAbi([
  "function transfer(address,uint256)",
  "function approve(address,uint256)",
  "function setApprovalForAll(address,bool)",
  "function safeTransferFrom(address,address,uint256)",
  "function approve(address,address,uint160,uint48)",
  "function deposit(uint256,uint8)",
  "function note(bytes)",
  "function setAdmin(address)",
  "function mint(uint256)",
  "function forward(address,uint256,bytes)",
]);

const who = (r: ReturnType<typeof rng>): Address => r.pick([BOB, ACCOUNT, CONTRACT_RECIPIENT, TOKEN, UNATTESTED, "0x0000000000000000000000000000000000000000" as Address, `0x${r.bytes(20).slice(2)}` as Address]);
const tokenish = (r: ReturnType<typeof rng>): Address => r.pick([TOKEN, TOKEN2, UNSAFE, UNKNOWN]);
const amount = (r: ReturnType<typeof rng>) => (r.next() < 0.7 ? BigInt(r.int(1e9)) : r.uint());

function urCall(r: ReturnType<typeof rng>): Call {
  const hook = r.pick(["0x0000000000000000000000000000000000000000" as Address, "0x0000000000000000000000000000000000000000" as Address, SKIM_HOOK, INPUT_HOOK, PLAIN_HOOK]);
  const key: PoolKey = { currency0: TOKEN, currency1: TOKEN2, fee: r.pick([100, 500, 3000, 0x800000]), tickSpacing: r.pick([1, 60, 200]), hooks: hook };
  const z = r.next() < 0.5;
  const legacyParams = r.next() < 0.25;
  const value = r.next() < 0.2 ? BigInt(r.int(1e6)) : 0n;
  const commands: number[] = [];
  const inputs: Hex[] = [];
  const n = 1 + r.int(3);
  for (let i = 0; i < n; i++) {
    const flag = r.next() < 0.05 ? CMD.FLAG_ALLOW_REVERT : 0;
    const kind = r.int(8);
    const rcpt = r.pick([MSG_SENDER, MSG_SENDER, ADDRESS_THIS, BOB, CONTRACT_RECIPIENT]);
    if (kind <= 2) {
      commands.push(CMD.V4_SWAP | flag);
      inputs.push(v4ExactInSingleInput({ key, zeroForOne: z, amountIn: 1n + BigInt(r.int(1e9)), amountOutMinimum: r.next() < 0.3 ? 0n : BigInt(r.int(1e9)), minHopPriceX36: r.next() < 0.2 ? r.uint() : 0n, hookData: r.next() < 0.2 ? r.bytes(r.int(40)) : "0x", settleMax: r.next() < 0.2 ? r.uint() : undefined, takeMin: r.next() < 0.2 ? BigInt(r.int(1e9)) : undefined, legacyParams }));
    } else if (kind === 3) {
      commands.push(CMD.WRAP_ETH | flag);
      inputs.push(wrapInput(rcpt, r.next() < 0.9 ? value : BigInt(r.int(100))));
    } else if (kind === 4) {
      commands.push(CMD.UNWRAP_WETH | flag);
      inputs.push(wrapInput(rcpt, BigInt(r.int(1e9))));
    } else if (kind === 5) {
      commands.push(CMD.SWEEP | flag);
      inputs.push(sweepInput(tokenish(r), rcpt, BigInt(r.int(1e9))));
    } else if (kind === 6) {
      commands.push(CMD.PAY_PORTION | flag);
      inputs.push(payPortionInput(tokenish(r), rcpt, BigInt(r.int(10000))));
    } else if (r.next() < 0.5) {
      commands.push(CMD.V3_SWAP_EXACT_IN | flag);
      const path = `0x${TOKEN.slice(2)}000bb8${TOKEN2.slice(2)}` as Hex;
      inputs.push(v3Input({ recipient: rcpt, amountIn: 1n + BigInt(r.int(1e9)), amountOutMin: BigInt(r.int(1e9)), path, payerIsUser: r.next() < 0.5 }));
    } else {
      commands.push(r.pick([0x01, 0x02, 0x08, 0x0a, 0x21, 0x40]) | flag);
      inputs.push(r.bytes(r.int(96)));
    }
  }
  return { target: legacyParams ? LEGACY_ROUTER : ROUTER, value, data: executeData(commands, inputs, r.next() < 0.8 ? BigInt(2e9) : undefined) };
}

function call(r: ReturnType<typeof rng>, depth = 0): Call {
  const k = r.int(14);
  const t = tokenish(r);
  const v = r.next() < 0.1 ? BigInt(r.int(1e6)) : 0n;
  switch (k) {
    case 0:
    case 1:
      return { target: t, value: v, data: encodeFunctionData({ abi: ABI, functionName: "transfer", args: [who(r), amount(r)] }) };
    case 2:
      return { target: t, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: "approve", args: [who(r), amount(r)] }) };
    case 3:
      return { target: t, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: "setApprovalForAll", args: [who(r), r.next() < 0.5] }) };
    case 4:
      return { target: t, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: "safeTransferFrom", args: [ACCOUNT, who(r), amount(r)] }) };
    case 5:
      return { target: t, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: "approve", args: [t, who(r), BigInt(r.int(1e9)), r.int(2 ** 31)] }) };
    case 6:
      return { target: VAULT, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: "deposit", args: [amount(r), r.int(3)] }) };
    case 7:
      return { target: VAULT, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: "note", args: [r.bytes(r.int(120))] }) };
    case 8:
      return { target: VAULT, value: BigInt(r.int(1e6)), data: encodeFunctionData({ abi: ABI, functionName: "mint", args: [BigInt(r.int(1e6))] }) };
    case 9:
      return { target: VAULT, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: "setAdmin", args: [who(r)] }) };
    case 10: {
      if (depth > 4) return { target: BOB, value: v, data: "0x" };
      const inner = call(r, depth + 1);
      return { target: MULTI, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: "forward", args: [inner.target, inner.value, inner.data] }) };
    }
    case 11: {
      const head = encodeAbiParameters([{ type: "tuple", components: [{ type: "address" }, { type: "uint256" }] }, { type: "bytes" }], [[who(r), amount(r)], r.bytes(r.int(60))]);
      return { target: MULTI, value: 0n, data: `0xdeadbeef${head.slice(2)}` as Hex };
    }
    case 12:
      return r.pick<Call>([
        { target: BOB, value: v, data: "0x" },
        { target: UNATTESTED, value: v, data: r.bytes(r.int(40)) },
        { target: PROXY, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: "transfer", args: [who(r), amount(r)] }) },
        { target: PROXY, value: 0n, data: "0xabcdef01" },
        { target: TOKEN, value: 0n, data: r.bytes(r.int(4)) },
      ]);
    default:
      return urCall(r);
  }
}

/** Mutations a hostile frontend might try, so both renderers also face malformed input. */
function mangle(r: ReturnType<typeof rng>, c: Call): Call {
  const roll = r.next();
  if (roll > 0.12) return c;
  const d = c.data.slice(2);
  if (roll < 0.04) return { ...c, data: `0x${d}${r.bytes(1 + r.int(40)).slice(2)}` as Hex };
  if (roll < 0.08 && d.length > 8) return { ...c, data: `0x${d.slice(0, Math.max(8, d.length - 2 * (1 + r.int(40))) & ~1)}` as Hex };
  if (d.length > 8) {
    const at = 8 + 2 * r.int((d.length - 8) / 2);
    return { ...c, data: `0x${d.slice(0, at)}${r.bytes(1).slice(2)}${d.slice(at + 2)}` as Hex };
  }
  return c;
}

const BODY = [
  { type: "tuple[]", components: [{ type: "address" }, { type: "uint256" }, { type: "bytes" }] },
  { type: "bytes" },
] as const;

export function makeCase(seed: number): RenderIn {
  const r = rng(seed);
  const n = r.next() < 0.05 ? 0 : 1 + r.int(4);
  const calls = Array.from({ length: n }, () => mangle(r, call(r)));
  const body = encodeAbiParameters(BODY, [calls.map((c) => [c.target, c.value, c.data]) as never, "0x"]);
  // Hints occasionally lie: claiming code on an address with none, or omitting one that has it.
  const hints = ALL_HINTS.filter(() => r.next() < 0.95);
  if (r.next() < 0.05) hints.push(BOB);
  return {
    chainId: 1337n,
    account: ACCOUNT,
    expiry: BigInt(1_800_000_000 + r.int(1e6)),
    snapshotRoot: r.bytes(32),
    policyVersion: 1 + r.int(5),
    path: 1 + r.int(3),
    feeAsset: "0x0000000000000000000000000000000000000000",
    maxFee: BigInt(r.int(1e9)),
    body,
    hints,
  };
}

function ZERO_ADDR(): Address {
  return "0x0000000000000000000000000000000000000000";
}

const named = (calls: Call[]): RenderIn => ({
  chainId: 1337n,
  account: ACCOUNT,
  expiry: 1_800_000_000n,
  snapshotRoot: `0x${"ab".repeat(32)}`,
  policyVersion: 1,
  path: 2,
  feeAsset: ZERO_ADDR(),
  maxFee: 1000n,
  body: encodeAbiParameters(BODY, [calls.map((c) => [c.target, c.value, c.data]) as never, "0x"]),
  hints: ALL_HINTS,
});

/** One deterministic case per supported selector and router command. */
export function namedCases(): [string, RenderIn][] {
  const key: PoolKey = { currency0: TOKEN, currency1: TOKEN2, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR() };
  const dl = 2_000_000_000n;
  const fn = (functionName: string, args: unknown[]) => encodeFunctionData({ abi: ABI, functionName, args } as never);
  const ur = (cmds: number[], inputs: Hex[], value = 0n, target: Address = ROUTER): Call => ({ target, value, data: executeData(cmds, inputs, dl) });
  const swap = v4ExactInSingleInput({ key, zeroForOne: true, amountIn: 1000n, amountOutMinimum: 900n });
  const cases: [string, Call][] = [
    ["erc20.transfer", { target: TOKEN, value: 0n, data: fn("transfer", [BOB, 5n]) }],
    ["erc20.approve", { target: TOKEN, value: 0n, data: fn("approve", [PERMIT2, 5n]) }],
    ["erc20.approve unlimited", { target: TOKEN, value: 0n, data: fn("approve", [PERMIT2, (1n << 256n) - 1n]) }],
    ["erc20.approve unattested spender", { target: TOKEN, value: 0n, data: fn("approve", [CONTRACT_RECIPIENT, 5n]) }],
    ["erc721.setApprovalForAll", { target: TOKEN, value: 0n, data: fn("setApprovalForAll", [BOB, true]) }],
    ["erc721.safeTransferFrom", { target: TOKEN, value: 0n, data: fn("safeTransferFrom", [ACCOUNT, BOB, 7n]) }],
    ["permit2.approve", { target: TOKEN, value: 0n, data: fn("approve", [TOKEN, BOB, 5n, 99]) }],
    ["vault.deposit", { target: VAULT, value: 0n, data: fn("deposit", [5n, 1]) }],
    ["vault.note", { target: VAULT, value: 0n, data: fn("note", ["0x1234"]) }],
    ["vault.setAdmin", { target: VAULT, value: 0n, data: fn("setAdmin", [BOB]) }],
    ["vault.mint with value", { target: VAULT, value: 5n, data: fn("mint", [5n]) }],
    ["multi.forward nested", { target: MULTI, value: 0n, data: fn("forward", [TOKEN, 0n, fn("transfer", [BOB, 5n])]) }],
    ["proxy.transfer", { target: PROXY, value: 0n, data: fn("transfer", [BOB, 5n]) }],
    ["eth.send", { target: BOB, value: 5n, data: "0x" }],
    ["unattested", { target: UNATTESTED, value: 0n, data: "0xdeadbeef" }],
    ["ur.v4_swap", ur([CMD.V4_SWAP], [swap])],
    ["ur.v4_swap legacy params", ur([CMD.V4_SWAP], [v4ExactInSingleInput({ key, zeroForOne: true, amountIn: 1000n, amountOutMinimum: 900n, legacyParams: true })], 0n, LEGACY_ROUTER)],
    ["ur.v4_swap skim hook, no minimum", ur([CMD.V4_SWAP], [v4ExactInSingleInput({ key: { ...key, hooks: SKIM_HOOK }, zeroForOne: true, amountIn: 1000n, amountOutMinimum: 0n })])],
    ["ur.v4_swap attested input hook", ur([CMD.V4_SWAP], [v4ExactInSingleInput({ key: { ...key, hooks: INPUT_HOOK }, zeroForOne: true, amountIn: 1000n, amountOutMinimum: 900n })])],
    ["ur.v4_swap dynamic fee", ur([CMD.V4_SWAP], [v4ExactInSingleInput({ key: { ...key, fee: 0x800000 }, zeroForOne: true, amountIn: 1000n, amountOutMinimum: 900n })])],
    ["ur.wrap_eth", ur([CMD.WRAP_ETH], [wrapInput(MSG_SENDER, 5n)], 5n)],
    ["ur.unwrap_weth", ur([CMD.UNWRAP_WETH], [wrapInput(MSG_SENDER, 5n)])],
    ["ur.sweep", ur([CMD.SWEEP], [sweepInput(TOKEN, MSG_SENDER, 5n)])],
    ["ur.sweep elsewhere", ur([CMD.SWEEP], [sweepInput(TOKEN, BOB, 5n)])],
    ["ur.pay_portion", ur([CMD.PAY_PORTION], [payPortionInput(TOKEN, BOB, 25n)])],
    ["ur.v3_swap_exact_in", ur([CMD.V3_SWAP_EXACT_IN], [v3Input({ recipient: MSG_SENDER, amountIn: 1000n, amountOutMin: 900n, path: `0x${TOKEN.slice(2)}000bb8${TOKEN2.slice(2)}` as Hex, payerIsUser: true })])],
    ["ur.allow_revert", ur([CMD.SWEEP | CMD.FLAG_ALLOW_REVERT], [sweepInput(TOKEN, MSG_SENDER, 5n)])],
    ["ur.unknown command", ur([0x0a], ["0x1234"])],
    ["ur.command above 0x3f", ur([0x40], ["0x1234"])],
  ];
  return cases.map(([n, c]) => [n, named([c])]);
}
