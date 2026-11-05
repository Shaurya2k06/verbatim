// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Append-only byte buffer over a fixed memory region, plus bounds-checked readers. No copies, no concatenation.
library Buf {
    error BufOverflow();
    error OutOfBounds();

    struct B {
        uint256 ptr; // start of the content (one word after a reserved length slot)
        uint256 len;
        uint256 cap;
    }

    function alloc(uint256 cap) internal pure returns (B memory b) {
        uint256 p;
        assembly ("memory-safe") {
            p := mload(0x40)
            mstore(0x40, add(p, add(cap, 0x40)))
        }
        b.ptr = p + 32;
        b.cap = cap;
    }

    /// The content as a `bytes` value, sharing memory with the buffer.
    function toBytes(B memory b) internal pure returns (bytes memory out) {
        uint256 p = b.ptr - 32;
        uint256 n = b.len;
        assembly ("memory-safe") {
            mstore(p, n)
            out := p
        }
    }

    function _reserve(B memory b, uint256 n) private pure returns (uint256 at) {
        unchecked {
            uint256 len = b.len;
            at = b.ptr + len;
            len += n;
            if (len > b.cap) revert BufOverflow();
            b.len = len;
        }
    }

    function u8(B memory b, uint256 v) internal pure {
        uint256 at = _reserve(b, 1);
        assembly ("memory-safe") {
            mstore8(at, v)
        }
    }

    /// Big-endian, right-aligned `n` bytes of `v`, n <= 32.
    function be(B memory b, uint256 v, uint256 n) internal pure {
        uint256 at = _reserve(b, n);
        assembly ("memory-safe") {
            mstore(at, shl(mul(sub(32, n), 8), v))
        }
    }

    function addr(B memory b, address a) internal pure {
        be(b, uint160(a), 20);
    }

    function word(B memory b, uint256 v) internal pure {
        be(b, v, 32);
    }

    /// Copies `data[off:off+n]`.
    function copy(B memory b, bytes memory data, uint256 off, uint256 n) internal pure {
        _in(data, off, n);
        uint256 at = _reserve(b, n);
        assembly ("memory-safe") {
            mcopy(at, add(add(data, 0x20), off), n)
        }
    }

    function patchBe(B memory b, uint256 pos, uint256 v, uint256 n) internal pure {
        uint256 end = pos + n;
        if (end > b.len) revert OutOfBounds();
        uint256 p = b.ptr;
        for (uint256 i = 0; i < n; i++) {
            uint256 at = p + end - 1 - i;
            uint256 x = v >> (8 * i);
            assembly ("memory-safe") {
                mstore8(at, x)
            }
        }
    }

    // ------------------------------------------------------------ readers over `bytes memory` ----

    /// `off + n <= d.length`, written so a hostile 256-bit offset cannot wrap past it.
    function _in(bytes memory d, uint256 off, uint256 n) private pure {
        unchecked {
            uint256 len = d.length;
            if (off > len || n > len - off) revert OutOfBounds();
        }
    }

    function rdWord(bytes memory d, uint256 off) internal pure returns (uint256 v) {
        _in(d, off, 32);
        assembly ("memory-safe") {
            v := mload(add(add(d, 0x20), off))
        }
    }

    function rdU8(bytes memory d, uint256 off) internal pure returns (uint256 v) {
        _in(d, off, 1);
        assembly ("memory-safe") {
            v := byte(0, mload(add(add(d, 0x20), off)))
        }
    }

    function rdBe(bytes memory d, uint256 off, uint256 n) internal pure returns (uint256 v) {
        _in(d, off, n);
        assembly ("memory-safe") {
            v := shr(mul(sub(32, n), 8), mload(add(add(d, 0x20), off)))
        }
    }

    /// Keccak of `d[off:off+n]`, no copy.
    function hashRange(bytes memory d, uint256 off, uint256 n) internal pure returns (bytes32 h) {
        _in(d, off, n);
        assembly ("memory-safe") {
            h := keccak256(add(add(d, 0x20), off), n)
        }
    }

    /// An ABI word that must be a valid address.
    function rdAddr(bytes memory d, uint256 off) internal pure returns (address a) {
        uint256 v = rdWord(d, off);
        if (v >> 160 != 0) revert OutOfBounds();
        a = address(uint160(v));
    }

    /// A new `bytes` view copying `d[off:off+n]`.
    function slice(bytes memory d, uint256 off, uint256 n) internal pure returns (bytes memory out) {
        _in(d, off, n);
        assembly ("memory-safe") {
            out := mload(0x40)
            mstore(out, n)
            mcopy(add(out, 0x20), add(add(d, 0x20), off), n)
            mstore(0x40, add(add(out, 0x20), and(add(n, 0x1f), not(0x1f))))
        }
    }
}

