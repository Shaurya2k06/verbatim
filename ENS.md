# Verbatim × ENSv2

**Prize:** ENS, Best use of ENSv2

On Sepolia, ENSv2 is Verbatim's trust root. Every signed sentence depends on four questions, and ENS answers all of them. Each is checked at execution, so transaction validation still reads nothing external.

## How we use it

| Question | How ENSv2 answers it | Code |
|---|---|---|
| **Who may attest?** | The anchor name holds the attestor-set record. Every attestor whose signature a transaction used must be listed, or the batch reverts with `AttestorNotListed` | [`EnsTrustAnchor.check`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/trust/EnsTrustAnchor.sol#L75), [`L85`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/trust/EnsTrustAnchor.sol#L85) |
| **What is revoked?** | Revocation records on the anchor name. A leaf revoked while a transaction is pending is refused with `LeafRevokedInEns` | [`EnsTrustAnchor.sol#L90`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/trust/EnsTrustAnchor.sol#L90) |
| **Who published this descriptor?** | The publisher's name passes an exclusivity proof on its PermissionedResolver (listed below) | [`EnsTrustChecker.check`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/trust/EnsTrustChecker.sol#L111) |
| **Who are you paying?** | A recipient shows as a name only when it resolves forward and in reverse at execution. Wildcard and CCIP-read resolvers are refused. A lookalike shows as hex | [`checkName`](https://github.com/Shaurya2k06/verbatim/blob/main/contracts/src/trust/EnsTrustChecker.sol#L143) |

The exclusivity proof checks that:
- the resolver is pinned code, reached directly;
- the `clear-signing` text record lists the descriptor hash;
- nobody holds the root `SET_TEXT`, `LINK` or `UPGRADE` roles, or their admins (via `roleCount`);
- exactly one account holds the **argument-scoped** setter for `clear-signing`, with no admin;
- nobody can change the name's resolver or subregistry;
- the registration runs at least a year past now.

## Why ENSv2 specifically

ENSv2's permission model lets a contract *prove* that exactly one party can change a record, through Enhanced Access Control, argument-scoped roles and `roleCount`. That proof is what makes a name trustworthy as a publisher identity and as the source of an attestor set. It's a security primitive, not a name lookup.

Remove ENS, and the Sepolia leg has no way to say who attests or who published. A captured attestor quorum would also have to get past ENS.

## Evidence (Sepolia)

| Proof ID | What happened |
|---|---|
| `B-honest-pimlico` | The signed sentence shows `To: verbatim-demo.eth`, verified forward and in reverse, and the transaction landed |
| `B13` | An attestor missing from the anchor record → `AttestorNotListed` |
| `B-ens-revoked` | A leaf revoked in ENS while the operation was pending → `LeafRevokedInEns` |
| `A8` | The lookalike `verbatim-dem0.eth` shows as hex, and the proof refuses it |

Run the same checks on any name you type at [/ens](https://verbatim-wallet.vercel.app/ens).

**Disclosed limits** (D-A11): second-level `.eth` names only, and the demo council is a single key.