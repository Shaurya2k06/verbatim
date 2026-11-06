# Voiceover: the landing page

Read this over your own recording of the landing page, then cut to `verbatim-tour.mp4`. That film opens on the proof ledger with "Here is the proof ledger…", so it follows straight on from section 10.

Read at a natural pace, the narration runs about 5:20 in total.

**Pronunciation:**
- EIP-8141: "eighty-one forty-one".
- ERC-8421: "eighty-four twenty-one".
- ERC-4337: "forty-three thirty-seven".
- `displayvm-ts`: "display V M, T S".
- `URRender`: "U R Render".
- VTREE: "V tree". VSPEC: "V spec".
- `verbatim-demo.eth`: "verbatim demo dot eth".

---

## 1. Hero (about 28 s)

**On screen:** "The chain is your wallet's screen." For the second paragraph, point at the device mock on the right.

> This is Verbatim. In February 2025, Bybit's signers approved what a tampered Safe frontend showed them, and one and a half billion dollars left. Verbatim makes Ethereum's new frame transactions rebuild every transaction into the sentence you signed, inside the validation frame. Different words, and the alt mempool never admits it. A broken promise, and the whole batch reverts.

> On the right is what an owner actually reads and signs: a sentence, not calldata, with its guarantees listed first.

## 2. The problem: "$1.5B left because a screen lied" (about 19 s)

**On screen:** the comparison table, "Clear signing today" against "Verbatim".

> Clear signing today turns calldata into readable text, but only inside the wallet. Nothing on chain checks that text against the calldata, and nothing enforces what it promised, so a tampered transaction can still land. Verbatim does both on chain: validation checks the text, and execution enforces it.

## 3. How it works: "One transaction, start to finish" (about 45 s)

**On screen:** the four steps. Hover each card as you read it.

> **01.** Step one. A frontend builds the calls, the sentence as VTREE bytes, and its guarantees as VSPEC. It may be tampered with, and so may the host, the RPC and the relayer. Verbatim trusts none of them.

> **02.** Step two. An offline device decodes the VTREE itself, shows the VSPEC guarantees first, and signs the hashes of both, with an expiry. It never signs raw calldata.

> **03.** Step three. During validation, a VERIFY frame renders the VTREE again from the real calldata. If it differs from what was signed, the transaction never enters the mempool.

> **04.** Step four. The calls run, then the account asserts every promise in the VSPEC. If a balance is off, or an approval is left standing, the whole batch is undone.

## 4. Architecture: "Where the words are checked" (about 2:45)

**On screen:** the diagram. Click each box in this order, so its detail panel shows below the diagram.

| Click | Voiceover |
|---|---|
| *(none yet)* | Here's the architecture, in the order a transaction meets it. Everything left of the device is untrusted. |
| **Frontend** | The frontend, with the host, the RPC and the relayer. Anything they change shows up as different words. |
| **displayvm-ts** | Two formats carry every transaction. VTREE is the sentence as canonical bytes, and VSPEC is what must be true after the batch. Owners sign the hash of each. displayvm-ts is our TypeScript twin of the on-chain renderer that writes them. It's ours, and still untrusted: if it disagrees with the chain, the transaction fails closed. Ten thousand random cases per CI run compare the two, byte for byte. |
| **Offline signer** | The offline signer is one HTML file, or an Android app with no internet permission. It reads the request from a rotating QR code, shows the guarantees first, and signs the owner digest: the hashes of the VTREE and VSPEC, the expiry, the snapshot root, the path, and a commitment to the transaction. The signature goes back by QR. On a frame transaction it's an explicit-digest signature, so the protocol checks every signature before any frame runs. |
| **Paymaster** | Three paths carry it, and the first two are EIP-8141 frame transactions. The main one is the paymaster path: an expiry frame, a VERIFY frame for the account, a VERIFY frame for a staked paymaster, and the SENDER frame that executes. The paymaster renders from its own cache and rebuilds the owner digest. The canonical rules refuse this storage read. ERC-8421 admits it because the renderer is staked. That's what the alt mempool is for. |
| **Stateless** | The stateless path drops the paymaster: an expiry frame, a VERIFY frame for the account, and the SENDER frame. The account renders from Merkle proofs carried inside the transaction, against a snapshot the attestors signed. No stake, and no global state. That makes it valid in any frame mempool. |
| **ERC-4337** | And for chains without frames, the same logic behind any ERC-4337 bundler, also live on Sepolia. |
| **Trust** | Trust decides which contracts, tokens and names may be rendered. The attestor quorum and the ENS publisher would both have to collude to lie, and the ENS exclusivity proof is read again at execution. |
| **Render on chain** | Render on chain. DisplayVM runs the descriptors, URRender decodes the Universal Router and v4 actions, and hook risk is read from the low bits of the hook's address. The VTREE it writes must hash to what the owners signed. |
| **Refused** | If the words differ, the spec is weaker, the contract is unattested, or the policy refuses a risk, validation fails. Nobody pays, and nothing is broadcast. |
| **VerbatimAccount** | Once admitted, VerbatimAccount works in an inner self-call: the expiry, revocations, live re-checks, the calls, then every assertion in the VSPEC. There's no DELEGATECALL in it, which is checked on the bytecode. |
| **Lands** | If every promise holds, it lands: checked once on the words, and once on the effects. |
| **Batch reverts** | If an assertion fails, everything the calls did is undone. The fee stays paid, and the signed digest can't be replayed. |

