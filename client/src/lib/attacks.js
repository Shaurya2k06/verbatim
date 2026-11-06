// The attack kit. Each attack names the layer that must stop it and the error it expects; `live` builds it on Sepolia where it
// can run there. The rest point at their recorded proof, with the reason they cannot run live from this page.
import { encodeFunctionData, parseAbi } from "viem";
import { CMD, executeData, v4ExactInSingleInput } from "@verbatim/urrender";
import { swapCall, transferCall } from "./userop";

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);
const ONE_USDC = 1_000_000n;
const SWAP_IN = 1_000_000_000_000_000n; // 0.001 ETH

const DEVNET = "Runs on the frames devnet's paymaster path, which is not producing blocks.";
const FOUNDRY = "Proven in the Foundry suite; no live case yet.";
const GOVERNANCE = "Needs the ENS governance key to change a record mid-flight, so it is not run from a public page.";

export const ATTACKS = [
  // Sentence lies
  { id: "A1", proof: "B-A1", group: "sentence", title: "Swap the recipient", plain: "The frontend swaps the recipient after you approved.", layer: "validation", expect: "TreeMismatch",
    live: (x) => ({ calls: [transferCall(x.dep.tokens.dUSDC, x.attacker, ONE_USDC)], lie: { calls: [transferCall(x.dep.tokens.dUSDC, x.dep.ens.recipient, ONE_USDC)] } }) },
  { id: "A2", proof: "A2", group: "sentence", title: "SkimHook, minimum output 0", plain: "The page shows an honest swap; the calldata routes through a hook that takes your output.", layer: "validation", expect: "TreeMismatch",
    live: (x) => ({ calls: [swapCall(x.dep, x.dep.pools.ethEvil.key, SWAP_IN, 0n)], lie: { calls: [swapCall(x.dep, x.dep.pools.eth.key, SWAP_IN, x.minOut)] } }) },
  { id: "A2b", proof: "B-A2b", group: "sentence", title: "SkimHook, and the device tells the truth", plain: "The same route, signed on its true sentence: three risk lines on the device.", layer: "validation", expect: "PolicyRefused",
    live: (x) => ({ calls: [swapCall(x.dep, x.dep.pools.ethEvil.key, SWAP_IN, 0n)] }) },
  { id: "A3", proof: "A3", group: "sentence", title: "Drop the renderer frame", plain: "The host removes the frame that re-renders the sentence.", layer: "validation", expect: "BadLayout", why: DEVNET },
  { id: "A3b", proof: "A3b", group: "sentence", title: "Swap in a permissive paymaster", plain: "The host substitutes a paymaster that renders nothing.", layer: "validation", expect: "BadLayout", why: DEVNET },
  { id: "A4", proof: "A4", group: "sentence", title: "A weaker spec", plain: "The sentence is honest, but the assertions sent with it are emptied.", layer: "validation", expect: "SignersNotSortedOrUnknown: the signatures cover the honest spec, not this one",
    live: (x) => ({ calls: [transferCall(x.dep.tokens.dUSDC, x.dep.ens.recipient, ONE_USDC)], weakenSpec: true }) },
  { id: "A16", proof: "A16", group: "sentence", title: "Allow-revert router command", plain: "A swap command flagged so it may fail silently while the rest runs.", layer: "validation", expect: "PolicyRefused",
    live: (x) => ({ calls: [{ target: x.dep.uniswap.router, value: SWAP_IN, data: executeData([CMD.V4_SWAP | CMD.FLAG_ALLOW_REVERT], [v4ExactInSingleInput({ key: x.dep.pools.eth.key, zeroForOne: true, amountIn: SWAP_IN, amountOutMinimum: x.minOut, legacyParams: true })], deadline()) }] }) },
  { id: "A17", proof: "A17", group: "sentence", title: "Unknown router command", plain: "A router command no descriptor explains (a gasless permit).", layer: "validation", expect: "PolicyRefused",
    live: (x) => ({ calls: [{ target: x.dep.uniswap.router, value: 0n, data: executeData([0x0a], ["0x1234"], deadline()) }] }) },

  // Trust lies
  { id: "A5", proof: "A5", group: "trust", title: "Unattested contract", plain: "The page calls a contract nobody attested, with a descriptor it made up.", layer: "validation", expect: "PolicyRefused",
    live: (x) => ({ calls: [{ target: x.dep.skimHook, value: 0n, data: "0xdeadbeef" }] }) },
  { id: "A8", proof: "A8", group: "trust", title: "Lookalike ENS name", plain: "verbatim-dem0.eth, one character off, keeps its root roles.", layer: "device", expect: "shown as hex; WrongResolverCode", link: ["/ens#names", "Run the lookalike check live"] },
  { id: "B13", proof: "B13", group: "trust", title: "Attestor no longer listed", plain: "Governance drops an attestor while an operation is on its way.", layer: "execution", expect: "AttestorNotListed", why: GOVERNANCE },
  { id: "B-ens-revoked", proof: "B-ens-revoked", group: "trust", title: "Leaf revoked in ENS", plain: "A descriptor is revoked by ENS record while the operation is pending.", layer: "execution", expect: "LeafRevokedInEns", why: GOVERNANCE },
  { id: "B3", proof: "B3", group: "trust", title: "Cross-chain snapshot", plain: "A snapshot signed for another chain.", layer: "validation", expect: "signature mismatch", why: FOUNDRY },
  { id: "B5", proof: "B5", group: "trust", title: "Leaf-type confusion", plain: "A proof for one leaf type presented as another.", layer: "validation", expect: "proof failure", why: FOUNDRY },
  { id: "B7", proof: "B7", group: "trust", title: "Missing token risk leaf", plain: "A token's risk flags left out of the proofs.", layer: "validation", expect: "non-membership proof required", why: FOUNDRY },
  { id: "B9", proof: "B9", group: "trust", title: "Far-future snapshot", plain: "A snapshot that claims to stay valid for a year.", layer: "validation", expect: "SnapshotTtlTooLong", why: FOUNDRY },

  // Freshness and replay
  { id: "A7", proof: "A7", group: "freshness", title: "Stale signature", plain: "The host holds a signature and sends it after it expired.", layer: "validation", expect: "Expired",
    live: (x) => ({ calls: [transferCall(x.dep.tokens.dUSDC, x.dep.ens.recipient, ONE_USDC)], validity: 45, holdUntilExpired: true }) },
  { id: "A7b", proof: "A7b", group: "freshness", title: "Starved expiry frame", plain: "The expiry frame gets too little gas to run.", layer: "validation", expect: "BadLayout", why: DEVNET },
  { id: "A13", proof: "A13", group: "freshness", title: "Future-dated expiry", plain: "A signature that stays valid for hours: durable authority.", layer: "device", expect: "the device refuses; TtlTooLong if signed anyway",
    live: (x) => ({ calls: [transferCall(x.dep.tokens.dUSDC, x.dep.ens.recipient, ONE_USDC)], validity: 6 * 3600 }) },
  { id: "B12", proof: "B12", group: "freshness", title: "Replay", plain: "The same signed operation sent twice.", layer: "validation", expect: "Replayed", why: DEVNET },

  // Effects
  { id: "A6", proof: "A6", group: "effects", title: "EvilVault", plain: "A vault describes a deposit truthfully, then keeps the ETH.", layer: "execution", expect: "AssertionFailed", why: DEVNET },
  { id: "A11", proof: "A11", group: "effects", title: "Reentrancy", plain: "A call re-enters the account mid-batch.", layer: "execution", expect: "CallFailed", why: DEVNET },
  { id: "A12", proof: "A12", group: "effects", title: "Gas burn", plain: "A call burns all its gas to starve the assertions.", layer: "execution", expect: "CallFailed (reserve holds)", why: DEVNET },
  { id: "A18", proof: "A18", group: "effects", title: "Return bomb", plain: "A call reverts with 500 KB of data.", layer: "execution", expect: "batch reverts", why: DEVNET },
  { id: "B14", proof: "B14", group: "effects", title: "Approval left standing", plain: "An approval that would outlive the transaction.", layer: "execution", expect: "AssertionFailed (APPROVALS_CLEARED)",
    // A Permit2 allowance that would outlive the batch. (An ERC-20 approve to Permit2 itself is a base allowance the ledger records by design.)
    live: (x) => ({ calls: [{ target: x.dep.uniswap.permit2, value: 0n, data: encodeFunctionData({ abi: parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]), functionName: "approve", args: [x.dep.tokens.dUSDC, x.dep.uniswap.router, ONE_USDC, Math.floor(Date.now() / 1000) + 3600] }) }] }) },

  // Fees and griefing
  { id: "A9", proof: "A9", group: "fees", title: "No fee ticket", plain: "No fee is prepaid for this nonce on the paymaster path.", layer: "validation", expect: "NoTicket", why: DEVNET },
  { id: "A14", proof: "A14", group: "fees", title: "Two transactions, one ticket", plain: "Two transactions try to spend one prepaid fee.", layer: "validation", expect: "NoTicket", why: DEVNET },
  { id: "F7", proof: "F7", group: "fees", title: "Fee failure runs nothing", plain: "If the fee cannot be paid, no protected call runs.", layer: "execution", expect: "nothing runs", why: DEVNET },
];

export const ATTACK_GROUPS = [
  ["sentence", "Sentence lies"],
  ["trust", "Trust lies"],
  ["freshness", "Freshness and replay"],
  ["effects", "Effects"],
  ["fees", "Fees and griefing"],
];

export const LAYER = { validation: "Rejected in validation: never reaches the mempool", execution: "Mined, batch reverted: nothing moves, the fee is paid", device: "Refused or exposed on the device" };
