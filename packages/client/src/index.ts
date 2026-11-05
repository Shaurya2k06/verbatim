// Turns a batch of calls into a signable sentence and a frame transaction. All of this is untrusted: the chain
// re-renders, and any lie here is a rejection there.
import { concat, encodeAbiParameters, encodeFunctionData, hashTypedData, hexToBytes, keccak256, parseAbi, toHex, type Address, type Hex, type PublicClient } from "viem";
import { Mode, Scope, frame, newTx, type FrameTx } from "@verbatim/frames-sdk";
import { packStr, render, type RenderIn, type RenderOut, type Trust } from "@verbatim/displayvm-ts";
import { SPEC, rdBe, rdU8, toAddr } from "@verbatim/urrender";

export interface Call {
  target: Address;
  value: bigint;
  data: Hex;
}

export interface Fee {
  asset: Address;
  amount: bigint;
}

export const PAYMASTER_ABI = parseAbi([
  "function verifyFrame(address[] hints)",
  "function descOf(bytes32,bytes4) view returns (address blob, uint64 epoch, uint8 status, bool revoked)",
  "function publisherOf(bytes32,bytes4) view returns (bytes32)",
  "function tokens(address) view returns (bytes11 symbol, uint8 symLen, uint8 decimals, uint8 flags, bool known)",
  "function codeKind(bytes32) view returns (uint8)",
  "function proxyTemplates(bytes32) view returns (address upgrader, bytes32 logicCodehash, address impl, bytes4 getter)",
  "function attestedHooks(bytes32) view returns (bool)",
  "function names(address) view returns (bytes32)",
  "function nameResolver(address) view returns (address)",
  "function PERMIT2() view returns (address)",
  "function WETH() view returns (address)",
  "function policyHashOf(address) view returns (bytes32)",
  "function ttlOf(address) view returns (uint64)",
  "function deposit(address account, address asset, uint256 amount) payable",
  "function deposits(address, address) view returns (uint128 amount, uint128 pendingWithdraw)",
  "function trustEpoch() view returns (uint64)",
  "function feeAssets(address) view returns (uint128 ratePerGas, bool allowed)",
  "function setFeeAsset(address asset, uint128 ratePerGas, bool allowed)",
  "function stake(address registry, uint32 delay) payable",
  "function requestWithdraw(address asset, uint256 amount)",
  "function setPolicy(uint64 ttl, uint64 allowMask)",
]);

export const ACCOUNT_ABI = parseAbi([
  "function verifyFrame(bytes32 treeHash, bytes32 specHash, uint64 signedAtBlock)",
  "struct Fee { address asset; uint256 amount; }",
  "struct Call { address target; uint256 value; bytes data; }",
  "function executeVerified(Fee fee, Call[] calls, bytes spec)",
  "function digestOf(bytes32 sigHash, bytes32 treeHash, bytes32 specHash, uint64 signedAtBlock) view returns (bytes32)",
  "function threshold() view returns (uint8)",
  "function owners() view returns (address[])",
  "event VerbatimResult(bool indexed ok, bytes err)",
]);

const BODY_PARAMS = [
  { type: "tuple", components: [{ type: "address", name: "asset" }, { type: "uint256", name: "amount" }] },
  { type: "tuple[]", components: [{ type: "address", name: "target" }, { type: "uint256", name: "value" }, { type: "bytes", name: "data" }] },
  { type: "bytes" },
] as const;

export const encodeBody = (fee: Fee, calls: Call[], spec: Hex): Hex => encodeAbiParameters(BODY_PARAMS, [fee, calls, spec]);

const ZERO32 = `0x${"00".repeat(32)}` as Hex;

class Miss extends Error {
  constructor(public fetch: () => Promise<void>) {
    super("trust lookup miss");
  }
}

/** Synchronous Trust over a cache; a miss throws, the driver fetches and renders again. */
export class ChainTrust implements Trust {
  private cache = new Map<string, unknown>();
  constructor(public client: PublicClient, public paymaster: Address) {}

