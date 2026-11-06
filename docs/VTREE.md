# VTREE v2: the display tree

The canonical bytes of a sentence. `treeHash = keccak256(tree)` is what owners sign. Implemented in `contracts/src/lib/VTree.sol` and `packages/urrender/src/vtree.ts`, held byte-identical by `tools/difffuzz`; decoded strictly in `packages/displayvm-ts/src/device.ts`.

All integers are big-endian. Every node is `type(u8) len(u16) payload`.

```
Tree   := 0x56540002 Header Node*
Header := chainId(u64) account(20) expiry(u64) snapshotRoot(32) policyVersion(u32) path(u8)
```

`path` is 1 stateless, 2 paymaster, 3 ERC-4337. There is no global trust epoch: each call binds its own `descHash`. `expiry` is a unix timestamp, enforced by the expiry frame and again at execution.

| Type | Name | Payload |
|---|---|---|
| 0x01 | CALL_BEGIN | target(20) codehash(32) selector(4) descHash(32) intent(str) publisher(str) attestStatus(u8) |
| 0x02 | CALL_END | |
| 0x10 | FIELD_ADDRESS | label(str) addr(20) nameSource(u8) name(str) flags(u8: bit 0 hasCode, bit 1 isSelf) |
| 0x11 | FIELD_AMOUNT | label(str) token(20) symbol(str) decimals(u8) raw(u256) |
| 0x12 | FIELD_UINT | label(str) value(u256) unit(u8: 0 none, 1 timestamp, 2 bips) |
| 0x13 | FIELD_BOOL | label(str) v(u8) |
| 0x14 | FIELD_ENUM | label(str) code(u16) text(str) |
| 0x15 | FIELD_BYTES | label(str) keccak(32) len(u32) |
| 0x16 | FIELD_ETH_VALUE | raw(u256) |
| 0x20 / 0x21 | GROUP_BEGIN / GROUP_END | label(str) / empty |
| 0x30 | RISK | code(u16) args(bytes) |
| 0x31 | BLIND | label(str) keccak(32) len(u32) boundBy(u16, 0xFFFF for unbound) |
| 0x40 | FEE | asset(20) amount(u256): declared frame limits times the fee cap (D-A19) |
| 0x50 | GUARANTEE | op(u8) args: one node per VSPEC item, in VSPEC order, last in the tree. The device shows these first |

`attestStatus`: 0 none, 1 attested with an ENS exclusivity proof, 2 attested without ENS (the frames devnet has none).

**Strings.** `str` is `len(u8)` plus at most 48 ASCII bytes in `0x20`-`0x7E`, excluding `\`. Descriptor strings are validated when attested (`VDesc.validate`). Publisher names and token symbols live in one storage word, so they are at most 31 and 11 bytes.

**Amounts** are never rounded. The device prints `raw / 10^decimals` exactly: digits, at most one `.`, then the symbol.

**Device rule.** Every node is shown. Risk and blind nodes are also lifted to the top. Unknown node types, unknown risk codes, trailing bytes inside a node, and malformed strings all refuse the tree.

## Risk codes

| Code | Name | Emitted when |
|---|---|---|
| 0x0001 | UNLIMITED_APPROVAL | approve amount at or above 2^255, or a Permit2 amount of `type(uint160).max` |
| 0x0002 | OPERATOR_APPROVAL | setApprovalForAll(true) |
| 0x0003 | UPGRADEABLE_TARGET(upgrader) | the target's code hash matches a proxy template |
| 0x0004 | UNVERIFIED_CONTRACT | no live descriptor for (code hash, selector) |
| 0x0005 | TRUST_CHANGE | a descriptor flagged ADMIN |
| 0x0006 | NO_POST_CHECK | reserved: ERC-1271 opt-in is not built, so nothing emits it |
| 0x0007 | RECIPIENT_HAS_CODE | recipient has code |
| 0x0008 | RECIPIENT_NOT_SELF | output goes to an address other than the account |
| 0x0101 | NO_MIN_OUT | swap minimum is zero |
| 0x0102 | HOOK_CAN_TAKE_INPUT | hook address has `BEFORE_SWAP_RETURNS_DELTA` (bit 3) |
| 0x0103 | HOOK_CAN_TAKE_OUTPUT | hook address has `AFTER_SWAP_RETURNS_DELTA` (bit 2) |
| 0x0104 | HOOK_DYNAMIC_FEE | `PoolKey.fee == 0x800000` |
| 0x0105 | HOOK_UNVERIFIED | hook code hash not attested |
| 0x0106 | SWEEP_TO_OTHER | SWEEP or PAY_PORTION to someone else |
| 0x0107 | PERMIT2_ALLOWANCE_CHANGE | Permit2 approve in the batch |
| 0x0108 | UR_ALLOW_REVERT | a command carries the allow-revert flag |
| 0x0009 | SPENDER_UNATTESTED | an approval names a spender no attestor has vouched for |
| 0x0202 | TOKEN_UNSAFE | added: token flagged fee-on-transfer or rebasing. This sets a policy bit and is not emitted as a node |

## Default policy (`_applyPolicy`)

Refuses: `UNVERIFIED_CONTRACT`, unbounded `BLIND`, `UNLIMITED_APPROVAL`, `SPENDER_UNATTESTED` (unless the approval is being set to zero), `UR_ALLOW_REVERT`, unsafe tokens, and any `HOOK_CAN_TAKE_*` combined with `NO_MIN_OUT` or `HOOK_UNVERIFIED`. A policy's `allowMask` lifts these one by one. `policyVersion` is in the header, so owners sign the policy in force. The policy lives in the account (§7.4).

`TTL_LONG` is not emitted. Validation cannot read the time, so a validity beyond the policy's `maxTtl` (default 300 s) reverts `TtlTooLong` in execution, and the device refuses anything beyond its own `DEVICE_MAX_TTL` (600 s) by its own clock.
