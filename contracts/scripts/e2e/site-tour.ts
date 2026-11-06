// Records a narrated tour of the live site, end to end. The narration drives the film: every line is synthesised first, and the
// browser holds each view for exactly as long as its line takes, so what is said is what is on screen.
//
//   1. The landing page, section by section, and the architecture diagram box by box. FAQ and the like get a quick skim.
//   2. The proof ledger: frame transactions from the EF frames devnet (EIP-8141, ERC-8421), each opened on the alt-mempool explorer
//      with its receipt read live from the devnet node, including a batch that reverted.
//   3. Every live check the site has, run through its own buttons on Sepolia: ENS, every case on /demo and /uniswap, the full demo.
//      Whenever a transaction lands it is opened on Blockscout; when its batch reverted, its logs are opened and decoded.
//
// Waiting for blocks is sped up (a badge says by how much), but never so far that a line spoken over it is cut short.
//
//   KOKORO_DIR=/path/to/kokoro pnpm exec tsx site-tour.ts
//
// KOKORO_DIR holds kokoro-v1.0.onnx, voices-v1.0.bin and a .venv with kokoro-onnx and soundfile (see tts.py). Without it, macOS
// `say` speaks instead. Other settings: SITE (default https://verbatim-wallet.vercel.app), VOICE (af_heart), VOICE_SPEED (1.08),
// MAX_SPEED (10), LANDING_ONLY=1, SKIP_LANDING=1, NO_RUNS=1 (landing, proofs and ENS: nothing is sent). Writes contracts/docs/demo/verbatim-tour.mp4
// and its transcript, contracts/docs/demo/VOICEOVER.md.
// Everything it runs is real, so it spends Sepolia gas from the server's accounts, and takes 30 to 45 minutes.
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { chromium, type Locator, type Page } from "playwright";
import { decodeAbiParameters, decodeErrorResult, keccak256, parseAbi, toHex, type Abi, type Hex } from "viem";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const WORK = resolve(HERE, ".video-tour");
const TTS_DIR = resolve(HERE, ".video-tour-tts");
const OUT = resolve(ROOT, "contracts/docs/demo/verbatim-tour.mp4");
const TRANSCRIPT = resolve(ROOT, "contracts/docs/demo/VOICEOVER.md");
const SITE = (process.env.SITE ?? "https://verbatim-wallet.vercel.app").replace(/\/$/, "");
const KOKORO_DIR = process.env.KOKORO_DIR ?? "";
const VOICE = process.env.VOICE ?? "af_heart";
const VOICE_SPEED = process.env.VOICE_SPEED ?? "1.08";
const MAX_SPEED = Number(process.env.MAX_SPEED ?? 10);
const LANDING_ONLY = process.env.LANDING_ONLY === "1";
/** Leaves the landing page out: the film starts at the proof ledger. */
const SKIP_LANDING = process.env.SKIP_LANDING === "1";
/** Landing, proofs and ENS only: nothing is sent, so nothing is spent. For trying the film out. */
const NO_RUNS = process.env.NO_RUNS === "1";
const W = 1440;
const H = 900;
const RUN = /^\W*Run\W*$/;
const DEVNET_RPC = "https://altmempool.forshtat.com/rpc";
const DEVNET_EXPLORER = "https://explorer.altmempool.wtf/";
const BLOCKSCOUT = "https://eth-sepolia.blockscout.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

rmSync(WORK, { recursive: true, force: true });
mkdirSync(resolve(WORK, "seg"), { recursive: true });
mkdirSync(TTS_DIR, { recursive: true });

// ================= the voice =================
/** How a line is spoken: names and numbers spelled out the way a person would say them. The transcript keeps the written form. */
const SPOKEN: [RegExp, string][] = [
  [/verbatim-demo\.eth/g, "verbatim demo dot eth"],
  [/verbatim-dem0\.eth/g, "verbatim dem-zero dot eth"],
  [/\bEIP-8141\b/g, "E I P eighty-one forty-one"],
  [/\bERC-8421\b/g, "E R C eighty-four twenty-one"],
  [/\bERC-4337\b/g, "E R C forty-three thirty-seven"],
  [/\bERC-7730\b/g, "E R C seventy-seven thirty"],
  [/\bEIP-712\b/g, "E I P seven twelve"],
  [/\bENSv2\b/g, "E N S v2"],
  [/\bENS\b/g, "E N S"],
  [/\bdUSDC\b/g, "D U S D C"],
  [/\bdisplayvm-ts\b/g, "display V M T S"],
  [/\bDisplayVM\b/g, "Display V M"],
  [/\bURRender\b/g, "U R Render"],
  [/\bFrameReader\b/g, "Frame Reader"],
  [/\bTreeMismatch\b/g, "Tree Mismatch"],
  [/\bVTREE\b/g, "V tree"],
  [/\bVSPEC\b/g, "V spec"],
  [/\bSpecHashMismatch\b/g, "Spec Hash Mismatch"],
  [/\bPolicyRefused\b/g, "Policy Refused"],
  [/\bSignersNotSortedOrUnknown\b/g, "Signers Not Sorted Or Unknown"],
  [/\bAssertionFailed\b/g, "Assertion Failed"],
  [/\bTtlTooLong\b/g, "T T L Too Long"],
  [/\bVerbatimResult\b/g, "Verbatim Result"],
  [/\bTicketCharged\b/g, "Ticket Charged"],
  [/\bVerbatimAccount\b/g, "Verbatim Account"],
  [/\bAPPROVALS_CLEARED\b/g, "approvals cleared"],
  [/\bDELEGATECALL\b/g, "delegate call"],
  [/\bVERIFY\b/g, "verify"],
  [/\bSENDER\b/g, "sender"],
  [/\bBLIND\b/g, "blind"],
  [/\b0x80\b/g, "hex eighty"],
  [/\bPermit2\b/g, "Permit two"],
  [/\bRPC\b/g, "R P C"],
  [/\bQR\b/g, "Q R"],
  [/\bCI\b/g, "C I"],
  [/\bEF\b/g, "E F"],
  [/\bv4\b/g, "v four"],
  [/\bETH\b/g, "E T H"],
  [/\becrecover\b/g, "E C recover"],
  [/\bkeccak\b/g, "kechak"],
  [/\b0\.0001\b/g, "zero point zero zero zero one"],
  [/\b0\.001\b/g, "zero point zero zero one"],
];
const spoken = (t: string) => SPOKEN.reduce((s, [re, to]) => s.replace(re, to), t);

type Clip = { text: string; file: string; dur: number };
/** Reads a 16-bit PCM WAV: its samples and rate. */
function readWav(path: string) {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF") throw new Error(`not a WAV: ${path}`);
  let off = 12;
  let rate = 0, bits = 0, ch = 0;
  let data: Buffer | null = null;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === "fmt ") {
      ch = b.readUInt16LE(off + 10);
      rate = b.readUInt32LE(off + 12);
      bits = b.readUInt16LE(off + 22);
    } else if (id === "data") data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  if (!data || bits !== 16 || ch !== 1) throw new Error(`expected 16-bit mono PCM: ${path}`);
  return { rate, samples: new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length)) };
}
const RATE = 24_000;