  private get<T>(key: string, load: () => Promise<T>): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    throw new Miss(async () => {
      this.cache.set(key, await load());
    });
  }
  private read(functionName: string, args: unknown[] = []) {
    return this.client.readContract({ address: this.paymaster, abi: PAYMASTER_ABI, functionName, args } as never) as Promise<any>;
  }

  codehashOf(a: Address): Hex {
    return this.get(`ch:${a}`, async () => {
      const code = await this.client.getCode({ address: a });
      return code && code !== "0x" ? keccak256(code) : ZERO32;
    });
  }
  descriptor(codehash: Hex, selector: Hex) {
    return this.get(`d:${codehash}:${selector}`, async () => {
      const [blob, epoch, status, revoked] = await this.read("descOf", [codehash, selector]);
      if (blob === "0x0000000000000000000000000000000000000000" || revoked) return null;
      const code = (await this.client.getCode({ address: blob })) as Hex;
      const publisher = await this.read("publisherOf", [codehash, selector]);
      return { blob: `0x${code.slice(4)}` as Hex, publisher, epoch: BigInt(epoch), status: Number(status) };
    });
  }
  tokenInfo(token: Address) {
    return this.get(`t:${token}`, async () => {
      const [symbol, symLen, decimals, flags, known] = await this.read("tokens", [token]);
      return { symbol: `0x${(symbol as string).slice(2).padEnd(62, "0")}${Number(symLen).toString(16).padStart(2, "0")}` as Hex, decimals: Number(decimals), flags: Number(flags), known };
    });
  }
  nameOf(a: Address): Hex {
    return this.legB ? this.get(`n:${a}`, () => this.read("names", [a])) : ZERO32;
  }
  nameResolver(a: Address): Address {
    return this.get(`nr:${a}`, () => this.read("nameResolver", [a]));
  }
  /** Leg A renders no names (no ENS on the frames devnet). */
  legB = false;
  hookIsAttested(codehash: Hex) {
    return this.get(`h:${codehash}`, () => this.read("attestedHooks", [codehash]));
  }
  codeKind(codehash: Hex) {
    return this.get(`k:${codehash}`, async () => Number(await this.read("codeKind", [codehash])));
  }
  routerConfig() {
    return this.get("router", async () => ({ permit2: await this.read("PERMIT2"), weth: await this.read("WETH"), publisher: packedUniswap }));
  }
  proxyTemplate(codehash: Hex) {
    return this.get(`p:${codehash}`, async () => {
      const [upgrader, logicCodehash, impl, getter] = await this.read("proxyTemplates", [codehash]);
      return { upgrader, logicCodehash, impl, getter };
    });
  }
}

export const packedUniswap: Hex = packStr("Uniswap");

/** The addresses a spec asserts to be code-free. */
function noCodeAddresses(spec: Hex): Address[] {
  const s = hexToBytes(spec);
  const n = Number(rdBe(s, 4, 2));
  let p = 6;
  const out: Address[] = [];
  const size: Record<number, number> = { 1: 72, 2: 72, 3: 72, 4: 81, 5: 41, 6: 72, 7: 52, 8: 20, 9: 0, 10: 0, 11: 1, 12: 44, 13: 72 };
  for (let i = 0; i < n; i++) {
    const op = rdU8(s, p++);
    if (op === SPEC.NO_CODE) out.push(toAddr(rdBe(s, p, 20)));
    p += size[op];
  }
  return out;
}

