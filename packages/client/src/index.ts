// Turns a batch of calls into a signable sentence and a frame transaction. All of this is untrusted: the chain
// re-renders, and any lie here is a rejection there.
import { concat, encodeAbiParameters, encodeFunctionData, hashTypedData, hexToBytes, keccak256, parseAbi, toHex, type Address, type Hex, type PublicClient } from "viem";
import { getUserOperationHash } from "viem/account-abstraction";
import { Mode, Scope, frame, newTx, type FrameTx } from "@verbatim/frames-sdk";
import { packStr, render, type RenderIn, type RenderOut, type Trust } from "@verbatim/displayvm-ts";
import { SPEC, itemSize, rdBe, rdU8, toAddr } from "@verbatim/urrender";
import { LEAF, encodeProofs, leafKey, snapshotDigest, treeOf, type Leaf, type PublishedSnapshot } from "@verbatim/snapshot-cli";

export interface Call {
  target: Address;
  value: bigint;
  data: Hex;
}

export const PAYMASTER_ABI = parseAbi([
  "function verifyFrame(address[] hints, bytes32 root, uint64 issuedAt, uint64 expiry)",
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
  "function snapshot() view returns (bytes32 root, uint64 issuedAt, uint64 expiry)",
  "function deposit(address account, address asset, uint256 amount) payable",
  "function deposits(address, address) view returns (uint128 amount, uint128 pendingWithdraw)",
  "function trustEpoch() view returns (uint64)",
  "function feesAccrued(address) view returns (uint256)",
  "function feeTicket(address, uint256) view returns (uint128 amount, uint64 reclaimAt)",
  "function fundTickets(address account, uint256 firstNonce, uint256 count) payable",
  "function attestedSpenders(address) view returns (bool)",
  "function stake(address registry, uint32 delay) payable",
  "function requestWithdraw(address asset, uint256 amount)",
]);

export const ACCOUNT_ABI = parseAbi([
  "function verifyFrame(bytes32 treeHash, bytes32 specHash, bytes32 root, uint8 path, uint256 policy, address[] owners, bytes extra)",
  "function policyWord() view returns (uint256)",
  "struct Call { address target; uint256 value; bytes data; }",
  "function executeVerified(Call[] calls, bytes spec)",
  "function digestOf(bytes32 treeHash, bytes32 specHash, uint64 expiry, bytes32 root, uint8 path, bytes32 txCommit) view returns (bytes32)",
  "function threshold() view returns (uint8)",
  "function policyVersion() view returns (uint32)",
  "function maxTtl() view returns (uint32)",
  "function owners() view returns (address[])",
  "function consumed(bytes32) view returns (bool)",
  "function ledger() view returns (address[])",
  "function setPolicy(uint32 maxTtl, uint32 maxSnapshotTtl, uint32 allowMask)",
  "event VerbatimResult(bool indexed ok, bytes err)",
]);

const BODY_PARAMS = [
  { type: "tuple[]", components: [{ type: "address", name: "target" }, { type: "uint256", name: "value" }, { type: "bytes", name: "data" }] },
  { type: "bytes" },
] as const;

export const encodeBody = (calls: Call[], spec: Hex): Hex => encodeAbiParameters(BODY_PARAMS, [calls, spec]);

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
      // SSTORE2's leading STOP byte, then publisher(32) || vdesc.
      const code = (await this.client.getCode({ address: blob })) as Hex;
      return { blob: `0x${code.slice(68)}` as Hex, publisher: `0x${code.slice(4, 68)}` as Hex, epoch: BigInt(epoch), status: Number(status) };
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
  spenderIsAttested(spender: Address) {
    return this.get(`sp:${spender}`, () => this.read("attestedSpenders", [spender]));
  }
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
  for (let i = 0; i < n; i++) {
    const op = rdU8(s, p++);
    if (op === SPEC.NO_CODE) out.push(toAddr(rdBe(s, p, 20)));
    p += itemSize(op);
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
  expiry: bigint;
  account: bigint;
  paymaster: bigint;
  execute: bigint;
  executeState: bigint;
}

/** Fits the deployed sidecar's flat 100k prefix cap, with 2 x 2,800 of signature cost. */
export const PUBLIC_GATEWAY_GAS: GasPlan = { expiry: 3_500n, account: 18_500n, paymaster: 72_400n, execute: 1_200_000n, executeState: 1_500_000n };