let server: ChildProcessWithoutNullStreams | null = null;
const waiting: (() => void)[] = [];
async function startServer() {
  if (!KOKORO_DIR) return;
  const py = process.env.TTS_PYTHON ?? resolve(KOKORO_DIR, ".venv/bin/python");
  server = spawn(py, ["-I", resolve(HERE, "tts.py"), KOKORO_DIR, VOICE, VOICE_SPEED]);
  server.stderr.on("data", () => {}); // onnxruntime is chatty
  const rl = createInterface({ input: server.stdout });
  let ready: () => void = () => {};
  const isReady = new Promise<void>((r) => (ready = r));
  rl.on("line", (l) => {
    const m = JSON.parse(l);
    if (m.ready) ready();
    else waiting.shift()?.();
  });
  server.on("exit", (code) => {
    if (code) console.error(`tts.py exited with ${code}`);
    while (waiting.length) waiting.shift()!();
    ready();
  });
  await isReady;
}
let queue = Promise.resolve();
/** A spoken line, made once and cached on disk by its text and voice. */
function line(text: string): Promise<Clip> {
  const say = spoken(text);
  const file = resolve(TTS_DIR, createHash("sha1").update(`${KOKORO_DIR ? VOICE : "say"}|${VOICE_SPEED}|${say}`).digest("hex").slice(0, 20) + ".wav");
  const clip = (): Clip => {
    const w = readWav(file);
    return { text, file, dur: w.samples.length / w.rate };
  };
  if (existsSync(file)) return Promise.resolve(clip());
  const job = queue.then(async () => {
    if (existsSync(file)) return;
    if (server) {
      const done = new Promise<void>((r) => waiting.push(r));
      server.stdin.write(JSON.stringify({ say, out: file }) + "\n");
      await done;
    } else {
      const aiff = file.replace(/\.wav$/, ".aiff");
      spawnSync("say", ["-v", "Samantha", "-r", "185", "-o", aiff, say]);
      spawnSync("ffmpeg", ["-y", "-v", "error", "-i", aiff, "-ar", String(RATE), "-ac", "1", "-c:a", "pcm_s16le", file]);
      rmSync(aiff, { force: true });
    }
  });
  queue = job.catch(() => {});
  return job.then(clip);
}
const LEAD = 0.15, GAP = 0.3, TAIL = 0.45;
const needOf = (clips: Clip[]) => (clips.length ? LEAD + clips.reduce((n, c) => n + c.dur, 0) + GAP * (clips.length - 1) + TAIL : 0);

