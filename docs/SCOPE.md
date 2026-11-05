# Scope sheet

**In scope**
- A human signer reading a sentence on a device, approving a transaction whose calldata a frontend or host may have tampered with (the Bybit class).
- An accurate-looking contract call with hidden effects on **tracked** assets or permissions: the "contract told the truth; the chain caught what it did" case.
- Stale pre-signed authority: `VALID_UNTIL` kills it within N blocks. This is a partial Drift mitigation only.
- Swap frontends lying about the minimum output, route, recipient, or hook risk (the Uniswap case).

**Out of scope (say it first)**
- Compromised machine signers with no human reading anything (Binance).
- Stolen owner keys.
- Collusion: a k-of-n attestor quorum compromised together with a compromised ENS publisher.
- A sentence that is accurate but misunderstood.
- Untracked state, protocol-internal ledgers, and admin-parameter-dependent behaviour.
- Off-chain signatures. ERC-1271 is off by default; opting in renders `NO_POST_CHECK`.