/** The deployed verifier. EIP-8141 names another address, where the devnet has no code (contracts/docs/DECISIONS.md, D-A19). */
export const EXPIRY_VERIFIER: Address = "0x0000000000000000000000000000000000008141";

export interface Sentence {
  account: Address;
  chainId: bigint;
  expiry: bigint;
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
  hints: Address[];
  snapshotRoot: Hex;
}

export interface PrepareArgs {
  client: PublicClient;
  trust: ChainTrust;
  account: Address;
  paymaster: Address;
  calls: Call[];
  /** Unix seconds. Defaults to a few minutes from now. */
  expiry?: bigint;
  gas?: GasPlan;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  /** How many owner entries will be attached; `txCommit` covers the count. */
  signers?: number;
  /** Replay tests: sign for a nonce other than the next one. */
  nonce?: bigint;
  /** Scripts: do not top up fee tickets first (the ticket attacks need that). */
  skipTickets?: boolean;
  /** Lets an attack render something other than what the transaction carries. */
  overrideSentence?: { tree: Hex; spec: Hex };
}

const totalGas = (g: GasPlan) => g.expiry + g.account + g.paymaster + g.execute + g.executeState;

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
export const DEFAULT_VALIDITY_S = 240;
/** The devnet's base fee is 7 wei. */
export const DEFAULT_MAX_FEE = 10_000n;
export const PATH_PAYMASTER = 2;

export const EXECUTE_SELECTOR = encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "executeVerified", args: [[], "0x"] }).slice(0, 10) as Hex;

export const executeFrameData = (calls: Call[], spec: Hex): Hex => `${EXECUTE_SELECTOR}${encodeBody(calls, spec).slice(2)}` as Hex;

const SIGNERS = 2;

export async function prepare(a: PrepareArgs): Promise<Prepared> {
  const gas = a.gas ?? PUBLIC_GATEWAY_GAS;
  const chainId = BigInt(await a.client.getChainId());
  const expiry = a.expiry ?? BigInt(Math.floor(Date.now() / 1000) + DEFAULT_VALIDITY_S);
  const maxFee = a.maxFeePerGas ?? DEFAULT_MAX_FEE;
  const [root, issuedAt, snapshotExpiry] = (await a.client.readContract({ address: a.paymaster, abi: PAYMASTER_ABI, functionName: "snapshot" } as never)) as [Hex, bigint, bigint];
  const policyWord = (await a.client.readContract({ address: a.account, abi: ACCOUNT_ABI, functionName: "policyWord" } as never)) as bigint;
  const policyVersion = Number((policyWord >> 120n) & 0xffffffffn);
  const owners = (await a.client.readContract({ address: a.account, abi: ACCOUNT_ABI, functionName: "owners" } as never)) as Address[];
  const signers = a.signers ?? SIGNERS;
  const base = {
    chainId,
    account: a.account,
    expiry,
    snapshotRoot: root,
    policyVersion,
    path: PATH_PAYMASTER,
    feeAsset: ZERO_ADDRESS,
    maxFee: totalGas(gas) * maxFee,
    body: encodeBody(a.calls, "0x"),
  };
  const { out, hints } = await renderWithChain(base, a.trust, a.client);
  const sentence = a.overrideSentence ? { ...out, tree: a.overrideSentence.tree, spec: a.overrideSentence.spec, treeHash: keccak256(a.overrideSentence.tree), specHash: keccak256(a.overrideSentence.spec) } : out;
  const nonce = a.nonce ?? BigInt(await a.client.getTransactionCount({ address: a.account }));
  const frames = [
    frame({ mode: Mode.VERIFY, flags: 0, target: EXPIRY_VERIFIER, execution: gas.expiry, data: toHex(expiry, { size: 8 }) }),
    frame({ mode: Mode.VERIFY, flags: Scope.EXECUTION, target: a.account, execution: gas.account, data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "verifyFrame", args: [sentence.treeHash, sentence.specHash, root, PATH_PAYMASTER, policyWord, owners, "0x"] }) }),
    frame({ mode: Mode.VERIFY, flags: Scope.PAYMENT, target: a.paymaster, execution: gas.paymaster, data: encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "verifyFrame", args: [hints, root, issuedAt, snapshotExpiry] }) }),
    frame({ mode: Mode.SENDER, target: a.account, execution: gas.execute, state: gas.executeState, data: executeFrameData(a.calls, sentence.spec) }),
  ];
  const tx = newTx({ chainId, sender: a.account, nonce, frames, maxFeePerGas: maxFee, maxPriorityFeePerGas: a.maxPriorityFeePerGas ?? 100n });
  const commit = txCommit(tx, signers);
  const typed = typedData(chainId, a.account, sentence.treeHash, sentence.specHash, expiry, root, PATH_PAYMASTER, commit);
  return {
    account: a.account,
    chainId,
    expiry,
    tree: sentence.tree,
    spec: sentence.spec,
    treeHash: sentence.treeHash,
    specHash: sentence.specHash,
    risk: sentence.risk,
    tx,
    txCommit: commit,
    digestTypedData: typed,
    digest: hashTypedData(typed),
    calls: a.calls,
    hints,
    snapshotRoot: root,
  };
}