// ================= what is said =================
const N = {
  hero: "This is Verbatim. In February 2025, Bybit's signers approved what a tampered Safe frontend showed them, and one and a half billion dollars left. Verbatim makes Ethereum's new frame transactions rebuild every transaction into the sentence you signed, inside the validation frame. Different words, and the alt mempool never admits it. A broken promise, and the whole batch reverts.",
  heroDevice: "On the right is what an owner actually reads and signs: a sentence, not calldata, with its guarantees listed first.",
  problem: "Clear signing today turns calldata into readable text, but only inside the wallet. Nothing on chain checks that text against the calldata, and nothing enforces what it promised, so a tampered transaction can still land. Verbatim does both on chain: validation checks the text, and execution enforces it.",
  how: [
    "Step one. A frontend builds the calls, the sentence as VTREE bytes, and its guarantees as VSPEC. It may be tampered with, and so may the host, the RPC and the relayer. Verbatim trusts none of them.",
    "Step two. An offline device decodes the VTREE itself, shows the VSPEC guarantees first, and signs the hashes of both, with an expiry. It never signs raw calldata.",
    "Step three. During validation, a VERIFY frame renders the VTREE again from the real calldata. If it differs from what was signed, the transaction never enters the mempool.",
    "Step four. The calls run, then the account asserts every promise in the VSPEC. If a balance is off, or an approval is left standing, the whole batch is undone.",
  ],
  archIntro: "Here's the architecture, in the order a transaction meets it. Everything left of the device is untrusted.",
  arch: {
    frontend: "The frontend, with the host, the RPC and the relayer. Anything they change shows up as different words.",
    ts: "Two formats carry every transaction. VTREE is the sentence as canonical bytes, and VSPEC is what must be true after the batch. Owners sign the hash of each. displayvm-ts is our TypeScript twin of the on-chain renderer that writes them. It's ours, and still untrusted: if it disagrees with the chain, the transaction fails closed. Ten thousand random cases per CI run compare the two, byte for byte.",
    signer: "The offline signer is one HTML file, or an Android app with no internet permission. It reads the request from a rotating QR code, shows the guarantees first, and signs the owner digest: the hashes of the VTREE and VSPEC, the expiry, the snapshot root, the path, and a commitment to the transaction. The signature goes back by QR. On a frame transaction it's an explicit-digest signature, so the protocol checks every signature before any frame runs.",
    pstate: "The stateless path drops the paymaster: an expiry frame, a VERIFY frame for the account, and the SENDER frame. The account renders from Merkle proofs carried inside the transaction, against a snapshot the attestors signed. No stake, and no global state. That makes it valid in any frame mempool.",
    ppay: "Three paths carry it, and the first two are EIP-8141 frame transactions. The main one is the paymaster path: an expiry frame, a VERIFY frame for the account, a VERIFY frame for a staked paymaster, and the SENDER frame that executes. The paymaster renders from its own cache and rebuilds the owner digest. The canonical rules refuse this storage read. ERC-8421 admits it because the renderer is staked. That's what the alt mempool is for.",
    p4337: "And for chains without frames, the same logic behind any ERC-4337 bundler, also live on Sepolia.",
    trust: "Trust decides which contracts, tokens and names may be rendered. The attestor quorum and the ENS publisher would both have to collude to lie, and the ENS exclusivity proof is read again at execution.",
    render: "Render on chain. DisplayVM runs the descriptors, URRender decodes the Universal Router and v4 actions, and hook risk is read from the low bits of the hook's address. The VTREE it writes must hash to what the owners signed.",
    refused: "If the words differ, the spec is weaker, the contract is unattested, or the policy refuses a risk, validation fails. Nobody pays, and nothing is broadcast.",
    account: "Once admitted, VerbatimAccount works in an inner self-call: the expiry, revocations, live re-checks, the calls, then every assertion in the VSPEC. There's no DELEGATECALL in it, which is checked on the bytecode.",
    landed: "If every promise holds, it lands: checked once on the words, and once on the effects.",
    reverted: "If an assertion fails, everything the calls did is undone. The fee stays paid, and the signed digest can't be replayed.",
  } as Record<string, string>,
  compare: "Here's the difference, recorded on Sepolia. The same 0.001 ETH swap on Uniswap's official contracts, through a pool whose hook skims the output. The ordinary wallet lost nearly all of it. With Verbatim, the VTREE, the sentence the chain rebuilds from the calldata, carried three risk lines read from the hook's address. The account answered PolicyRefused, and nothing moved. Had the screen hidden a warning, the rebuilt VTREE wouldn't match, and the VSPEC would still hold the output to the signed minimum after the calls. We also compromised Uniswap's real interface: it quoted 26 USDC, and the ordinary wallet got 0.026.",
  benefits: "So risk arrives in plain words, read from the hook's address on chain. Every transaction carries a mandatory expiry. A name has to earn its place with a live exclusivity proof. And it all fits the rails you already have.",
  paths: "Both frame paths are live on the public EF devnet, on the final build, under the hundred-thousand gas cap. With fifty transactions pending, rotating the trust snapshot invalidated all fifty on the paymaster path, and none on the stateless path.",
  proof: "And don't take the page's word for it. These counts are read from the proof ledger, and every row links to its transaction, or to the named revert that stopped it.",
  limits: "The limits are stated too. Stolen keys are out of scope, and so is an accurate sentence that's misunderstood.",
  proofsIntro: "Here is the proof ledger. Each row is what a live network returned. We'll start on the EF frames devnet: EIP-8141 frame transactions, sent through the ERC-8421 alternative mempool.",
  honest: "An honest transfer on the paymaster path: four frames. Frame zero checks the expiry. Frame one is the account's VERIFY frame. Frame two is the paymaster's VERIFY frame, which renders the sentence from its cache in about sixty thousand gas. Frame three is the SENDER frame, which executes.",
  honestWhy: "Why frames matter. The protocol validates the owners' signatures over an explicit message, so the account never calls ecrecover: it rebuilds the digest from its own render, and compares. A VERIFY frame reads the sender frame's calldata through the new introspection opcodes, which our FrameReader exposes to Solidity.",
  honestEx: "Here it is on the alt-mempool explorer: on chain, with its four frames, their roles and their modes.",
  stateless: "The stateless path needs no paymaster and no stake: three frames. The account's VERIFY frame renders from Merkle proofs carried in the transaction itself.",
  statelessEx: "On the explorer: the expiry frame, the account's VERIFY frame, and the SENDER frame.",
  a1: "When the words are wrong, there's nothing to show on an explorer. Swap the recipient on the devnet, and the paymaster's validation frame reverts with SpecHashMismatch. It's refused before the mempool.",
  b14: "This one was admitted and mined, then broke its promise: an approval left standing after the batch. APPROVALS_CLEARED requires every approval the batch names to be back at zero.",
  b14Ex: "On the explorer it's on chain, like any other. The revert is inside, so let's read the receipt.",
  g0c: "Why the alternative mempool matters. The paymaster reads its own storage during validation, which the canonical rules refuse. ERC-8421 admits it for a staked paymaster, under a flat hundred-thousand gas cap, and signature checks count toward it: a prefix at exactly one hundred thousand was admitted, and one gas more was refused.",
  bench: "And the shared-paymaster risk, measured: fifty signed transactions from fifty senders, on each path. Rotating the snapshot root would evict all fifty on the paymaster path, because their signatures cover the root, and none on the stateless path, which carries its snapshot inside each transaction.",
  ensIntro: "Now everything the site can run, live on Sepolia. First, ENS, the trust root for names.",
  ensProof: "verbatim-demo.eth passes the exclusivity proof. ENSv2's argument-scoped roles show that exactly one party can write its clear-signing record: no root roles, no admin, and no way to swap the resolver.",
  ensLookPre: "Now the lookalike, verbatim-dem0.eth, with a zero.",
  ensLook: "It fails. So the device would show that address as hex, never as the name.",
  ensResolve: "And at execution, the real name resolves forward to its address and back again. That's why ENS matters here: it answers who you're paying, who published each descriptor, who may attest, and what's been revoked, and each answer is checked again when the transaction executes.",
  demoIntro: "Every case on the live demo runs through ERC-4337 on Sepolia. The server signs with two of the account's three owner keys, standing in for the offline device.",
  uniIntro: "Uniswap. Wallets blind-sign Universal Router calls, because no descriptor describes them. URRender decodes the router's commands and v4 actions on chain, inside validation.",
  fullIntro: "Finally, the full demo in order: an ordinary wallet, an honest swap, a lying frontend, a dangerous hook, and a contract that does more than it says.",
  fullLog: "The log keeps every run. The lying frontend and the dangerous hook never got a transaction: both were refused before the mempool.",
  history: "And every run stays on record, in the test history.",
};

/** Per case: what is said while it runs, on the explorer when it lands, and on its result. */
const CASES: Record<string, { pre: string; ex?: string; post: string }> = {
  "Send 1 dUSDC": {
    pre: "An honest transfer of one dUSDC to verbatim-demo.eth. The bundler simulates validation, which renders the sentence on chain and checks the owners' signatures over its hash.",
    ex: "On the explorer: one user operation in the bundle, status success.",
    post: "As expected: it landed, and the name was resolved forward and in reverse at execution, not at render.",
  },
  "Swap the recipient": {
    pre: "The Bybit attack. The owners sign a payment to verbatim-demo.eth, but the calldata pays the attacker. The chain renders the calldata again, so the recipient differs, and so does the hash of T.",
    post: "TreeMismatch, during validation. The bundler never broadcasts it: no transaction, and no fee.",
  },
  "Empty the assertions": {
    pre: "Here the sentence is honest, but the frontend strips the guarantees out of the spec.",
    post: "The digest the chain rebuilds no longer matches what the owners signed, so their signatures recover to unknown addresses: SignersNotSortedOrUnknown.",
  },
  "Call an unattested contract": {
    pre: "A call to a contract no attestor vouches for, with data no descriptor explains.",
    post: "Unattested means unexplained, and there's no effects-only mode. PolicyRefused.",
  },
  "Send after the expiry": {
    pre: "This one is signed with a twenty-second expiry, and the host holds it until that passes. Every transaction carries a mandatory absolute expiry. On frames it's a dedicated expiry frame at index zero. Here it's checked in validation, and again at execution.",
    post: "Its expiry has passed, so it's refused before the mempool.",
  },
  "Date the expiry far ahead": {
    pre: "Now the opposite: a signature valid for hours, which is lasting authority over the account. The device refuses to sign it, so here it's signed anyway, the way a compromised device would.",
    post: "Nothing moved. Only the fee was paid.",
  },
  "Leave an approval standing": {
    pre: "A truthful contract that does more than it says: it leaves a Permit2 approval standing after the batch. The sentence is honest, so it's admitted.",
    post: "Batch reverted, and the fee is kept.",
  },
  "Swap 0.0001 ETH on Uniswap v4": {
    pre: "An honest swap of 0.0001 ETH through Uniswap's official Universal Router on Sepolia, with a minimum output one percent under a fresh quote.",
    ex: "On the explorer: landed, status success.",
    post: "The minimum output and the hook are in the signed sentence, and the amount received is asserted after the swap.",
  },
  "Reroute the swap": {
    pre: "A compromised frontend shows that same swap, but routes it through a pool whose hook takes the output, with a minimum output of zero.",
    post: "Rendered again on chain, the words differ: TreeMismatch.",
  },
  "Ordinary wallet": {
    pre: "Why this matters for Uniswap: hooks are v4's biggest new risk surface. Here an ordinary wallet sends that rerouted swap. It has no way to object.",
    ex: "It lands, and the hook takes nearly everything. We've done the same through Uniswap's real interface, compromised at build time.",
    post: "As expected, and that's the problem.",
  },
  "Verbatim, on the true sentence": {
    pre: "Now Verbatim signs the true sentence for those same bytes. URRender reads the hook's permissions from the low bits of its address. That's pure arithmetic, so it's allowed during validation.",
    post: "The sentence says: no minimum output, this hook can take your output, unverified hook. PolicyRefused.",
  },
  "Allow a router command to fail": {
    pre: "A router command with its allow-revert flag set, bit 0x80 of the command byte. It could fail silently while the rest of the batch runs on.",
    post: "That raises a risk line, and the policy refuses it.",
  },
  "Use an unknown router command": {
    pre: "A router command no descriptor explains, here a gasless permit.",
    post: "It renders as BLIND, and anything blind is refused. URRender ships standalone, in Solidity and TypeScript, fuzzed to stay byte-identical.",
  },
};