/// VTREE v1 node writers (docs/VTREE.md).
library VTree {
    using Buf for Buf.B;

    error StrTooLong();

    uint32 internal constant MAGIC = 0x56540001;

    uint8 internal constant CALL_BEGIN = 0x01;
    uint8 internal constant CALL_END = 0x02;
    uint8 internal constant FIELD_ADDRESS = 0x10;
    uint8 internal constant FIELD_AMOUNT = 0x11;
    uint8 internal constant FIELD_UINT = 0x12;
    uint8 internal constant FIELD_BOOL = 0x13;
    uint8 internal constant FIELD_ENUM = 0x14;
    uint8 internal constant FIELD_BYTES = 0x15;
    uint8 internal constant FIELD_ETH_VALUE = 0x16;
    uint8 internal constant GROUP_BEGIN = 0x20;
    uint8 internal constant GROUP_END = 0x21;
    uint8 internal constant RISK = 0x30;
    uint8 internal constant BLIND = 0x31;
    uint8 internal constant FEE = 0x40;
    uint8 internal constant VALID_UNTIL = 0x41;
    uint8 internal constant POLICY = 0x42;

    uint8 internal constant UNIT_NONE = 0;
    uint8 internal constant UNIT_TIMESTAMP = 1;
    uint8 internal constant UNIT_BIPS = 2;

    /// Starts a node; the length is patched by `end`.
    function begin(Buf.B memory t, uint8 kind) internal pure returns (uint256 at) {
        t.be(uint256(kind) << 16, 3);
        unchecked {
            at = t.len - 2;
        }
    }

    function end(Buf.B memory t, uint256 at) internal pure {
        uint256 n;
        uint256 p;
        unchecked {
            n = t.len - at - 2;
            p = t.ptr + at;
        }
        assembly ("memory-safe") {
            mstore8(p, shr(8, n))
            mstore8(add(p, 1), n)
        }
    }

    /// A `str` from memory bytes `d[off:off+n]`.
    function strFrom(Buf.B memory t, bytes memory d, uint256 off, uint256 n) internal pure {
        if (n > 48) revert StrTooLong();
        t.u8(n);
        t.copy(d, off, n);
    }

    /// A `str` from a literal.
    function str(Buf.B memory t, bytes memory s) internal pure {
        strFrom(t, s, 0, s.length);
    }

    /// A `str` held in a bytes32: bytes 0..30 are the text, byte 31 the length. Zero is the empty string.
    function strPacked(Buf.B memory t, bytes32 s) internal pure {
        uint256 n = uint256(s) & 0xff;
        if (n > 31) revert StrTooLong();
        t.u8(n);
        t.be(uint256(s) >> ((32 - n) * 8), n);
    }

    function risk(Buf.B memory t, uint16 code) internal pure {
        uint256 at = begin(t, RISK);
        t.be(code, 2);
        end(t, at);
    }

    function riskAddr(Buf.B memory t, uint16 code, address a) internal pure {
        uint256 at = begin(t, RISK);
        t.be(code, 2);
        t.addr(a);
        end(t, at);
    }

    function fieldUint(Buf.B memory t, bytes memory label, uint256 v, uint8 unit) internal pure {
        uint256 at = begin(t, FIELD_UINT);
        str(t, label);
        t.word(v);
        t.u8(unit);
        end(t, at);
    }

    function fieldBytes(Buf.B memory t, bytes memory label, bytes32 h, uint256 n) internal pure {
        uint256 at = begin(t, FIELD_BYTES);
        str(t, label);
        t.word(uint256(h));
        t.be(n, 4);
        end(t, at);
    }

    function fieldBool(Buf.B memory t, bytes memory label, bool v) internal pure {
        uint256 at = begin(t, FIELD_BOOL);
        str(t, label);
        t.u8(v ? 1 : 0);
        end(t, at);
    }

    function fieldEth(Buf.B memory t, uint256 v) internal pure {
        uint256 at = begin(t, FIELD_ETH_VALUE);
        t.word(v);
        end(t, at);
    }

    function blind(Buf.B memory t, bytes memory label, bytes32 h, uint256 n) internal pure {
        uint256 at = begin(t, BLIND);
        str(t, label);
        t.word(uint256(h));
        t.be(n, 4);
        t.be(0xffff, 2);
        end(t, at);
    }

    function groupBegin(Buf.B memory t, bytes memory label) internal pure {
        uint256 at = begin(t, GROUP_BEGIN);
        str(t, label);
        end(t, at);
    }

    function groupEnd(Buf.B memory t) internal pure {
        end(t, begin(t, GROUP_END));
    }

    function callEnd(Buf.B memory t) internal pure {
        end(t, begin(t, CALL_END));
    }
}

