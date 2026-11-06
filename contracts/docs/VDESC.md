# VDesc v1: compiled descriptors

Compact binary descriptors, keyed on chain by `(EXTCODEHASH(target), selector)`. `packages/vdesc-compiler` compiles them from ERC-7730-shaped JSON in `contracts/descriptors/` plus our effects extension. `descHash = keccak256(vdesc)`. `VDesc.validate` checks every descriptor's structure and strings at attestation, so rendering does not have to.

```
VDesc  := 0x56440001 intent(str) exactWords(u8) nFields(u8) Field* nEffects(u8) Effect* riskFlags(u16)
Field  := path kind(u8) label(str) params
Effect := kind(u8) tokenSrc path path?
path   := n(u8) step(u8)*          step = word index | 0x80 if the word is a pointer to follow
Src    := 0x00 (the call's target) | 0x01 path | 0x02 address(20)
```

`exactWords` is the number of static argument words when the calldata length is fixed; `0xFF` leaves it unchecked. Added to §8.3: it refuses calldata with trailing bytes on static functions, so nothing hides past the fields.

| Kind | Field | Params |
|---|---|---|
| 1 | ADDRESS | role(u8: 0 other, 1 recipient, 2 spender, 3 operator) |
| 2 | TOKEN_AMOUNT | tokenSrc |
| 3 | UINT | unit(u8) |
| 4 | BOOL | |
| 5 | ENUM | n(u8), then code(u16) text(str). An unknown value refuses |
| 6 | BYTES_OPAQUE | always hashed, never shown raw |
| 7 | CALLDATA | target: 0, or 1 path. Value: 0, or 1 path. Nested render, depth at most 3 |
| 8 | ETH_VALUE | |

| Kind | Effect | Paths | Becomes |
|---|---|---|---|
| 1 | OUT_EXACT | amount, to | `DELTA_EQ(account, token, -amount)`, or 0 if sent to self |
| 2 | IN_MIN | amount | `DELTA_GE(account, token, amount)` |
| 3 | APPROVE_SET | spender, amount | `ALLOW_LE`, and a ledger entry |
| 4 | OPERATOR_SET | operator, approved | `OPERATOR_EQ`, and a ledger entry |
| 5 | SHARES_MIN | min | `DELTA_GE(account, shareToken, min)` |
| 6 | NFT_OUT | id, to | `OWNER_EQ` |
| 7 | P2_APPROVE_SET | spender, amount | `P2ALLOW_LE` absolute, ledger entry, `PERMIT2_ALLOWANCE_CHANGE`. Added for Permit2 |

`riskFlags`: bit 0 UNLIMITED_IF, bit 1 OPERATOR, bit 2 ADMIN.

## JSON form

Standard ERC-7730 `metadata` and `display.formats`, with one extension key per format. **ERC-7730 has no notion of effects, and this is the part we propose upstream.**

```json
{
  "metadata": { "owner": "verbatim-demo.eth" },
  "display": { "formats": {
    "transfer(address,uint256)": {
      "intent": "Send tokens",
      "x-verbatim": {
        "exactWords": 2,
        "fields": [
          { "path": "0", "label": "To", "format": "address", "role": "recipient" },
          { "path": "1", "label": "Amount", "format": "tokenAmount", "token": { "kind": "target" } }
        ],
        "effects": [{ "kind": "OUT_EXACT", "token": { "kind": "target" }, "amount": "1", "to": "0" }]
      }
    }
  } }
}
```

Paths: `"2"` is word 2. `"2>0"` follows the pointer at word 2, then reads word 0. `"0.1"` stays inside an inline tuple.

This is a subset we compile, not a full ERC-7730 implementation: ERC-7730's own field paths and formats are not parsed.