// ================= decoding what landed =================
const ACCOUNT_ABI: Abi = (() => {
  const p = resolve(ROOT, "contracts/out/VerbatimAccount.sol/VerbatimAccount.json");
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")).abi;
  return parseAbi(["error AssertionFailed(uint256 index, uint256 expected, uint256 actual)", "error TtlTooLong(uint256 remaining, uint256 maxTtl)", "error Expired(uint256 timestamp, uint256 expiry)", "error CallFailed(uint256 index, bytes reason)", "error Replayed(bytes32 digest)"]);
})();
const topic = (sig: string) => keccak256(toHex(sig));
const T_RESULT = topic("VerbatimResult(bool,bytes)");
const T_TICKET = topic("TicketCharged(address,uint256,uint256)");
const T_TRANSFER = topic("Transfer(address,address,uint256)");
type Decoded = { name: string; args: readonly unknown[] } | null;
function decodeResult(data: Hex): Decoded {
  try {
    const [err] = decodeAbiParameters([{ type: "bytes" }], data);
    const e = decodeErrorResult({ abi: ACCOUNT_ABI, data: err as Hex });
    return { name: e.errorName, args: (e.args ?? []) as readonly unknown[] };
  } catch {
    return null;
  }
}
const fmtArgs = (d: Decoded) => (d ? `${d.name}(${d.args.map((a) => String(a)).join(", ")})` : "an error this recording could not decode");
const human = (s: number) => (s >= 3600 ? `${+(s / 3600).toFixed(1)} hours` : s >= 60 ? `${Math.round(s / 60)} minutes` : `${s} seconds`);
function sayErr(d: Decoded) {
  if (!d) return "an error this recording could not decode";
  const n = d.args.map((a) => Number(a));
  if (d.name === "AssertionFailed") return n[1] < 1e6 && n[2] < 1e6 ? `AssertionFailed, on item ${n[0]} of the spec: it expected ${n[1]}, and found ${n[2]}` : `AssertionFailed, on item ${n[0]} of the spec`;
  if (d.name === "TtlTooLong") return `TtlTooLong: ${human(n[0])} left on the signature, against a maximum of ${human(n[1])}`;
  return d.name;
}
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// ================= the recording =================
type Kind = "real" | "fast";
type Seg = { page: Page; a: number; b: number; kind: Kind; note: string; clips: Clip[] };
const born = new Map<Page, number>();
const segs: Seg[] = [];
let open: Omit<Seg, "b"> | null = null;
function cut(page: Page | null, kind: Kind = "fast", note = "", clips: Clip[] = []) {
  const now = Date.now();
  if (open) segs.push({ ...open, b: now });
  open = page ? { page, a: now, kind, note, clips } : null;
}

await startServer();
console.log(`voice: ${server ? `Kokoro ${VOICE} ×${VOICE_SPEED}` : "macOS say"}`);
// Every fixed line, made before the camera rolls.
{
  const all = [...(SKIP_LANDING ? [] : [N.hero, N.heroDevice, N.problem, ...N.how, N.archIntro, ...Object.values(N.arch), N.compare, N.benefits, N.paths, N.proof, N.limits]), N.proofsIntro, N.honest, N.honestWhy, N.honestEx, N.stateless, N.statelessEx, N.a1, N.b14, N.b14Ex, N.g0c, N.bench, N.ensIntro, N.ensProof, N.ensLookPre, N.ensLook, N.ensResolve, N.demoIntro, N.uniIntro, N.fullIntro, N.fullLog, N.history, ...Object.values(CASES).flatMap((c) => [c.pre, c.post, ...(c.ex ? [c.ex] : [])])];
  let said = 0;
  for (const t of all) said += (await line(t)).dur;
  console.log(`${all.length} fixed lines, ${(said / 60).toFixed(1)} minutes of speech`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: resolve(WORK, "raw"), size: { width: W, height: H } } });
ctx.setDefaultTimeout(30_000);
// A visible pointer: headless recordings have none.
await ctx.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.id = "__cursor";
    c.setAttribute("style", "position:fixed;z-index:2147483647;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 0 0 2px rgba(0,0,0,.5),0 0 18px rgba(255,255,255,.5);pointer-events:none;transform:translate(-40px,-40px);transition:transform 40ms linear");
    document.body.append(c);
    addEventListener("mousemove", (e) => (c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`), true);
    addEventListener("mousedown", () => (c.style.background = "rgba(141,255,176,.95)"), true);
    addEventListener("mouseup", () => (c.style.background = "rgba(255,255,255,.85)"), true);
  });
});
async function newPage() {
  const p = await ctx.newPage();
  born.set(p, Date.now());
  return p;
}

const site = await newPage();
const results: { what: string; ok: boolean; note: string }[] = [];
const check = (what: string, ok: boolean, note = "") => {
  results.push({ what, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${note ? `  ${note}` : ""}`);
};

/** A small label in the corner of the site, so a viewer knows which check is running. */
async function label(text: string) {
  await site
    .evaluate((t) => {
      let el = document.getElementById("__label");
      if (!el) {
        el = document.createElement("div");
        el.id = "__label";
        el.setAttribute("style", "position:fixed;left:20px;bottom:20px;z-index:2147483646;padding:8px 14px;border-radius:4px;background:#e9ecf3;color:#08090d;font:600 14px/20px 'Geist Mono',ui-monospace,monospace;box-shadow:0 8px 30px rgba(0,0,0,.5);pointer-events:none");
        document.body.append(el);
      }
      el.textContent = t;
      el.style.display = t ? "block" : "none";
    }, text)
    .catch(() => {});
}

