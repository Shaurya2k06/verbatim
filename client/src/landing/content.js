// The landing page's words. Everything here is sourced from the README, contracts/docs/STATUS.md and contracts/docs/GAS.md.
// Numbers that can change with a proof run are not written here: the page reads them from /data at runtime.

export const TAGLINE = [
  ["Change", "one", "word", "and", "it", "never", "reaches", "the", "mempool."],
  ["Break", "one", "promise", "and", "the", "whole", "batch", "reverts."],
];

/** What the chain answers. Names are the contracts' own errors. */
export const REFUSALS = [
  ["swap the recipient", "SpecHashMismatch"],
  ["minimum output 0 through a skim hook", "TreeMismatch"],
  ["sign the true skim hook sentence", "PolicyRefused"],
  ["drop the renderer frame", "BadLayout(0)"],
  ["send a weaker spec", "SpecHashMismatch"],
  ["call an unattested contract", "PolicyRefused"],
  ["use a lookalike ENS name", "WrongResolverCode"],
  ["skip the fee ticket", "NoTicket"],
  ["date the expiry far ahead", "TtlTooLong"],
  ["use an unknown router command", "BLIND"],
  ["leave an approval standing", "APPROVALS_CLEARED"],
  ["send the same content twice", "Replayed"],
  ["drop an attestor from ENS", "AttestorNotListed"],
];

export const VERSUS = [
  ["Turns calldata into readable text", "Yes, in the wallet", "Yes, on the device"],
  ["Chain checks that text against the calldata", "No", "Yes, during validation"],
  ["Chain enforces what the text promised", "No", "Yes, during execution"],
  ["A tampered transaction", "Can still land", "Refused or reverted"],
];

export const STEPS = [
  {
    icon: "build",
    step: "The frontend builds it",
    body: "It may be honest. It may be tampered with. Verbatim assumes nothing, and treats the host, the RPC and the relayer the same way.",
    log: "frontend → calls, sentence T, spec S",
    to: "/uniswap",
    more: "See both routes",
  },
  {
    icon: "device",
    step: "You read it and sign",
    body: "An offline device decodes the sentence itself, shows the guarantees first, and signs its hash, not the calldata. It needs no internet, registry or metadata.",
    log: "QR → device → sign(hash T, hash S, expiry)",
    to: "/demo#lifecycle",
    more: "Watch the device sign",
  },
  {
    icon: "gate",
    step: "The chain renders it again",
    body: "During validation, a VERIFY frame renders the sentence again from the real calldata. If it differs from what you signed, the transaction never enters the mempool.",
    log: "render(calldata) ≠ T  →  SpecHashMismatch",
    to: "/demo#lifecycle",
    more: "Follow one swap",
  },
  {
    icon: "check",
    step: "Execution keeps the promise",
    body: "The calls run, then the account asserts what the sentence guaranteed. If a balance is off or an approval is left standing, everything is undone.",
    log: "assert(S) fails  →  batch reverted",
    to: "/demo#cases",
    more: "Break a promise",
  },
];

/** Each benefit opens with the failure it answers. */
export const BENEFITS = [
  {
    say: "the frontend was swapped overnight",
    icon: "screen",
    title: "Your screen stops being trusted",
    body: "Frontend, host, RPC, relayer and target contracts are all untrusted. The signer is one HTML file you can load once and use in airplane mode.",
  },
  {
    say: "this hook can take your output",
    icon: "warning",
    title: "Risk arrives in plain words",
    body: "What a Uniswap v4 hook may do is written in the low bits of its address. Verbatim reads those bits on chain and puts the warning in the sentence you sign.",
  },
  {
    say: "the contract said one thing and did another",
    icon: "check",
    title: "Promises are checked after the calls",
    body: "A truthful description is not enough. No tracked holding may drop beyond what you signed, and no approval survives the batch.",
  },
  {
    say: "that signature is weeks old",
    icon: "clock",
    title: "Signatures go stale on purpose",
    body: "Every transaction carries a mandatory absolute expiry. The device refuses a long one, and the chain reverts it if it gets signed anyway.",
  },
  {
    say: "the name looks right to me",
    icon: "tag",
    title: "A name has to earn its place",
    body: "On Sepolia, an ENS name appears only with an attested snapshot and a live exclusivity proof read at execution. A lookalike shows as hex.",
    to: "/ens",
    more: "Check any name",
  },
  {
    say: "this chain has no frame transactions yet",
    icon: "rails",
    title: "Built for frames, runs today",
    body: "Verbatim is built on EIP-8141 frame transactions and the ERC-8421 alternative mempool. Where a chain has no frames yet, the same logic runs behind any ERC-4337 bundler.",
  },
];

export const PATHS = [
  {
    icon: "vault",
    name: "Paymaster",
    where: "EIP-8141 frames · ERC-8421 alt mempool",
    body: "A staked paymaster renders from its own cache in a VERIFY frame and rebuilds the owners’ digest. The canonical rules refuse that storage read (StorageReadNonSender). ERC-8421 admits it because the renderer is staked: that is what the alt mempool is for. A transfer fit in 85,429 gas of the 100,000 cap.",
    state: "Live on the EF frames devnet",
    tone: "ok",
  },
  {
    icon: "layers",
    name: "Stateless",
    where: "EIP-8141 frames · any frame mempool",
    body: "Trust travels inside the transaction as snapshot proofs and attestor signatures, so validation reads no global state and needs no stake. That makes it valid in any frame mempool.",
    state: "Live on the EF frames devnet",
    tone: "ok",
  },
  {
    icon: "bundle",
    name: "ERC-4337",
    where: "the fallback, for chains without frames",
    body: "The same logic behind any ERC-4337 bundler: account validation renders the sentence. Honest transfers landed on Sepolia through Pimlico and Alchemy, and a v4 swap through Uniswap’s official router.",
    state: "Also live on Sepolia",
    tone: "ok",
  },
];