/** Renders, fetching trust lookups as they miss and growing the hint list until no code-bearing address is left out. */
export async function renderWithChain(base: Omit<RenderIn, "hints">, trust: ChainTrust, client: PublicClient): Promise<{ out: RenderOut; hints: Address[] }> {
  const hints: Address[] = [];
  for (let i = 0; i < 200; i++) {
    let out: RenderOut;
    try {
      out = render({ ...base, hints }, trust);
    } catch (e) {
      if (e instanceof Miss) {
        await e.fetch();
        continue;
      }
      throw e;
    }
    let grew = false;
    for (const a of noCodeAddresses(out.spec)) {
      const code = await client.getCode({ address: a });
      if (code && code !== "0x" && !hints.some((h) => h.toLowerCase() === a.toLowerCase())) {
        hints.push(a);
        grew = true;
      }
    }
    if (!grew) return { out, hints };
  }
  throw new Error("render did not converge");
}

export interface GasPlan {
  frame0: bigint;
  frame1: bigint;
  frame2: bigint;
  frame2State: bigint;
}

/** Fits the deployed sidecar's flat 100k prefix cap, with 2 x 2,800 of signature cost. */
export const PUBLIC_GATEWAY_GAS: GasPlan = { frame0: 20_500n, frame1: 73_700n, frame2: 1_200_000n, frame2State: 1_500_000n };

export interface Sentence {
  account: Address;
  chainId: bigint;
  signedAtBlock: bigint;
  tree: Hex;
  spec: Hex;
  treeHash: Hex;
  specHash: Hex;
  risk: number;
}

export interface Prepared extends Sentence {
  tx: FrameTx;
  txCommit: Hex;
  digestTypedData: Parameters<typeof hashTypedData>[0];
  digest: Hex;
  calls: Call[];
  fee: Fee;
  hints: Address[];
}

export interface PrepareArgs {
  client: PublicClient;
  trust: ChainTrust;
  account: Address;
  paymaster: Address;
  calls: Call[];
  fee: Fee;
  signedAtBlock?: bigint;
  gas?: GasPlan;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  /** Lets an attack render something other than what the transaction carries. */
  overrideSentence?: { tree: Hex; spec: Hex };
}

const totalGas = (g: GasPlan) => g.frame0 + g.frame1 + g.frame2 + g.frame2State;

export const EXECUTE_SELECTOR = encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "executeVerified", args: [{ asset: "0x0000000000000000000000000000000000000000", amount: 0n }, [], "0x"] }).slice(0, 10) as Hex;

export const frame2Data = (fee: Fee, calls: Call[], spec: Hex): Hex => `${EXECUTE_SELECTOR}${encodeBody(fee, calls, spec).slice(2)}` as Hex;

export async function prepare(a: PrepareArgs): Promise<Prepared> {
  const gas = a.gas ?? PUBLIC_GATEWAY_GAS;
  const chainId = BigInt(await a.client.getChainId());
  const signedAtBlock = a.signedAtBlock ?? (await a.client.getBlockNumber());
  const read = (functionName: string, args: unknown[]) => a.client.readContract({ address: a.paymaster, abi: PAYMASTER_ABI, functionName, args } as never) as Promise<any>;
  const policyHash: Hex = await read("policyHashOf", [a.account]);
  const ttl: bigint = BigInt(await read("ttlOf", [a.account]));
  const base = {
    chainId,
    account: a.account,
    signedAtBlock,
    ttl,
    feeAsset: a.fee.asset,
    feeAmount: a.fee.amount,
    gasLimitTotal: totalGas(gas),
    policyHash,
    body: encodeBody(a.fee, a.calls, "0x"),
  };
  const { out, hints } = await renderWithChain(base, a.trust, a.client);
  const sentence = a.overrideSentence ? { ...out, tree: a.overrideSentence.tree, spec: a.overrideSentence.spec, treeHash: keccak256(a.overrideSentence.tree), specHash: keccak256(a.overrideSentence.spec) } : out;
  return assemble({ ...a, gas, chainId, signedAtBlock, sentence, realSpec: sentence.spec, hints });
}