/** §7.4, the same words VerbatimAccount hashes from introspection. Frame 1 is always blanked. */
export function txCommit(tx: FrameTx, signatureCount: number = tx.signatures.length): Hex {
  const words: bigint[] = [tx.chainId, BigInt(tx.sender), tx.nonceSeq, tx.fees.maxPriorityFeePerGas, tx.fees.maxFeePerGas, BigInt(tx.frames.length)];
  tx.frames.forEach((f, i) => {
    words.push(BigInt(f.mode), BigInt(f.flags), BigInt(f.target ?? tx.sender), f.value, f.limits.execution, f.limits.state, i === 1 ? 0n : BigInt(keccak256(f.data)));
  });
  words.push(BigInt(signatureCount), BigInt(tx.blobVersionedHashes.length));
  return keccak256(concat(words.map((w) => toHex(w, { size: 32 }))));
}

export function typedData(chainId: bigint, account: Address, treeHash: Hex, specHash: Hex, expiry: bigint, snapshotRoot: Hex, path: number, txCommitValue: Hex) {
  return {
    domain: { name: "Verbatim", version: "11", chainId, verifyingContract: account },
    types: { Tx: [{ name: "treeHash", type: "bytes32" }, { name: "specHash", type: "bytes32" }, { name: "expiry", type: "uint64" }, { name: "snapshotRoot", type: "bytes32" }, { name: "path", type: "uint8" }, { name: "txCommit", type: "bytes32" }] },
    primaryType: "Tx" as const,
    message: { treeHash, specHash, expiry, snapshotRoot, path, txCommit: txCommitValue },
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

/** Trust read from a published snapshot instead of a contract, recording the leaves a render used: those become the proofs. */
export class SnapshotTrust implements Trust {
  used = new Map<string, Leaf>();
  private byKey = new Map<string, Leaf>();
  private codes = new Map<string, Hex>();
  constructor(public client: PublicClient, public snapshot: PublishedSnapshot, private cfg: { permit2: Address; weth: Address; publisher: Hex }) {
    for (const l of snapshot.leaves) if (l.type !== 0 && l.type !== 255) this.byKey.set(`${l.type}:${leafKey(l)}`, l);
  }
  private chain = () => BigInt(this.snapshot.chainId);
  private find(type: number, key: Hex[]): Leaf | null {
    const k = `${type}:${leafKey({ type, key })}`;
    const l = this.byKey.get(k) ?? null;
    if (l) this.used.set(k, l);
    return l;
  }
  private word = (v: bigint | string): Hex => encodeAbiParameters([{ type: "uint256" }], [BigInt(v)]);
  private addr = (a: Address): Hex => encodeAbiParameters([{ type: "address" }], [a]);
  codehashOf(a: Address): Hex {
    const k = a.toLowerCase();
    if (this.codes.has(k)) return this.codes.get(k)!;
    throw new Miss(async () => {
      const code = await this.client.getCode({ address: a });
      this.codes.set(k, code && code !== "0x" ? keccak256(code) : ZERO32);
    });
  }
  descriptor(codehash: Hex, selector: Hex) {
    const l = this.find(LEAF.DESC, [this.word(this.chain()), codehash, encodeAbiParameters([{ type: "bytes4" }], [selector])]);
    return l ? { blob: l.vdesc as Hex, publisher: l.value[1], epoch: 0n, status: Number(BigInt(l.value[2])) } : null;
  }
  tokenInfo(token: Address) {
    const l = this.find(LEAF.TOKEN, [this.word(this.chain()), this.addr(token)]);
    if (!l) return { symbol: ZERO32, decimals: 0, flags: 0, known: false };
    return { symbol: l.value[0], decimals: Number(BigInt(l.value[1])), flags: BigInt(l.value[2]) !== 0n ? 1 : 0, known: true };
  }
  nameOf(a: Address): Hex {
    return this.find(LEAF.NAME, [this.word(this.chain()), this.addr(a)])?.value[0] ?? ZERO32;
  }
  nameResolver(a: Address): Address {
    const v = this.find(LEAF.NAME, [this.word(this.chain()), this.addr(a)])?.value[1];
    return v ? (`0x${v.slice(26)}` as Address) : ZERO_ADDRESS;
  }
  hookIsAttested(codehash: Hex) {
    return !!this.find(LEAF.HOOK, [this.word(this.chain()), codehash]);
  }
  spenderIsAttested(spender: Address) {
    return !!this.find(LEAF.SPENDER, [this.word(this.chain()), this.addr(spender)]);
  }
  codeKind(codehash: Hex) {
    const r = this.find(LEAF.ROUTER, [this.word(this.chain()), codehash]);
    if (r) return Number(BigInt(r.value[0]));
    return this.find(LEAF.PROXY, [this.word(this.chain()), codehash]) ? 2 : 0;
  }
  routerConfig() {
    return this.cfg;
  }
  proxyTemplate(codehash: Hex) {
    const l = this.find(LEAF.PROXY, [this.word(this.chain()), codehash])!;
    return { upgrader: `0x${l.value[0].slice(26)}` as Address, logicCodehash: l.value[1], impl: `0x${l.value[2].slice(26)}` as Address, getter: l.value[3].slice(0, 10) as Hex };
  }
}

export interface StatelessGasPlan {
  expiry: bigint;
  account: bigint;
  execute: bigint;
  executeState: bigint;
}

/** Owners and attestors: 4 x 2,800 of signature cost against the 100k cap. */
export const STATELESS_GAS: StatelessGasPlan = { expiry: 3_500n, account: 85_300n, execute: 1_200_000n, executeState: 1_500_000n };
export const PATH_STATELESS = 1;

const SIG_ENTRY = (signer: Address, msg: Hex, sig: Hex) => {
  const v = parseInt(sig.slice(130, 132), 16);
  return { scheme: 1, signer, msg, signature: concat([toHex(v >= 27 ? v - 27 : v, { size: 1 }), `0x${sig.slice(2, 130)}` as Hex]) };
};

export interface PreparedStateless extends Prepared {
  snapshot: PublishedSnapshot;
  /** What frame 1 carried. */
  proofs: Hex;
}

/** Stateless path: [expiry, VERIFY self with proofs, SENDER self]. No paymaster, no stake. Self-paid. */
export async function prepareStateless(a: { client: PublicClient; account: Address; calls: Call[]; snapshot: PublishedSnapshot; router: { permit2: Address; weth: Address; publisher: Hex }; expiry?: bigint; gas?: StatelessGasPlan; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; nonce?: bigint; overrideSentence?: { tree: Hex; spec: Hex }; proofsOverride?: Hex; extraOverride?: (x: { attestors: Address[]; issuedAt: bigint; snapExpiry: bigint; hints: Address[]; proofs: Hex }) => { attestors: Address[]; issuedAt: bigint; snapExpiry: bigint; hints: Address[]; proofs: Hex } }): Promise<PreparedStateless> {
  const gas = a.gas ?? STATELESS_GAS;
  const chainId = BigInt(await a.client.getChainId());
  const expiry = a.expiry ?? BigInt(Math.floor(Date.now() / 1000) + DEFAULT_VALIDITY_S);
  const maxFee = a.maxFeePerGas ?? DEFAULT_MAX_FEE;
  const policyWord = (await a.client.readContract({ address: a.account, abi: ACCOUNT_ABI, functionName: "policyWord" } as never)) as bigint;
  const owners = (await a.client.readContract({ address: a.account, abi: ACCOUNT_ABI, functionName: "owners" } as never)) as Address[];
  const trust = new SnapshotTrust(a.client, a.snapshot, a.router);
  const root = a.snapshot.root;
  const base = {
    chainId,
    account: a.account,
    expiry,
    snapshotRoot: root,
    policyVersion: Number((policyWord >> 120n) & 0xffffffffn),
    path: PATH_STATELESS,
    feeAsset: ZERO_ADDRESS,
    maxFee: (gas.expiry + gas.account + gas.execute + gas.executeState) * maxFee,
    body: encodeBody(a.calls, "0x"),
  };
  const { out, hints } = await renderWithChain(base, trust as never, a.client);
  const sentence = a.overrideSentence ? { ...out, tree: a.overrideSentence.tree, spec: a.overrideSentence.spec, treeHash: keccak256(a.overrideSentence.tree), specHash: keccak256(a.overrideSentence.spec) } : out;
  const tree = treeOf(a.snapshot);
  const proofs = a.proofsOverride ?? encodeProofs(tree, [...trust.used.values()]);
  let x = { attestors: a.snapshot.attestors, issuedAt: BigInt(a.snapshot.issuedAt), snapExpiry: BigInt(a.snapshot.expiry), hints, proofs };
  if (a.extraOverride) x = a.extraOverride(x);
  const extra = encodeAbiParameters([{ type: "address[]" }, { type: "uint64" }, { type: "uint64" }, { type: "address[]" }, { type: "bytes" }], [x.attestors, x.issuedAt, x.snapExpiry, x.hints, x.proofs]);
  const nonce = a.nonce ?? BigInt(await a.client.getTransactionCount({ address: a.account }));
  const frames = [
    frame({ mode: Mode.VERIFY, flags: 0, target: EXPIRY_VERIFIER, execution: gas.expiry, data: toHex(expiry, { size: 8 }) }),
    frame({ mode: Mode.VERIFY, flags: Scope.EXECUTION_AND_PAYMENT, target: a.account, execution: gas.account, data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "verifyFrame", args: [sentence.treeHash, sentence.specHash, root, PATH_STATELESS, policyWord, owners, extra] }) }),
    frame({ mode: Mode.SENDER, target: a.account, execution: gas.execute, state: gas.executeState, data: executeFrameData(a.calls, sentence.spec) }),
  ];
  const tx = newTx({ chainId, sender: a.account, nonce, frames, maxFeePerGas: maxFee, maxPriorityFeePerGas: a.maxPriorityFeePerGas ?? 100n });
  const commit = txCommit(tx, SIGNERS + a.snapshot.signatures.length);
  const typed = typedData(chainId, a.account, sentence.treeHash, sentence.specHash, expiry, root, PATH_STATELESS, commit);
  return { account: a.account, chainId, expiry, tree: sentence.tree, spec: sentence.spec, treeHash: sentence.treeHash, specHash: sentence.specHash, risk: sentence.risk, tx, txCommit: commit, digestTypedData: typed, digest: hashTypedData(typed), calls: a.calls, hints, snapshotRoot: root, snapshot: a.snapshot, proofs };
}

