// The landing page's words. Everything here is sourced from the README, contracts/docs/STATUS.md and contracts/docs/GAS.md.
// Numbers that can change with a proof run are not written here: the page reads them from /data at runtime.

export const TAGLINE = [
  ["Change", "one", "word", "and", "it", "never", "reaches", "the", "mempool."],
  ["Break", "one", "promise", "and", "the", "whole", "batch", "reverts."],
];

/** What the chain answers. Names are the contracts' own errors. */
export const REFUSALS = [
  ["swap the recipient", "TreeMismatch"],
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
    to: "/demo",
    more: "See both routes",
  },
  {
    icon: "device",
    step: "You read it and sign",
    body: "An offline device decodes the sentence itself, shows the guarantees first, and signs its hash, not the calldata. It needs no internet, registry or metadata.",
    log: "QR → device → sign(hash T, hash S, expiry)",
    to: "/wallet",
    more: "Open the wallet",
  },
  {
    icon: "gate",
    step: "The chain renders it again",
    body: "During validation, a contract rebuilds the sentence from the real calldata. If it differs from what you signed, the transaction is refused before it enters the mempool.",
    log: "render(calldata) ≠ T  →  TreeMismatch",
    to: "/mempool",
    more: "Compare the paths",
  },
  {
    icon: "check",
    step: "Execution keeps the promise",
    body: "The calls run, then the account asserts what the sentence guaranteed. If a balance is off or an approval is left standing, everything is undone.",
    log: "assert(S) fails  →  batch reverted",
    to: "/sentences",
    more: "Explore sentences",
  },
];

export const LAYERS = ["device", "validation", "execution"];

/** Each scene names the proof row that backs it; the page shows that row's real result and evidence. */
export const SCENES = [
  {
    id: "B-A1",
    name: "Recipient swap",
    plain: "The page swaps the recipient after you approved.",
    stop: "validation",
    lines: [
      ["page", "changes the recipient in the calldata"],
      ["owners", "sign the honest sentence"],
      ["chain", "renders the real calldata again"],
      ["chain", "the two sentences differ"],
    ],
    answer: "TreeMismatch",
    result: "Refused in validation. It never reaches the mempool.",
  },
  {
    id: "B-A2b",
    name: "Skim hook",
    plain: "A swap routed through a hook that takes your output.",
    stop: "validation",
    lines: [
      ["page", "routes through SkimHook, minimum 0"],
      ["device", "shows three risk lines before you sign"],
      ["owners", "sign the true sentence anyway"],
      ["account", "policy reads the risk lines"],
    ],
    answer: "PolicyRefused",
    result: "Refused in validation, even when the sentence is true.",
  },
  {
    id: "A7",
    name: "Stale signature",
    plain: "The host holds your signature and sends it after it expired.",
    stop: "validation",
    lines: [
      ["host", "waits out the expiry"],
      ["host", "broadcasts the signed transaction"],
      ["frame 0", "the expiry verifier reads the time"],
    ],
    answer: "validation frame 0: reverted",
    result: "Refused in validation. Expiry is mandatory.",
  },
  {
    id: "A8",
    name: "Lookalike name",
    plain: "verbatim-dem0.eth, one character off, keeps its root roles.",
    stop: "device",
    lines: [
      ["page", "offers verbatim-dem0.eth as the recipient"],
      ["snapshot", "no attested entry for that name"],
      ["device", "shows raw hex instead of a name"],
      ["chain", "the exclusivity proof fails"],
    ],
    answer: "WrongResolverCode",
    result: "Exposed on the device, and refused by the proof.",
  },
  {
    id: "B14",
    name: "Standing approval",
    plain: "An approval that would outlive the transaction.",
    stop: "execution",
    lines: [
      ["calls", "permit2.approve runs inside the batch"],
      ["account", "asserts that no approval survives"],
    ],
    answer: "AssertionFailed: APPROVALS_CLEARED",
    result: "Mined, batch reverted. Nothing moves, the fee is paid.",
  },
  {
    id: "A12",
    name: "Gas burn",
    plain: "A call burns all its gas to starve the assertions.",
    stop: "execution",
    lines: [
      ["calls", "the target burns all the gas it gets"],
      ["account", "the assertion reserve holds"],
    ],
    answer: "CallFailed",
    result: "Mined, batch reverted. The frame survives.",
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
    to: "/xray",
    more: "X-ray a hook",
  },
  {
    say: "the contract said one thing and did another",
    icon: "check",
    title: "Promises are checked after the calls",
    body: "A truthful description is not enough. No tracked holding may drop beyond what you signed, and no approval survives the batch.",
    to: "/sentences",
    more: "Read real sentences",
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
    say: "we have no paymaster and no special mempool",
    icon: "rails",
    title: "It fits the rails you have",
    body: "The same logic runs behind ERC-4337 with any bundler, as well as on EIP-8141 frame transactions. The three paths are below.",
  },
];

export const PATHS = [
  {
    icon: "bundle",
    name: "ERC-4337",
    where: "any bundler, no paymaster",
    body: "Account validation renders the sentence. Honest transfers landed on Sepolia through Pimlico and Alchemy, and a v4 swap through Uniswap’s official router.",
    state: "Live on Sepolia",
    tone: "ok",
  },
  {
    icon: "layers",
    name: "Stateless",
    where: "any mempool, no stake",
    body: "Trust travels inside the transaction as snapshot proofs and attestor signatures, so validation reads no global state.",
    state: "Tested in Foundry, live run pending",
    tone: "warn",
  },
  {
    icon: "vault",
    name: "Paymaster",
    where: "ERC-8421 alternative mempool",
    body: "A staked paymaster renders from its own cache and rebuilds the digest. A transfer fit in 85,245 gas of the 100,000 cap, measured before the devnet stopped.",
    state: "Older build, rerun pending",
    tone: "warn",
  },
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
  { to: "/suites", title: "Run the suites", body: "No wallet or keys needed. Pick a case, and it runs on Sepolia while you watch." },
  { to: "/demo", title: "Tamper with a swap", body: "Choose the route and the amount yourself. Signing the Verbatim side needs two owner keys." },
  { to: "/attack", title: "Run a team session", body: "Others pick attacks from their phones while your team signs on the device." },
  { to: "/wallet", title: "Use the wallet", body: "A working account on Sepolia, for owners. Everything it sends is a sentence they read." },
];

export const EXPLORE = [
  ["/sentences", "Sentences", "Explore what people actually approved", "doc"],
  ["/xray", "Hook X-ray", "Paste a v4 hook, read its powers", "scan"],
  ["/ens", "ENS", "Run the exclusivity proof on any name", "tag"],
  ["/trust", "Trust", "Attestors, snapshots and revocation", "layers"],
  ["/mempool", "Mempool", "Two validation paths, measured", "rails"],
  ["/proofs", "Proofs", "Every claim, with its evidence", "check"],
  ["/standards", "Standards", "ERC drafts and findings", "build"],
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