function assemble(a: PrepareArgs & { gas: GasPlan; chainId: bigint; signedAtBlock: bigint; sentence: RenderOut; realSpec: Hex; hints: Address[] }): Promise<Prepared> {
  return (async () => {
    const nonce = BigInt(await a.client.getTransactionCount({ address: a.account }));
    const frames = [
      frame({ mode: Mode.VERIFY, flags: Scope.EXECUTION, target: a.account, execution: a.gas.frame0, data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "verifyFrame", args: [a.sentence.treeHash, a.sentence.specHash, a.signedAtBlock] }) }),
      frame({ mode: Mode.VERIFY, flags: Scope.PAYMENT, target: a.paymaster, execution: a.gas.frame1, data: encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "verifyFrame", args: [a.hints] }) }),
      frame({ mode: Mode.SENDER, target: a.account, execution: a.gas.frame2, state: a.gas.frame2State, data: frame2Data(a.fee, a.calls, a.realSpec) }),
    ];
    const tx = newTx({
      chainId: a.chainId,
      sender: a.account,
      nonce,
      frames,
      maxFeePerGas: a.maxFeePerGas ?? 1_000_000_000n,
      maxPriorityFeePerGas: a.maxPriorityFeePerGas ?? 1_000n,
    });
    const sh = txCommit(tx);
    const typed = typedData(a.chainId, a.account, sh, a.sentence.treeHash, a.sentence.specHash, a.signedAtBlock);
    return {
      account: a.account,
      chainId: a.chainId,
      signedAtBlock: a.signedAtBlock,
      tree: a.sentence.tree,
      spec: a.sentence.spec,
      treeHash: a.sentence.treeHash,
      specHash: a.sentence.specHash,
      risk: a.sentence.risk,
      tx,
      txCommit: sh,
      digestTypedData: typed,
      digest: hashTypedData(typed),
      calls: a.calls,
      fee: a.fee,
      hints: a.hints,
    };
  })();
}

/** What VerbatimAccount._txCommit computes from introspection. */
export function txCommit(tx: FrameTx): Hex {
  const [f0, f1, f2] = tx.frames;
  const uints = [tx.nonceSeq, tx.fees.maxPriorityFeePerGas, tx.fees.maxFeePerGas, f0.limits.execution, f0.limits.state, f1.limits.execution, f1.limits.state, f2.limits.execution, f2.limits.state];
  return keccak256(encodeAbiParameters([...uints.map(() => ({ type: "uint256" })), { type: "bytes32" }, { type: "bytes32" }], [...uints, keccak256(f1.data), keccak256(f2.data)] as never));
}

export function typedData(chainId: bigint, account: Address, txCommitValue: Hex, treeHash: Hex, specHash: Hex, signedAtBlock: bigint) {
  return {
    domain: { name: "Verbatim", version: "1", chainId, verifyingContract: account },
    types: { VerbatimTx: [{ name: "txCommit", type: "bytes32" }, { name: "treeHash", type: "bytes32" }, { name: "specHash", type: "bytes32" }, { name: "signedAtBlock", type: "uint64" }] },
    primaryType: "VerbatimTx" as const,
    message: { txCommit: txCommitValue, treeHash, specHash, signedAtBlock },
  };
}

export interface OwnerSig {
  signer: Address;
  /** r||s||v, as wallets and viem produce it. */
  sig: Hex;
}

/** Protocol-validated entries over the explicit digest, sorted by signer. `v || r || s` with v 0 or 1. */
export function withSignatures(tx: FrameTx, digest: Hex, sigs: OwnerSig[]): FrameTx {
  const sorted = [...sigs].sort((x, y) => (BigInt(x.signer) < BigInt(y.signer) ? -1 : 1));
  return {
    ...tx,
    signatures: sorted.map((s) => {
      const v = parseInt(s.sig.slice(130, 132), 16);
      const parity = v >= 27 ? v - 27 : v;
      return { scheme: 1, signer: s.signer, msg: digest, signature: concat([toHex(parity, { size: 1 }), `0x${s.sig.slice(2, 130)}` as Hex]) };
    }),
  };
}

export { toHex };