/// Risk codes (docs/VTREE.md) and their bit positions in the render's seen-risk set.
library Risk {
    uint16 internal constant UNLIMITED_APPROVAL = 0x0001;
    uint16 internal constant OPERATOR_APPROVAL = 0x0002;
    uint16 internal constant UPGRADEABLE_TARGET = 0x0003;
    uint16 internal constant UNVERIFIED_CONTRACT = 0x0004;
    uint16 internal constant TRUST_CHANGE = 0x0005;
    uint16 internal constant NO_POST_CHECK = 0x0006;
    uint16 internal constant RECIPIENT_HAS_CODE = 0x0007;
    uint16 internal constant RECIPIENT_NOT_SELF = 0x0008;
    uint16 internal constant NO_MIN_OUT = 0x0101;
    uint16 internal constant HOOK_CAN_TAKE_INPUT = 0x0102;
    uint16 internal constant HOOK_CAN_TAKE_OUTPUT = 0x0103;
    uint16 internal constant HOOK_DYNAMIC_FEE = 0x0104;
    uint16 internal constant HOOK_UNVERIFIED = 0x0105;
    uint16 internal constant SWEEP_TO_OTHER = 0x0106;
    uint16 internal constant PERMIT2_ALLOWANCE_CHANGE = 0x0107;
    uint16 internal constant UR_ALLOW_REVERT = 0x0108;
    uint16 internal constant TTL_LONG = 0x0201;
    uint16 internal constant TOKEN_UNSAFE = 0x0202;

    // Seen-set bits, kept separate from wire codes so policy checks are one mask test.
    uint256 internal constant BIT_UNVERIFIED = 1 << 0;
    uint256 internal constant BIT_BLIND = 1 << 1;
    uint256 internal constant BIT_UNLIMITED = 1 << 2;
    uint256 internal constant BIT_NO_MIN_OUT = 1 << 3;
    uint256 internal constant BIT_HOOK_TAKE = 1 << 4;
    uint256 internal constant BIT_HOOK_UNVERIFIED = 1 << 5;
    uint256 internal constant BIT_TTL_LONG = 1 << 6;
    uint256 internal constant BIT_TOKEN_UNSAFE = 1 << 7;
    uint256 internal constant BIT_TRUST_CHANGE = 1 << 8;
}