/** The frames evidence, from contracts/docs/ALTMEMPOOL.md (BENCH-N50, invalidation-bench.json) and FINDINGS.md. */
export const FRAMES_EVIDENCE = [
  ["50 of 50", "pending transactions invalidated by rotating the trust snapshot on the paymaster path"],
  ["0 of 50", "invalidated by the same rotation on the stateless path, which carries its snapshot inside each transaction"],
  ["Explicit digest", "owners sign over an explicit message, so the protocol checks every signature before any frame runs"],
  ["4 rule findings", "for the ERC-8421 author: a flat 100k cap, no precompiles, no WebAuthn scheme, proxied tokens"],
];

export const COVERS = [
  "A person reading a sentence on a device, while the host or frontend tampers with the transaction. The Bybit class.",
  "A contract that describes itself truthfully but has hidden effects on tracked assets.",
  "Swap frontends that lie about the minimum output, route, recipient or hook risk.",
  "Stale presigned transactions, killed by a mandatory absolute expiry.",
];

export const EXCLUDES = [
  "Compromised machine signers and stolen keys. A stolen key signs whatever it likes.",
  "A sentence that is accurate but misunderstood. It is still a signed sentence.",
  "Unattested contracts. They are refused, and there is no effects only mode.",
  "A captured attestor quorum can mislabel spenders, tokens or names. Signed amounts, the rule against standing approvals and revocation at execution still hold.",
  "Protocol internal ledgers. Assertions cover balances, allowances, operators and owners of tracked assets.",
];

export const TRY = [
  { to: "/demo", title: "Run the live demo", body: "No wallet or keys needed. Follow one swap from the click to the block, or run the whole demo in order." },
  { to: "/uniswap", title: "Tamper with a swap", body: "The same swap twice on Uniswap's contracts: an ordinary wallet and Verbatim. Follow one swap from the click to the block." },
  { to: "/ens", title: "Check an ENS name", body: "Run the exclusivity proof on any name, and see a lookalike refused." },
  { to: "/proofs", title: "Read every record", body: "Every claim with its evidence, and every test run on record." },
];

export const EXPLORE = [
  ["/demo", "Live demo", "End-to-end workflows on Sepolia", "scan"],
  ["/uniswap", "Uniswap", "Every Uniswap test and demo, in one place", "build"],
  ["/ens", "ENS", "Run the exclusivity proof on any name", "tag"],
  ["/proofs", "History & proofs", "Every claim, and every run on record", "check"],
];

export const COMMANDS = `pnpm install

# Foundry: invariants and attacks
pnpm test:contracts

# TypeScript packages, golden vectors
pnpm -r --if-present test

# 10,000 cases against a local anvil
cd contracts/scripts/difffuzz && pnpm fuzz`;

export const FAQ = [
  {
    q: "What is Verbatim, in one sentence?",
    a: "A smart account where Ethereum checks that you signed the sentence you read, then checks that the sentence came true.",
  },
  {
    q: "How is this different from clear signing?",
    a: "Clear signing lives in the wallet. Each wallet renders on its own and nothing on chain checks the result. Verbatim builds on the same ERC-7730 descriptors, then makes the chain render the sentence again and enforce what it promised.",
  },
  {
    q: "Would this have stopped the Bybit attack?",
    a: "That is the class it targets: signers approving what a tampered frontend shows them. The device decodes the sentence itself, and a transaction that differs from it is refused in validation. Verbatim has not been tested against that exact transaction.",
  },
  {
    q: "What do I still have to trust?",
    a: "The device’s decoder and screen, the owners’ keys, the attestor quorum and the ENS publisher, and the EVM. Frontend, host, RPC, relayer, target contracts and Verbatim’s own TypeScript are untrusted. A mismatch fails closed.",
  },
  {
    q: "Who signs when I run a suite?",
    a: "The demo server, using two of the testnet account’s three owner keys, because you don’t have any. It signs only the fixed cases it builds itself. Outside this demo nobody’s server signs: the owners read the sentence and sign on an offline device.",
  },
  {
    q: "Who decides what a contract’s sentence says?",
    a: "Descriptors pinned to the contract’s code, signed by attestors in a snapshot. An unknown function, router command or contract renders as blind and gets refused, so nothing unexplained reaches your signature.",
  },
  {
    q: "Do I pay when an attack is stopped?",
    a: "Refused in validation: the transaction never enters the mempool. Reverted in execution: everything is undone, and the gas fee is still paid.",
  },
  {
    q: "What does it need from Ethereum?",
    a: "The full design uses EIP-8141 frame transactions through the ERC-8421 alternative mempool. The same logic also runs today behind ERC-4337, on Sepolia, with any bundler.",
  },
  {
    q: "Can I use it with real money?",
    a: "No. This is hackathon code with no audit, no mainnet deployment and no independent review. On the deployed frames sidecar, one call fits in each transaction, so ERC-20 swaps do not fit yet.",
  },
];