// Written as a string: tsx would wrap named functions in a helper the page does not have.
const GLIDE = `(y, ms) => new Promise((done) => {
  document.documentElement.style.scrollBehavior = "auto";
  const s = scrollY, d = Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight)) - s, t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    scrollTo(0, s + d * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2));
    if (k < 1) requestAnimationFrame(step); else done();
  };
  requestAnimationFrame(step);
})`;
const glide = (y: number, ms: number, page: Page = site) => page.evaluate(`(${GLIDE})(${y}, ${ms})`);
const topOf = (sel: string, offset = 72) => site.evaluate(([s, o]) => {
  const el = document.querySelector(s as string);
  return el ? el.getBoundingClientRect().top + scrollY - (o as number) : scrollY;
}, [sel, offset] as const);
const glideTo = async (sel: string, ms: number, offset = 72) => glide(await topOf(sel, offset), ms);
async function glideToEl(l: Locator, ms: number, offset = 72, page: Page = site) {
  const y = await l.evaluate((el, o) => el.getBoundingClientRect().top + scrollY - o, offset).catch(() => null);
  if (y !== null) await glide(y, ms, page);
}

/** Moves the visible pointer to an element. */
async function point(l: Locator, page: Page = site) {
  await l.scrollIntoViewIfNeeded().catch(() => {});
  const box = await l.boundingBox().catch(() => null);
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
}
/** Moves the visible pointer to an element, then clicks it. */
async function press(l: Locator, page: Page = site) {
  await point(l, page);
  await l.click();
}

/**
 * Speaks lines over a page, in real time. `act` runs while the first line plays (a scroll, a click); the view then holds until
 * every line has been said.
 */
async function speak(page: Page, note: string, texts: string | string[], act?: () => Promise<unknown>, min = 0) {
  const clips = await Promise.all((Array.isArray(texts) ? texts : [texts]).map(line));
  const t0 = Date.now();
  cut(page, "real", note, clips);
  if (act) await act().catch((e) => console.log(`  (${note}: ${String(e).slice(0, 120)})`));
  await sleep(Math.max(0, Math.max(min, needOf(clips) * 1000) - (Date.now() - t0)));
}
/** Starts a sped-up stretch that a line is spoken over. */
async function over(page: Page, note: string, text?: string) {
  cut(page, "fast", note, text ? [await line(text)] : []);
}

// ---- transactions: the moment one lands, show it on the explorer ----
const seen = new Set<string>();
const txLinks = () => site.$$eval('a[href*="/tx/0x"]', (as) => as.map((a) => (a as HTMLAnchorElement).href)).catch(() => [] as string[]);
async function markSeen() {
  for (const h of await txLinks()) seen.add(h);
}

const PANEL_CSS = "background:#0c0f16;color:#e9ecf3;border:1px solid #8dffb0;border-radius:6px;padding:16px 18px;font:500 14px/22px ui-monospace,Menlo,monospace;box-shadow:0 12px 40px rgba(0,0,0,.45)";
const PANEL_HEAD = "color:#8dffb0;font:700 12px/18px ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Blockscout's logs for a transaction, once it has indexed them. */
async function blockscoutLogs(hash: string) {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${BLOCKSCOUT}/api/v2/transactions/${hash}/logs`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (r?.items?.length) return r.items as { topics: (string | null)[]; data: Hex; address: { hash: string } }[];
    await sleep(3000);
  }
  return [];
}

let shown = 0;
/** One Sepolia transaction on Blockscout. A batch that reverted gets its logs opened and its VerbatimResult decoded. */
async function sepoliaExplorer(hash: string, what: string, caseLine?: string) {
  const url = `${BLOCKSCOUT}/tx/${hash}`;
  const ex = await newPage();
  cut(null);
  let ok = false;
  for (let i = 0; i < 10 && !ok; i++) {
    await ex.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    for (let j = 0; j < 12 && !ok; j++) {
      await sleep(1000);
      const t = await ex.locator("main").innerText().catch(() => "");
      ok = /Status and method\s*(Success|Failed|Error|Reverted)/i.test(t) && /\bBlock\b\s*\d{6,}/.test(t);
    }
  }
  if (!ok) console.log(`  explorer: ${url} still indexing; shown as it is`);
  const logs = await blockscoutLogs(hash);
  const vr = logs.find((l) => l.topics[0]?.toLowerCase() === T_RESULT);
  const batchOk = vr ? BigInt(vr.topics[1] ?? "0x0") === 1n : null;
  const err = vr && !batchOk ? decodeResult(vr.data) : null;
  const first = batchOk === false ? "On the explorer, the transaction itself succeeds: the bundle ran, and the fee was paid." : caseLine ?? (batchOk ? "On the explorer: landed, status success." : "On the explorer: it landed.");
  await sleep(600);
  await speak(ex, `explorer · ${what}`, first, undefined, 3000);
  if (batchOk === false && vr) {
    cut(null);
    const tab = ex.getByRole("tab", { name: "Logs" }).first();
    if (await tab.count()) {
      await point(tab, ex);
      await tab.click().catch(() => {});
    } else await ex.goto(`${url}?tab=logs`, { waitUntil: "domcontentloaded" });
    const t0 = ex.getByText(T_RESULT, { exact: false }).first();
    await t0.waitFor({ timeout: 30_000 }).catch(() => {});
    await glideToEl(t0, 10, 420, ex);
    const sel = vr.data.length >= 138 ? `0x${vr.data.slice(130, 138)}` : "";
    await ex.evaluate(
      ([html, css]) => {
        const p = document.createElement("div");
        p.setAttribute("style", `position:fixed;right:24px;bottom:24px;width:660px;z-index:2147483646;${css}`);
        p.innerHTML = html;
        document.body.append(p);
      },
      [`<div style="${PANEL_HEAD}">Decoded by this recording with VerbatimAccount's ABI · the contract is not verified on Blockscout</div><div>event <b>VerbatimResult</b>(ok: <b style="color:#ff8d8d">false</b>,</div><div style="padding-left:2ch">err: <b style="color:#ff8d8d">${esc(fmtArgs(err))}</b>)</div><div style="margin-top:8px;color:#9aa3b5">topic 1 is ok = 0 · the data is the ABI-encoded error, selector ${sel}</div>`, PANEL_CSS] as const,
    );
    await speak(ex, `explorer logs · ${what}`, `But open its logs. The account's VerbatimResult event has ok equal to false, and the error is ${sayErr(err)}. Everything the calls did was rolled back.`);
  }
  shown++;
  console.log(`  explorer: ${url}${batchOk === false ? `  (batch reverted: ${fmtArgs(err)})` : ""}`);
  await ex.close();
  await site.bringToFront();
}

async function showNewTxs(what: string, lines?: () => string | undefined) {
  for (const href of await txLinks()) {
    if (seen.has(href)) continue;
    seen.add(href);
    const m = href.match(/\/tx\/(0x[0-9a-fA-F]{64})/);
    if (!m || !/etherscan\.io|blockscout/.test(href)) continue;
    await sepoliaExplorer(m[1], what, lines?.());
    cut(site, "fast", what);
  }
}

