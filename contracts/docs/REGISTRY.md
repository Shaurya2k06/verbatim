# ERC-7730 registry import

Who writes descriptors? Mostly, others already have. `contracts/scripts/registry-import` runs [LedgerHQ/clear-signing-erc7730-registry](https://github.com/LedgerHQ/clear-signing-erc7730-registry) through our compiler.

**1898 of 3035 function descriptors compile (62.5%), from 558 of 776 files, covering 65 protocols.** Every failure is listed in `registry-failures.json`.

What "compile" means: the JSON becomes valid VDesc bytes, the same format the chain renders. It does not mean each was attested or tested against its contract. Attestors still decide what to trust.

ERC-7730 says nothing about effects, so an imported descriptor gives a readable sentence plus the default assertions: no tracked asset decreases, no allowance grows. Those defaults fail closed for a call that spends a tracked token, until someone adds an `x-verbatim` effects section. That hand-written step is what `contracts/descriptors/` holds for ERC-20, WETH, Permit2, an ERC-4626 vault and an Aave-style pool.

## Why the rest failed

| Reason | Functions |
|---|---:|
| static note or constant, no calldata field to bind | 565 |
| array field | 398 |
| path through a non-tuple | 63 |
| enum table by reference | 62 |
| nested calldata with an unmapped callee | 31 |
| path not in the signature | 10 |
| format undefined on tuple | 8 |

Most are real format gaps rather than bugs: VDesc v1 does not iterate arrays, which is deliberate, because an unbounded loop in validation is a gas and invalidation risk.