## 5. "Same route. Two wallets." (about 21 s)

**On screen:** the "99% gone" card beside the "Nothing moved" card, then the line about Uniswap's real interface under them.

> Here's the difference, recorded on Sepolia. The same 0.001 ETH swap on Uniswap's official contracts, through a pool whose hook skims the output. The ordinary wallet lost nearly all of it. With Verbatim, the VTREE, the sentence the chain rebuilds from the calldata, carried three risk lines read from the hook's address. The account answered PolicyRefused, and nothing moved. Had the screen hidden a warning, the rebuilt VTREE wouldn't match, and the VSPEC would still hold the output to the signed minimum after the calls. We also compromised Uniswap's real interface: it quoted 26 USDC, and the ordinary wallet got 0.026.

## 6. "Stop trusting the screen" (about 15 s)

**On screen:** scroll slowly through the six benefit cards.

> So risk arrives in plain words, read from the hook's address on chain. Every transaction carries a mandatory expiry. A name has to earn its place with a live exclusivity proof. And it all fits the rails you already have.

## 7. "Two ways to fit under 100,000 gas" (about 55 s)

**On screen:** the heading, then the Stateless card and the Paymaster card. Point at each frame as you name it, then at the gas bars.

> An EIP-8141 transaction is a list of frames. VERIFY frames validate and must end in APPROVE; the SENDER frame executes. The owners sign an explicit digest, so the protocol checks every signature before any frame runs, at twenty-eight hundred gas each, and that counts toward the cap: a prefix at exactly a hundred thousand was admitted, one gas more was refused.

**Stateless card:**

> The stateless path is three frames. Frame zero is the expiry check. Frame one is the account's VERIFY frame, and it does all the work: it checks Merkle proofs carried inside the transaction, renders the calls, checks the owners and the attestors, and approves both execution and payment. Frame two executes. That's ninety thousand gas for a transfer and ninety-six and a half for a v4 swap. Most of it is the account frame, plus eleven thousand for four signatures.

**Paymaster card:**

> The paymaster path splits the work across four frames. The account's VERIFY frame only locks the layout and checks the owners, in about sixteen thousand gas. A staked paymaster renders in its own VERIFY frame, from its own cache, rebuilds the owners' digest and takes a fee ticket, in about sixty thousand. With only two signatures, a transfer costs eighty-five thousand four hundred.

**The trade-off (the facts under each card):**

> The trade-off is where trust lives. The stateless path carries its snapshot inside the transaction, so it needs no stake and runs in any frame mempool: rotating the snapshot invalidated none of fifty pending transactions. The paymaster reads its own storage, which the canonical rules refuse and ERC-8421 admits because it's staked. The same rotation invalidated all fifty, because each one signed the cached root. The wallet picks the stateless path when it fits with ten thousand gas to spare, and the paymaster path otherwise.

## 8. Proof: "Don't take this page's word for it" (about 10 s)

**On screen:** the four stat tiles.

> And don't take the page's word for it. These counts are read from the proof ledger, and every row links to its transaction, or to the named revert that stopped it.

## 9. Limits (about 9 s)

**On screen:** the "Covered" and "Not covered" lists.

> The limits are stated too. Stolen keys are out of scope, and so is an accurate sentence that's misunderstood.

## 10. Try it, FAQ, finale (about 3 s, no voiceover)

**On screen:** scroll quickly to the end of the page.