/** Waits for a condition, showing every transaction that lands meanwhile. */
async function until(what: string, cond: () => Promise<boolean>, ms: number, lines?: () => string | undefined) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await showNewTxs(what, lines);
    if (await cond().catch(() => false)) return true;
    await sleep(800);
  }
  return false;
}

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(DEVNET_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}
type FrameReceipt = { status: Hex; gasUsed: Hex; logs: { address: string; topics: Hex[]; data: Hex }[] };
/** One frame transaction on the alt-mempool explorer, then its receipt, read live from the devnet node and decoded. */
async function devnetExplorer(hash: string, what: string, intro: string) {
  const ex = await newPage();
  cut(null);
  await ex.goto(`${DEVNET_EXPLORER}tx/${hash}?node=${encodeURIComponent(DEVNET_RPC)}`, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  await ex.getByText("On chain").first().waitFor({ timeout: 30_000 }).catch(() => {});
  await sleep(800);
  const receipt = await rpc("eth_getTransactionReceipt", [hash]).catch(() => null);
  const frames: FrameReceipt[] = receipt?.frameReceipts ?? [];
  const roles: string[] = await ex.$$eval("table tbody tr", (rows) => rows.map((r) => ((r.querySelectorAll("td")[1] as HTMLElement | undefined)?.innerText ?? "").split("\n")[0].trim())).catch(() => []);
  await speak(ex, `explorer · ${what}`, intro, undefined, 3000);

  // The receipt: the explorer lists the frames but not their receipts, so this recording reads them from the node.
  cut(null);
  let ticket = false, transfer = false;
  let result: { ok: boolean; err: Decoded } | null = null;
  const rows = frames.map((f, i) => {
    const events = f.logs.map((l) => {
      if (l.topics[0] === T_TICKET) {
        ticket = true;
        return `TicketCharged(account ${short("0x" + l.topics[1].slice(26))}, nonce ${BigInt(l.topics[2])}, amount ${BigInt(l.data)} wei)`;
      }
      if (l.topics[0] === T_RESULT) {
        const ok = BigInt(l.topics[1]) === 1n;
        const err = ok ? null : decodeResult(l.data);
        result = { ok, err };
        return `VerbatimResult(ok: <b style="color:${ok ? "#8dffb0" : "#ff8d8d"}">${ok}</b>${ok ? "" : `, err: <b style="color:#ff8d8d">${esc(fmtArgs(err))}</b>`})`;
      }
      if (l.topics[0] === T_TRANSFER) {
        transfer = true;
        return `Transfer(${short("0x" + l.topics[1].slice(26))} → ${short("0x" + l.topics[2].slice(26))}, ${BigInt(l.data)}) on ${short(l.address)}`;
      }
      return `log ${l.topics[0]?.slice(0, 10)}… from ${short(l.address)}`;
    });
    const st = BigInt(f.status) === 1n;
    return `<div style="margin-top:6px"><b>frame ${i}</b> ${esc(roles[i] ?? "")} · status <b style="color:${st ? "#8dffb0" : "#ff8d8d"}">${Number(BigInt(f.status))}</b> · ${Number(BigInt(f.gasUsed)).toLocaleString("en-US")} gas</div>${events.map((e) => `<div style="padding-left:4ch;color:#c9d0de">↳ ${e}</div>`).join("")}`;
  });
  const head = `<div style="${PANEL_HEAD}">Receipt · eth_getTransactionReceipt from the devnet node, read live by this recording · block ${Number(BigInt(receipt?.blockNumber ?? "0x0"))}</div>`;
  await ex.evaluate(
    ([html, css]) => {
      const p = document.createElement("div");
      p.id = "__receipt";
      p.setAttribute("style", `margin:24px 0;${css}`);
      p.innerHTML = html;
      const hs = Array.from(document.querySelectorAll("h1,h2,h3,h4"));
      const at = hs.find((h) => (h.textContent ?? "").trim() === "Timeline");
      if (at && at.parentElement) at.parentElement.insertBefore(p, at);
      else document.body.append(p);
    },
    [head + rows.join(""), PANEL_CSS] as const,
  );
  const allOk = frames.length > 0 && frames.every((f) => BigInt(f.status) === 1n);
  const r = result as { ok: boolean; err: Decoded } | null;
  const said = [
    `Its receipt, read live from the devnet node: ${frames.length} frame receipts, ${allOk ? "every one with status one" : "and not all of them succeeded"}.`,
    ticket ? "The paymaster's TicketCharged event takes the fee from this nonce's ticket." : "",
    r && r.ok ? "The account's VerbatimResult says ok: every assertion held." : "",
    r && !r.ok ? `But the account's VerbatimResult says ok is false, with ${sayErr(r.err)}. The frame itself succeeds, because the batch runs in an inner self-call: its effects are rolled back, and the fee is kept.` : "",
    transfer && r?.ok ? "And there's the token transfer itself." : "",
  ].filter(Boolean).join(" ");
  const fd = ex.getByText("Frame details", { exact: true }).first();
  await speak(ex, `receipt · ${what}`, said, () => glideToEl(fd, 1200, 24, ex));
  shown++;
  console.log(`  devnet explorer: ${hash}  frames ${frames.length}, ${allOk ? "all ok" : "not all ok"}${r ? `, VerbatimResult ok=${r.ok}${r.ok ? "" : ` ${fmtArgs(r.err)}`}` : ""}`);
  await ex.close();
  await site.bringToFront();
}

// ================= the landing page =================
await fetch("https://verbatim-server.onrender.com/api/config").catch(() => {}); // wake the server while the landing plays
if (!SKIP_LANDING) {
await site.goto(SITE + "/", { waitUntil: "networkidle" });
await sleep(1200);
const landingStart = Date.now();
await speak(site, "landing · hero", N.hero);
await speak(site, "landing · the device", N.heroDevice, () => point(site.locator(".lp-device").first()));

await speak(site, "landing · the problem", N.problem, () => glideTo("#problem", 1600));

await speak(site, "landing · how it works, 1", N.how[0], async () => {
  await glideTo(".lp-trace", 1600, 340);
  await point(site.locator(".lp-trace > li").nth(0));
});
for (let i = 1; i < 4; i++) await speak(site, `landing · how it works, ${i + 1}`, N.how[i], () => point(site.locator(".lp-trace > li").nth(i)));

await speak(site, "landing · architecture", N.archIntro, async () => {
  await glideTo("#architecture", 1500);
  await sleep(500);
  await glideTo(".lp-arch", 1200, 24);
});
for (const id of ["frontend", "ts", "signer", "ppay", "pstate", "p4337", "trust", "render", "refused", "account", "landed", "reverted"]) {
  await speak(site, `architecture · ${id}`, N.arch[id], () => press(site.locator(`.react-flow__node[data-id="${id}"]`)));
}

await speak(site, "landing · same route, two wallets", N.compare, () => glideTo("#compare", 1500));
await speak(site, "landing · what changes", N.benefits, async () => {
  await glideTo("#benefits", 1200);
  await glide(await topOf("#paths", H - 120), 7000);
});
await speak(site, "landing · three paths", N.paths, () => glideTo("#paths", 1400));
await speak(site, "landing · proof", N.proof, () => glideTo("#proof", 1400));
await speak(site, "landing · limits", N.limits, () => glideTo("#limits", 1200));
// The rest of the page, skimmed.
cut(site, "real", "landing · skim");
for (const sel of ["#try", "#faq", ".lp-finale"]) await glideTo(sel, 700);
await sleep(600);
console.log(`landing: ${((Date.now() - landingStart) / 1000).toFixed(1)} s`);
}

const text = async (l: Locator) => ((await l.innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");
async function arrive(path: string, labelText: string, said?: string) {
  cut(null);
  await site.goto(SITE + path, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  await label(labelText);
  await speak(site, `arrive ${path}`, said ? [said] : [], undefined, 1500);
}

if (!LANDING_ONLY) {
  // ================= the proof ledger: frame transactions on the devnet =================
  await arrive("/proofs", "History & proofs · the proof ledger", N.proofsIntro);
  const row = (id: string) => site.locator("li.proof", { has: site.locator(".pid", { hasText: new RegExp(`^${id}$`) }) }).first();
  async function openRow(id: string, said: string | string[]) {
    const r = row(id);
    await r.waitFor({ timeout: 30_000 });
    await label(`Proof ledger · ${id}`);
    await speak(site, `proof · ${id}`, said, async () => {
      await glideToEl(r, 1200, 90);
      const head = r.locator(".proof-head");
      if ((await head.getAttribute("aria-expanded")) !== "true") await press(head);
    });
    return r;
  }
  async function txOf(r: Locator) {
    const a = r.locator(".plink a").first();
    if (!(await a.count())) return null;
    await point(a);
    return ((await a.getAttribute("href")) ?? "").match(/\/tx\/(0x[0-9a-fA-F]{64})/)?.[1] ?? null;
  }
  {
    const r = await openRow("HONEST", [N.honest, N.honestWhy]);
    const h = await txOf(r);
    if (h) await devnetExplorer(h, "HONEST", N.honestEx);
  }
  {
    const r = await openRow("S-HONEST", N.stateless);
    const h = await txOf(r);
    if (h) await devnetExplorer(h, "S-HONEST", N.statelessEx);
  }
  await openRow("A1", N.a1);
  {
    const r = await openRow("B14", N.b14);
    const h = await txOf(r);
    if (h) await devnetExplorer(h, "B14", N.b14Ex);
  }
  await openRow("G0c", N.g0c);
  await openRow("BENCH-N50", N.bench);

  // ================= ENS, live on Sepolia =================
  await arrive("/ens", "ENS · live checks on Sepolia");
  await over(site, "ens", N.ensIntro);
  await site.getByText(/is an exclusive publisher/).first().waitFor({ timeout: 90_000 }).catch(() => {});
  await label("ENS · verbatim-demo.eth: the exclusivity proof");
  await speak(site, "ens · exclusivity proof", N.ensProof, () => site.getByText(/is an exclusive publisher/).first().scrollIntoViewIfNeeded());
  check("ENS: verbatim-demo.eth passes the exclusivity proof", /is an exclusive publisher/.test(await text(site.locator("body"))));
  await label("ENS · the lookalike verbatim-dem0.eth");
  await press(site.getByRole("button", { name: "verbatim-dem0.eth", exact: true }).first());
  await over(site, "ens · lookalike", N.ensLookPre);
  await site.getByText(/fails:/).first().waitFor({ timeout: 90_000 }).catch(() => {});
  await speak(site, "ens · lookalike refused", N.ensLook, () => site.getByText(/fails:/).first().scrollIntoViewIfNeeded());
  check("ENS: the lookalike is refused", /verbatim-dem0\.eth fails/.test(await text(site.locator("body"))));
  await label("ENS · resolve verbatim-demo.eth");
  await press(site.getByRole("button", { name: "verbatim-demo.eth", exact: true }).last());
  cut(site, "fast", "ens · resolving");
  const resolved = site.getByText(/0x3aC4CAf4b6727FdB58A7784630E4689A4331c616/i).first();
  await resolved.waitFor({ timeout: 30_000 }).catch(() => {});
  await speak(site, "ens · resolved", N.ensResolve, () => resolved.scrollIntoViewIfNeeded());

  // ================= every live case =================
  if (!NO_RUNS) {
  async function runCases(path: string, name: string, intro: string) {
    await arrive(path, `${name} · every case, live on Sepolia`, intro);
    const cases = site.locator("li.lp-case");
    await cases.first().waitFor({ timeout: 120_000 });
    const ready = cases.first().getByRole("button", { name: RUN });
    await ready.waitFor({ timeout: 120_000 });
    cut(site, "fast", "the server wakes");
    for (let i = 0; i < 180 && (await ready.isDisabled()); i++) await sleep(1000);
    await markSeen();
    const n = await cases.count();
    for (let i = 0; i < n; i++) {
      const li = cases.nth(i);
      const title = (await li.locator("h3").innerText()).trim();
      const said = CASES[title];
      if (!said) console.log(`  (no lines written for "${title}")`);
      await label(`${name} · ${i + 1}/${n} · ${title}`);
      await glideToEl(li, 600, 90);
      await press(li.getByRole("button", { name: RUN }));
      await over(site, `${name} · ${title}`, said?.pre);
      const finished = () => li.getByRole("button", { name: "Run again" }).count().then(async (c) => c > 0 || (await li.locator(".lp-run-error").count()) > 0);
      await until(title, finished, 300_000, () => said?.ex);
      await li.locator(".lp-run").first().scrollIntoViewIfNeeded().catch(() => {});
      await speak(site, `${name} · ${title} · result`, said?.post ? [said.post] : [], undefined, 2500);
      const t = await text(li);
      const ok = /as expected/.test(t) && !/not as expected/.test(t);
      check(`${name}: ${title}`, ok, t.match(/The account’s answer: (\w+)/)?.[1] ?? "");
      await showNewTxs(title, () => said?.ex); // a transaction that appeared with the result
      cut(site, "fast", "between cases");
      await sleep(5000); // stays under the server's per-address limit
    }
  }
  await runCases("/demo", "Live demo", N.demoIntro);
  await runCases("/uniswap", "Uniswap", N.uniIntro);

  // The full demo, five steps in order
  await arrive("/demo", "Live demo · the full demo, in order");
  const full = site.getByRole("button", { name: "Run the full demo" });
  await full.waitFor({ timeout: 120_000 });
  for (let i = 0; i < 120 && (await full.isDisabled()); i++) await sleep(1000);
  await markSeen();
  await press(full);
  await over(site, "full demo", N.fullIntro);
  // The full demo lands three transactions, in this order; the third is the batch that reverts, and says so itself.
  const FULL = ["The ordinary wallet's swap lands, and the hook takes the output.", "The honest swap lands, status success."];
  let k = 0;
  const finishedAll = await until("full demo", () => site.getByText(/Full demo finished/).count().then((c) => c > 0), 900_000, () => FULL[k++]);
  check("Full demo finished", finishedAll);
  const log = site.locator("details.txlog");
  if ((await log.count()) && !(await log.evaluate((d: HTMLDetailsElement) => d.open))) await press(log.locator("summary"));
  await showNewTxs("full demo");
  await label("Live demo · every run of the full demo");
  await speak(site, "full demo · the log", N.fullLog, () => log.scrollIntoViewIfNeeded());
  }
}

// Ending: the runs just made, on the record
await arrive("/proofs?view=history", "History & proofs · every run on record", N.history);
await label("");
cut(site, "real", "end");
await sleep(2500);
cut(null);
server?.stdin.end();

const videos = new Map<Page, string>();
for (const p of born.keys()) {
  if (!p.isClosed()) await p.close();
  videos.set(p, await p.video()!.path());
}
await ctx.close();

// ================= assembly =================
const dur = (s: Seg) => (s.b - s.a) / 1000;
const ff = (args: string[]) => {
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
};
const probe = (f: string) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout);

const badgePage = await browser.newPage({ viewport: { width: W, height: H } });
const badges = new Map<string, string>();
async function badge(x: number) {
  const key = x >= 9.95 ? x.toFixed(0) : x.toFixed(1);
  if (!badges.has(key)) {
    await badgePage.setContent(`<body style="margin:0;background:transparent"><div style="position:fixed;top:20px;right:20px;padding:8px 14px;border-radius:4px;background:rgba(8,9,13,.88);color:#8dffb0;box-shadow:inset 0 0 0 1px #8dffb0;font:600 16px/20px ui-monospace,Menlo,monospace">▶▶ ${key}× · waiting for blocks</div></body>`);
    const p = resolve(WORK, `badge-${key}.png`);
    await badgePage.screenshot({ path: p, omitBackground: true });
    badges.set(key, p);
  }
  return badges.get(key)!;
}

const list: string[] = [];
const placed: { at: number; clip: Clip; note: string }[] = [];
let t = 0;
for (const [i, s] of segs.entries()) {
  const len = dur(s);
  const need = needOf(s.clips);
  let x = 1;
  if (s.kind === "fast") x = need ? Math.min(MAX_SPEED, Math.max(1, len / need)) : MAX_SPEED;
  const pad = Math.max(0, need - len / x);
  if (len / x + pad < 0.12) continue;
  const from = (s.a - born.get(s.page)!) / 1000;
  const out = resolve(WORK, "seg", `${String(i).padStart(4, "0")}.mp4`);
  const showBadge = s.kind === "fast" && x > 1.2;
  let base = `[0:v]trim=start=${from.toFixed(3)}:duration=${len.toFixed(3)},setpts=(PTS-STARTPTS)/${x.toFixed(4)},fps=30,scale=${W}:${H}`;
  if (pad > 0.02) base += `,tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`;
  base += ",format=yuv420p";
  const filter = showBadge ? `${base}[b];[b][1:v]overlay=0:0[v]` : `${base}[v]`;
  ff(["-i", videos.get(s.page)!, ...(showBadge ? ["-i", await badge(x)] : []), "-filter_complex", filter, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", "30", out]);
  let at = t + LEAD;
  for (const c of s.clips) {
    placed.push({ at, clip: c, note: s.note });
    at += c.dur + GAP;
  }
  t += probe(out);
  list.push(`file '${out}'`);
}
await browser.close();
writeFileSync(resolve(WORK, "list.txt"), list.join("\n") + "\n");
const silent = resolve(WORK, "silent.mp4");
ff(["-f", "concat", "-safe", "0", "-i", resolve(WORK, "list.txt"), "-c", "copy", silent]);
const total = probe(silent);

// The narration track: every line at its place.
const mix = new Float32Array(Math.ceil((total + 1) * RATE));
for (const p of placed) {
  const w = readWav(p.clip.file);
  if (w.rate !== RATE) throw new Error(`${p.clip.file}: ${w.rate} Hz, expected ${RATE}`);
  const o = Math.round(p.at * RATE);
  for (let j = 0; j < w.samples.length && o + j < mix.length; j++) mix[o + j] += w.samples[j];
}
const pcm = Buffer.alloc(44 + mix.length * 2);
pcm.write("RIFF", 0, "ascii");
pcm.writeUInt32LE(36 + mix.length * 2, 4);
pcm.write("WAVEfmt ", 8, "ascii");
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(RATE, 24);
pcm.writeUInt32LE(RATE * 2, 28);
pcm.writeUInt16LE(2, 32);
pcm.writeUInt16LE(16, 34);
pcm.write("data", 36, "ascii");
pcm.writeUInt32LE(mix.length * 2, 40);
for (let j = 0; j < mix.length; j++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mix[j]))), 44 + j * 2);
const voice = resolve(WORK, "voice.wav");
writeFileSync(voice, pcm);
ff(["-i", silent, "-i", voice, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", total.toFixed(3), "-movflags", "+faststart", OUT]);

// The transcript, timed to this film.
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const md = [
  "# Voiceover: `verbatim-tour.mp4`",
  "",
  `The narration is in the film. This is its transcript, written by \`contracts/scripts/e2e/site-tour.ts\`, with each line's start time in the final cut (${mmss(total)} long). The voice is ${server ? `Kokoro (${VOICE})` : "macOS say"}, synthesised locally.`,
  "",
  `The run that made it passed ${results.filter((r) => r.ok).length} of ${results.length} checks and opened ${shown} transactions on an explorer. Waiting for blocks is sped up, with a badge saying by how much; nothing a line is spoken over is cut short.`,
  "",
  "| Time | On screen | Voiceover |",
  "|---|---|---|",
  ...placed.map((p) => `| ${mmss(p.at)} | ${p.note.replace(/\|/g, "\\|")} | ${p.clip.text.replace(/\|/g, "\\|")} |`),
  "",
  "**What runs where.** Everything run live in the film is on Sepolia, through ERC-4337. The frame transactions (EIP-8141, ERC-8421) are the proof ledger's records from the EF frames devnet: they are opened on the alt-mempool explorer and their receipts are read live from the devnet node, but they are not sent again during the film.",
  "",
  "**Decoded panels.** Blockscout does not have the account's source, and the alt-mempool explorer does not show receipts, so the dark panels with a green border are added by the recording: decoded with the account's ABI, or read with `eth_getTransactionReceipt`. Each panel says so in its header.",
  "",
].join("\n");
writeFileSync(TRANSCRIPT, md);
writeFileSync(resolve(WORK, "timeline.json"), JSON.stringify(segs.map((s) => ({ kind: s.kind, note: s.note, seconds: +dur(s).toFixed(2), lines: s.clips.length })), null, 1));
console.log(`saved ${OUT}: ${mmss(total)}, ${placed.length} lines, ${shown} transactions on an explorer`);

const bad = results.filter((r) => !r.ok);
console.log(`${results.length - bad.length}/${results.length} checks passed`);
for (const f of bad) console.log("FAILED", f.what, f.note);
process.exit(bad.length ? 1 : 0);