/// VSPEC v1 (docs/VSPEC.md): collects effects during a render and serialises them deterministically.
library VSpec {
    using Buf for Buf.B;

    error ConflictingEffects();
    error TooManyEffects();

    uint32 internal constant MAGIC = 0x56530001;

    uint8 internal constant DELTA_EQ = 0x01;
    uint8 internal constant DELTA_GE = 0x02;
    uint8 internal constant ALLOW_LE = 0x03;
    uint8 internal constant P2ALLOW_LE = 0x04;
    uint8 internal constant OPERATOR_EQ = 0x05;
    uint8 internal constant OWNER_EQ = 0x06;
    uint8 internal constant CODEHASH_EQ = 0x07;
    uint8 internal constant NO_CODE = 0x08;
    uint8 internal constant TRACKED_NO_DECREASE = 0x09;
    uint8 internal constant TRACKED_NO_ALLOW_INC = 0x0a;
    uint8 internal constant ACCOUNT_INVARIANT = 0x0b;
    uint8 internal constant IMPL_EQ = 0x0c;
    uint8 internal constant NAME_EQ = 0x0d;

    uint8 internal constant P2_ABSOLUTE = 0;
    uint8 internal constant P2_RELATIVE = 1;

    uint256 internal constant MAX_DELTAS = 16;

    /// Deltas are a flat, uninitialised run of 3 words each, guarded by `nDeltas`: holder (with the GE flag at
    /// bit 160), asset, value. Allocating sixteen structs per render costs more than the rest of derive.
    struct Effects {
        uint256 deltas;
        uint256 nDeltas;
        Buf.B other;
        uint256 nOther;
    }

    /// A value that must fit a signed delta.
    function toInt(uint256 v) internal pure returns (int256) {
        if (v >> 255 != 0) revert TooManyEffects();
        return int256(v);
    }

    function init(Effects memory e, uint256 cap) internal pure {
        e.other = Buf.alloc(cap);
        uint256 p;
        assembly ("memory-safe") {
            p := mload(0x40)
            mstore(0x40, add(p, mul(MAX_DELTAS, 0x60)))
        }
        e.deltas = p;
    }

    /// Effects on one (holder, asset) merge: EQ sums with EQ, GE with GE, and mixing kinds fails closed.
    function addDelta(Effects memory e, address holder, address asset, int256 value, bool ge) internal pure {
        uint256 p = e.deltas;
        uint256 n = e.nDeltas;
        for (uint256 i = 0; i < n; i++) {
            uint256 h;
            uint256 a;
            int256 v;
            assembly ("memory-safe") {
                h := mload(p)
                a := mload(add(p, 0x20))
                v := mload(add(p, 0x40))
            }
            if (address(uint160(h)) == holder && address(uint160(a)) == asset) {
                if ((h >> 160 == 1) != ge) revert ConflictingEffects();
                int256 sum = v + value;
                assembly ("memory-safe") {
                    mstore(add(p, 0x40), sum)
                }
                return;
            }
            p += 0x60;
        }
        if (n == MAX_DELTAS) revert TooManyEffects();
        uint256 head = uint256(uint160(holder)) | (ge ? 1 << 160 : 0);
        assembly ("memory-safe") {
            mstore(p, head)
            mstore(add(p, 0x20), asset)
            mstore(add(p, 0x40), value)
        }
        e.nDeltas = n + 1;
    }

    function allowLe(Effects memory e, address token, address spender, uint256 max) internal pure {
        e.other.u8(ALLOW_LE);
        e.other.addr(token);
        e.other.addr(spender);
        e.other.word(max);
        e.nOther++;
    }

    function p2AllowLe(Effects memory e, address permit2, address token, address spender, uint8 mode, uint256 value) internal pure {
        e.other.u8(P2ALLOW_LE);
        e.other.addr(permit2);
        e.other.addr(token);
        e.other.addr(spender);
        e.other.u8(mode);
        e.other.be(value, 20);
        e.nOther++;
    }

    function operatorEq(Effects memory e, address collection, address operator, bool v) internal pure {
        e.other.u8(OPERATOR_EQ);
        e.other.addr(collection);
        e.other.addr(operator);
        e.other.u8(v ? 1 : 0);
        e.nOther++;
    }

    function ownerEq(Effects memory e, address collection, uint256 id, address owner) internal pure {
        e.other.u8(OWNER_EQ);
        e.other.addr(collection);
        e.other.word(id);
        e.other.addr(owner);
        e.nOther++;
    }

    function codehashEq(Effects memory e, address target, bytes32 h) internal pure {
        e.other.u8(CODEHASH_EQ);
        e.other.addr(target);
        e.other.word(uint256(h));
        e.nOther++;
    }

    function noCode(Effects memory e, address a) internal pure {
        e.other.u8(NO_CODE);
        e.other.addr(a);
        e.nOther++;
    }

    function implEq(Effects memory e, address target, bytes4 getter, address impl) internal pure {
        e.other.u8(IMPL_EQ);
        e.other.addr(target);
        e.other.be(uint32(getter), 4);
        e.other.addr(impl);
        e.nOther++;
    }

    /// The name a sentence showed still resolves to this address when the batch runs (§12.3).
    function nameEq(Effects memory e, address a, address resolver, bytes32 packedName) internal pure {
        e.other.u8(NAME_EQ);
        e.other.addr(a);
        e.other.addr(resolver);
        e.other.word(uint256(packedName));
        e.nOther++;
    }

    /// `MAGIC nItems deltas others defaults`.
    function finish(Effects memory e, bool trustChange) internal pure returns (bytes memory) {
        Buf.B memory s = Buf.alloc(e.nDeltas * 73 + e.other.len + 16);
        s.be(MAGIC, 4);
        s.be(e.nDeltas + e.nOther + 3, 2);
        uint256 p = e.deltas;
        for (uint256 i = 0; i < e.nDeltas; i++) {
            uint256 h;
            uint256 a;
            uint256 v;
            assembly ("memory-safe") {
                h := mload(p)
                a := mload(add(p, 0x20))
                v := mload(add(p, 0x40))
            }
            s.u8(h >> 160 == 1 ? DELTA_GE : DELTA_EQ);
            s.addr(address(uint160(h)));
            s.addr(address(uint160(a)));
            s.word(v);
            p += 0x60;
        }
        s.copy(e.other.toBytes(), 0, e.other.len);
        s.u8(TRACKED_NO_DECREASE);
        s.u8(TRACKED_NO_ALLOW_INC);
        s.u8(ACCOUNT_INVARIANT);
        s.u8(trustChange ? 1 : 0);
        return s.toBytes();
    }
}
