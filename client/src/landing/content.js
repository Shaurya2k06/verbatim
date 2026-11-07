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
    log: "frontend → calls, VTREE T, VSPEC S",
    to: "/uniswap",
    more: "See both routes",
  },
  {
    icon: "device",
    step: "You read it and sign",
    body: "The sentence travels as VTREE bytes and its guarantees as VSPEC. An offline device decodes them itself, shows the guarantees first, and signs their hashes, not the calldata. It needs no internet, registry or metadata.",
    log: "QR → device → sign(hash VTREE, hash VSPEC, expiry)",
    to: "/demo#lifecycle",
    more: "Watch the device sign",
  },
  {
    icon: "gate",
    step: "The chain renders it again",
    body: "During validation, a VERIFY frame renders the VTREE again from the real calldata. If it differs from what you signed, the transaction never enters the mempool.",
    log: "render(calldata) ≠ T  →  SpecHashMismatch",
    to: "/demo#lifecycle",
    more: "Follow one swap",
  },
  {
    icon: "check",
    step: "Execution keeps the promise",
    body: "The calls run, then the account asserts every VSPEC guarantee. If a balance is off or an approval is left standing, everything is undone.",
    log: "assert(VSPEC) fails  →  batch reverted",
    to: "/demo#cases",
    more: "Break a promise",
  },
];

/** Everything Verbatim ships, one card each. Sourced from the README, contracts/docs (VTREE, VSPEC, ALTMEMPOOL, GAS) and STATUS.md. */
export const FEATURES = [
  {
    icon: "device",
    title: "Offline signer",
    body: "One HTML file, or an Android app with no internet permission. It reads the request from a rotating QR, decodes the sentence itself and shows the guarantees first.",
    tags: ["airplane mode", "QR in, QR out", "refuses long expiries", "refuses unknown nodes"],
    to: "/demo#lifecycle",
    more: "Watch it sign",
  },
  {
    icon: "doc",
    title: "VTREE: the sentence",
    body: "The canonical bytes of what you read: a header, then each call with its fields, risks and guarantees. Owners sign its hash, never raw calldata.",
    tags: ["amounts never rounded", "17 risk codes", "BLIND for anything unexplained"],
  },
  {
    icon: "gate",
    title: "Rendered again on chain",
    body: "During validation, a VERIFY frame renders the sentence from the real calldata and rebuilds the owners’ digest. Different words, and the mempool never admits it.",
    tags: ["TreeMismatch", "SpecHashMismatch", "no ecrecover"],
  },
  {
    icon: "check",
    title: "VSPEC: promises checked after",
    body: "Guarantees derived from the sentence and asserted after the calls, inside the account. One fails, and the whole batch reverts.",
    tags: ["exact balance changes", "minimum receipts", "allowance ceilings", "NFT owners", "code hashes", "no standing approvals"],
  },
  {
    icon: "clock",
    title: "Expiry and replay",
    body: "Every transaction opens with a mandatory expiry frame, with a gas floor so it cannot be starved. Each signed digest executes at most once.",
    tags: ["device TTL cap", "TtlTooLong at execution", "consumed digest"],
  },
  {
    icon: "layers",
    title: "Attested trust snapshot",
    body: "One Merkle tree, signed by a k-of-n attestor set, pins every descriptor to a code hash. A missing name is proven absent, so the address shows as hex.",
    tags: ["non-membership proofs", "token risk flags", "6-hour TTL", "revocation at execution"],
  },
  {
    icon: "tag",
    title: "ENS as the trust root",
    body: "ENSv2 answers who you are paying, who published each descriptor, who may attest and what is revoked, and each answer is checked again at execution.",
    tags: ["exclusivity proof", "forward and reverse resolution", "lookalikes as hex"],
    to: "/ens",
    more: "Check any name",
  },
  {
    icon: "warning",
    title: "Uniswap v4, rendered on chain",
    body: "URRender decodes Universal Router commands and v4 actions inside validation, and reads what a hook may do from the low bits of its address.",
    tags: ["hook can take your output", "allow-revert flag", "unknown commands refused", "standalone package"],
    to: "/uniswap",
    more: "Tamper with a swap",
  },
  {
    icon: "rails",
    title: "Two frame paths, one fallback",
    body: "Stateless frames need no stake and run in any frame mempool. A staked paymaster serves the ERC-8421 alt mempool. Without frames, the same logic runs behind ERC-4337.",
    tags: ["EIP-8141", "ERC-8421", "under the 100k cap", "ERC-4337 on Sepolia"],
  },
  {
    icon: "vault",
    title: "An account with no back door",
    body: "No DELEGATECALL, checked on the bytecode, no upgrade path and no 7702. Owners change only through a rendered trust-change sentence.",
    tags: ["fee charged first", "reentrancy lock", "bounded gas and return data"],
  },
  {
    icon: "scan",
    title: "ERC-7730 descriptors",
    body: "The compiler ingests the public clear-signing registry: 1,898 of its 3,035 functions compile across 65 protocols, and every failure is listed with its reason.",
    tags: ["code-pinned", "attested", "per-call hash, no global epoch"],
  },
  {
    icon: "bundle",
    title: "A TypeScript toolkit",
    body: "The off-chain twin of every on-chain piece, fuzzed against the Solidity renderer byte for byte, 10,000 cases per CI run.",
    tags: ["displayvm-ts", "urrender", "vdesc-compiler", "snapshot-cli", "signer", "frames-sdk", "WalletConnect"],
  },
];