/** Owners' entries over the digest, then the attestors' over the snapshot, each ascending by signer. */
export function withStatelessSignatures(p: PreparedStateless, ownerSigs: OwnerSig[]): FrameTx {
  const owners = [...ownerSigs].sort((x, y) => (BigInt(x.signer) < BigInt(y.signer) ? -1 : 1));
  const d = snapshotDigest(BigInt(p.snapshot.chainId), p.snapshot.root, BigInt(p.snapshot.issuedAt), BigInt(p.snapshot.expiry));
  return { ...p.tx, signatures: [...owners.map((s) => SIG_ENTRY(s.signer, p.digest, s.sig)), ...p.snapshot.signatures.map((s) => SIG_ENTRY(s.signer, d, s.sig))] };
}

const SIG_4337 = { type: "tuple", components: [{ name: "treeHash", type: "bytes32" }, { name: "specHash", type: "bytes32" }, { name: "expiry", type: "uint64" }, { name: "root", type: "bytes32" }, { name: "issuedAt", type: "uint64" }, { name: "snapExpiry", type: "uint64" }, { name: "ownerSigs", type: "bytes" }, { name: "attestorSigs", type: "bytes" }, { name: "attestors", type: "address[]" }, { name: "hints", type: "address[]" }, { name: "proofs", type: "bytes" }] } as const;
const EXECUTE_USER_OP: Hex = "0x8dd7712f"; // executeUserOp(PackedUserOperation,bytes32)
export const PATH_ERC4337 = 3;
export const ENTRY_POINT_V07: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const EP_NONCE = parseAbi(["function getNonce(address sender, uint192 key) view returns (uint256)"]);

