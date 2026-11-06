# Bounty: terms and how it runs

**Not live.** It goes live only after an external red team signs off, and with attestor keys held outside the team. Neither has happened. No funds are at risk until then.

## The setup

A wallet on Base or Optimism mainnet with $500 to $1,000. One of its owner keys is held by `apps/bounty-oracle`, a policy-bounded signing oracle, which signs **any** submitted sentence that meets the policy below. So anyone can get a signature, and the question is whether the guarantees hold.

## The policy

- only attested pools, with the output going to the account itself;
- minimum output at least 98% of a pinned oracle price;
- at most $100 per transaction;
- no approval outlives its batch.

## How to win

Either of these, in a transaction on the published account:

1. Lose the wallet's value **beyond the guarantees of a sentence the oracle signed**.
2. Land a transaction that differs from its signed tree.

The payout is the measured excess, up to the wallet's balance.

## Safe harbour

Good-faith attempts against the published contracts and the oracle's public interface are welcome and will not be pursued.

**Excluded:** social engineering of the team or attestors; attacks on the oracle's server, or anyone's keys or infrastructure; attacks on third parties, including Uniswap, the bundler, the L2 or other users; denial of service.

## Claiming

Open a private advisory on the repository with the transaction hash and a short explanation. We confirm or dispute within 72 hours, on-chain evidence decides, and we publish the result.

## Key hygiene

Owner keys sit only on the signer device and in the oracle's environment. Attestor keys are with at least two parties outside the team, on separate devices. No keys in the repo or CI.