/**
 * The two frame paths, measured on the final build on the EF frames devnet (contracts/docs/GAS.md, ALTMEMPOOL.md, PROOFS.md).
 * Gas is per frame, for a transfer and for a v4 swap (ETH in, real Universal Router). Signatures are protocol-checked explicit-digest
 * entries at 2,800 gas each, and they count toward the 100,000 cap.
 */
export const FRAME_CAP = 100_000;
export const FRAME_PATHS = [
  {
    name: "Stateless",
    where: "any frame mempool · no stake",
    frames: [
      { mode: "VERIFY", target: "expiry verifier", does: "reverts once the signed expiry has passed" },
      { mode: "VERIFY", target: "account", does: "checks the Merkle proofs, renders the calls, checks owners and attestors, applies policy. APPROVE: execution and payment" },
      { mode: "SENDER", target: "account", does: "executeVerified: runs the calls, then asserts the guarantees" },
    ],
    sigs: "2 owners + 2 attestors",
    gas: {
      transfer: [["expiry", 3051], ["account", 76234], ["signatures", 11200]],
      swap: [["expiry", 3051], ["account", 82291], ["signatures", 11200]],
    },
    facts: [
      ["Trust arrives", "inside the transaction: 732 proof bytes for a transfer, plus attestor signatures"],
      ["Size", "2,711 bytes for a transfer, about 1 KB more than the paymaster path"],
      ["Snapshot rotated", "0 of 50 pending transactions invalidated"],
      ["Limit", "hook routes do not fit the account frame’s 85,300 gas"],
    ],
  },
  {
    name: "Paymaster",
    where: "ERC-8421 alt mempool · staked renderer",
    frames: [
      { mode: "VERIFY", target: "expiry verifier", does: "reverts once the signed expiry has passed" },
      { mode: "VERIFY", target: "account", does: "locks the layout, checks the owners, refuses a replayed digest. APPROVE: execution" },
      { mode: "VERIFY", target: "RendererPaymaster", does: "renders from its own cache, rebuilds the owners’ digest, takes this nonce’s fee ticket. APPROVE: payment" },
      { mode: "SENDER", target: "account", does: "executeVerified: charges the fee first, runs the calls, then asserts the guarantees" },
    ],
    sigs: "2 owners",
    gas: {
      transfer: [["expiry", 3051], ["account", 16285], ["paymaster", 60493], ["signatures", 5600]],
      swap: [["expiry", 3051], ["account", 16719], ["paymaster", 65218], ["signatures", 5600]],
    },
    facts: [
      ["Trust arrives", "from the paymaster’s cache. The canonical rules refuse that read (StorageReadNonSender); ERC-8421 admits it for a staked entity"],
      ["Size", "1,571 bytes for a transfer"],
      ["Snapshot rotated", "50 of 50 pending transactions invalidated, because each signed the cached root"],
      ["Limit", "ERC-8421 only, and the paymaster must stay staked"],
    ],
  },
];

export const TRY = [
  { to: "/demo", title: "Run the live demo", body: "No wallet or keys needed. Follow one swap from the click to the block, or run the whole demo in order." },
  { to: "/uniswap", title: "Tamper with a swap", body: "The same swap twice on Uniswap's contracts: an ordinary wallet and Verbatim. Follow one swap from the click to the block." },
  { to: "/ens", title: "Check an ENS name", body: "Run the exclusivity proof on any name, and see a lookalike refused." },
  { to: "/demo#proofs", title: "Run every proof", body: "Every claim with its evidence, and a Run button wherever the server can send it again." },
];

export const EXPLORE = [
  ["/demo", "Live demo", "End-to-end workflows on Sepolia", "scan"],
  ["/uniswap", "Uniswap", "Every Uniswap test and demo, in one place", "build"],
  ["/ens", "ENS", "Run the exclusivity proof on any name", "tag"],
  ["/proofs", "History", "Every run on record", "check"],
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