export interface UserOpGas {
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
}

export const USER_OP_GAS: UserOpGas = { callGasLimit: 1_500_000n, verificationGasLimit: 300_000n, preVerificationGas: 500_000n };

export interface PreparedUserOp {
  account: Address;
  chainId: bigint;
  tree: Hex;
  spec: Hex;
  treeHash: Hex;
  specHash: Hex;
  risk: number;
  hints: Address[];
  expiry: bigint;
  proofs: Hex;
  /** The userOpHash: this path's txCommit. */
  hash: Hex;
  digest: Hex;
  digestTypedData: ReturnType<typeof typedData>;
  /** Everything but the signature, as a bundler's JSON wants it. */
  op: Record<string, unknown>;
  snapshot: PublishedSnapshot;
}

/** The production leg (§11): renders with the twin and proves from the snapshot. Sign `digestTypedData`, then call `userOpWithSignatures`. */
export async function prepareUserOp(a: { client: PublicClient; account: Address; calls: Call[]; snapshot: PublishedSnapshot; router: { permit2: Address; weth: Address; publisher: Hex }; fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }; expiry: bigint; gas?: UserOpGas; override?: { tree: Hex; spec: Hex } }): Promise<PreparedUserOp> {
  const gas = a.gas ?? USER_OP_GAS;
  const chainId = BigInt(await a.client.getChainId());
  const trust = new SnapshotTrust(a.client, a.snapshot, a.router);
  const policyVersion = Number(await a.client.readContract({ address: a.account, abi: ACCOUNT_ABI, functionName: "policyVersion" } as never));
  const base = { chainId, account: a.account, expiry: a.expiry, snapshotRoot: a.snapshot.root, policyVersion, path: PATH_ERC4337, feeAsset: ZERO_ADDRESS, maxFee: (gas.verificationGasLimit + gas.callGasLimit + gas.preVerificationGas) * a.fees.maxFeePerGas, body: encodeBody(a.calls, "0x") };
  const { out, hints } = await renderWithChain(base, trust as never, a.client);
  const tree = a.override?.tree ?? out.tree;
  const spec = a.override?.spec ?? out.spec;
  const treeHash = keccak256(tree);
  const specHash = keccak256(spec);
  const proofs = encodeProofs(treeOf(a.snapshot), [...trust.used.values()]);
  const nonce = (await a.client.readContract({ address: ENTRY_POINT_V07, abi: EP_NONCE, functionName: "getNonce", args: [a.account, 0n] } as never)) as bigint;
  const callData = concat([EXECUTE_USER_OP, encodeBody(a.calls, spec)]);
  const userOperation = { sender: a.account, nonce, callData, callGasLimit: gas.callGasLimit, verificationGasLimit: gas.verificationGasLimit, preVerificationGas: gas.preVerificationGas, maxFeePerGas: a.fees.maxFeePerGas, maxPriorityFeePerGas: a.fees.maxPriorityFeePerGas, signature: "0x" as Hex };
  const hash = getUserOperationHash({ chainId: Number(chainId), entryPointAddress: ENTRY_POINT_V07, entryPointVersion: "0.7", userOperation });
  const td = typedData(chainId, a.account, treeHash, specHash, a.expiry, a.snapshot.root, PATH_ERC4337, hash);
  const q = (n: bigint): Hex => `0x${n.toString(16)}`;
  const op = { sender: a.account, nonce: q(nonce), callData, callGasLimit: q(gas.callGasLimit), verificationGasLimit: q(gas.verificationGasLimit), preVerificationGas: q(gas.preVerificationGas), maxFeePerGas: q(a.fees.maxFeePerGas), maxPriorityFeePerGas: q(a.fees.maxPriorityFeePerGas) };
  return { account: a.account, chainId, tree, spec, treeHash, specHash, risk: out.risk, hints, expiry: a.expiry, proofs, hash, digest: hashTypedData(td as never), digestTypedData: td, op, snapshot: a.snapshot };
}

export function userOpWithSignatures(p: PreparedUserOp, sigs: OwnerSig[]): Record<string, unknown> {
  const owners = [...sigs].sort((x, y) => (BigInt(x.signer) < BigInt(y.signer) ? -1 : 1));
  const signature = encodeAbiParameters([SIG_4337], [{ treeHash: p.treeHash, specHash: p.specHash, expiry: p.expiry, root: p.snapshot.root, issuedAt: BigInt(p.snapshot.issuedAt), snapExpiry: BigInt(p.snapshot.expiry), ownerSigs: concat(owners.map((s) => s.sig)), attestorSigs: concat(p.snapshot.signatures.map((s) => s.sig)), attestors: p.snapshot.attestors, hints: p.hints, proofs: p.proofs }]);
  return { ...p.op, signature };
}

export { toHex };
