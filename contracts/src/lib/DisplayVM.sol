// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Buf, VTree, VSpec, Risk} from "./VTree.sol";
import {VDesc} from "./VDesc.sol";
import {URRender} from "../uniswap/URRender.sol";

/// Re-renders a transaction's real calldata into the VTREE its owners signed, and derives its VSPEC.
/// Mixed into anything holding a trust store; every lookup is a virtual function so a test harness can stand in.
/// The TypeScript twin (`packages/displayvm-ts`) must stay byte-identical; see contracts/scripts/difffuzz.
abstract contract DisplayVM {
    using Buf for Buf.B;
    using Buf for bytes;
    using VTree for Buf.B;
    using VSpec for VSpec.Effects;

    error DepthExceeded();
    error BadCalldata();
    error BadHint(address target);
    error UnknownEnum();

    uint256 internal constant MAX_DEPTH = 3;
    uint256 internal constant MAX_TREE = 3072;
    uint256 internal constant MAX_OTHER = 1024;
    bytes32 private constant EMPTY_CODE = keccak256("");

    uint8 internal constant ATTEST_NONE = 0;

    struct In {
        uint64 chainId;
        address account;
        /// Unix seconds, from the expiry frame. The device checks it against its own clock, the verifier in validation.
        uint64 expiry;
        bytes32 snapshotRoot;
        uint32 policyVersion;
        uint8 path;
        address feeAsset;
        /// Declared frame limits times the fee cap: what the signer can be told before knowing the base fee (D-A19).
        uint256 maxFee;
        /// ABI body of executeVerified, without the selector: calls, spec.
        bytes body;
        /// Addresses claimed to have code. Everything else is rendered as code-free and asserted so at execution,
        /// because validation must not touch an address with no code (CALLING-010).
        address[] hints;
    }

    struct Out {
        bytes tree;
        bytes spec;
        uint256 risk;
    }

    struct Desc {
        bytes blob;
        bytes32 publisher;
        uint64 epoch;
        uint8 status;
    }

    struct Host {
        address[] hints;
        bool trustChange;
    }

    // ------------------------------------------------------------------------ trust lookups -----

    function _codehashOf(address a) internal view virtual returns (bytes32);
    /// Empty blob when no live descriptor exists.
    function _descriptor(bytes32 codehash, bytes4 selector) internal view virtual returns (Desc memory);
    function _tokenInfo(address token) internal view virtual returns (bytes32 symbol, uint8 decimals, uint8 flags, bool known);
    function _nameOf(address a) internal view virtual returns (bytes32);
    /// The resolver a cached name was verified against; only read when `_nameOf` returned a name.
    function _nameResolver(address a) internal view virtual returns (address);
    function _hookIsAttested(bytes32 codehash) internal view virtual returns (bool);
    function _spenderIsAttested(address spender) internal view virtual returns (bool);
    /// 0 plain, 1 Universal Router, 2 known proxy, 3 Universal Router with the older params layout.
    function _codeKind(bytes32 codehash) internal view virtual returns (uint8);
    function _routerConfig() internal view virtual returns (address permit2, address weth, bytes32 publisher);
    function _proxyTemplate(bytes32 codehash) internal view virtual returns (address upgrader, bytes32 logicCodehash, address impl, bytes4 getter);

    // ------------------------------------------------------------------------------- render -----

    function _render(In memory i) internal view returns (Out memory o) {
        Buf.B memory t = Buf.alloc(MAX_TREE);
        Host memory h = Host(i.hints, false);
        URRender.Ctx memory c;
        c.cfg.account = i.account;
        c.fn = URRender.Lookups(_urAmount, _urHookAttested, _urAddressField);
        c.effects.init(MAX_OTHER);
        assembly ("memory-safe") {
            mstore(add(c, 0xa0), h)
        }

        t.be(VTree.MAGIC, 4);
        t.be(i.chainId, 8);
        t.addr(i.account);
        t.be(i.expiry, 8);
        t.word(uint256(i.snapshotRoot));
        t.be(i.policyVersion, 4);
        t.u8(i.path);

        uint256 at = t.begin(VTree.FEE);
        t.addr(i.feeAsset);
        t.word(i.maxFee);
        t.end(at);

        // body: [calls ptr, spec ptr]
        bytes memory b = i.body;
        uint256 arr = b.rdWord(0);
        uint256 n = b.rdWord(arr);
        if (n > 16) revert BadCalldata();
        uint256 el = arr + 32;
        for (uint256 k = 0; k < n; k++) {
            uint256 callAt = el + b.rdWord(el + k * 32);
            address target = b.rdAddr(callAt);
            uint256 value = b.rdWord(callAt + 32);
            uint256 dataAt = callAt + b.rdWord(callAt + 64);
            uint256 dataLen = b.rdWord(dataAt);
            _renderCall(t, c, h, target, value, b.slice(dataAt + 32, dataLen), 0);
        }

        o.spec = c.effects.finish(h.trustChange, t);
        o.tree = t.toBytes();
        o.risk = c.risk;
    }

    /// The code hash of a hinted address; zero means "claims no code", asserted at execution.
    function _hinted(Host memory h, VSpec.Effects memory e, address a) private view returns (bytes32 ch) {
        for (uint256 k = 0; k < h.hints.length; k++) {
            if (h.hints[k] == a) {
                ch = _codehashOf(a);
                if (ch == bytes32(0) || ch == EMPTY_CODE) revert BadHint(a);
                return ch;
            }
        }
        e.noCode(a);
    }

    function _callBegin(Buf.B memory t, address target, bytes32 ch, bytes4 sel, bytes32 descHash, bytes memory label, uint256 lOff, uint256 lLen, bytes32 publisher, uint8 status) private pure {
        uint256 at = t.begin(VTree.CALL_BEGIN);
        t.addr(target);
        t.word(uint256(ch));
        t.be(uint32(sel), 4);
        t.word(uint256(descHash));
        t.strFrom(label, lOff, lLen);
        t.strPacked(publisher);
        t.u8(status);
        t.end(at);
    }

    function _renderCall(Buf.B memory t, URRender.Ctx memory c, Host memory h, address target, uint256 value, bytes memory data, uint256 depth) private view {
        if (depth > MAX_DEPTH) revert DepthExceeded();
        VSpec.Effects memory e = c.effects;
        address account = c.cfg.account;
        bytes32 ch = _hinted(h, e, target);
        if (value > 0) e.addDelta(account, address(0), -VSpec.toInt(value), false);

        if (ch == bytes32(0)) {
            bytes memory l = "Send ETH";
            _callBegin(t, target, ch, bytes4(0), bytes32(0), l, 0, l.length, bytes32(0), ATTEST_NONE);
            t.fieldEth(value);
            _addressField(t, "To", target, VDesc.ROLE_RECIPIENT, c, h);
            if (data.length != 0) _blindCall(t, c, data);
            t.callEnd();
            return;
        }
        e.codehashEq(target, ch);

        bytes4 sel = data.length >= 4 ? bytes4(uint32(data.rdBe(0, 4))) : bytes4(0);
        // A router's calls skip the descriptor read: its one selector is rendered by URRender.
        uint8 kind = sel == 0x3593564c ? _codeKind(ch) : 0;
        Desc memory d;
        if (kind != 1 && kind != 3) {
            d = _descriptor(ch, sel);
            kind = d.blob.length == 0 ? _codeKind(ch) : 0;
        }

        if (kind == 1 || kind == 3) {
            c.cfg.legacyParams = kind == 3;
            (address permit2, address weth, bytes32 publisher) = _routerConfig();
            bytes memory l = "Uniswap swap";
            _callBegin(t, target, ch, sel, bytes32(0), l, 0, l.length, publisher, 2);
            if (value > 0) t.fieldEth(value);
            c.cfg.router = target;
            c.cfg.permit2 = permit2;
            c.cfg.weth = weth;
            c.value = value;
            URRender.render(t, data, c);
            t.callEnd();
            return;
        }
        address upgrader;
        if (kind == 2) {
            bytes32 logic;
            address impl;
            bytes4 getter;
            (upgrader, logic, impl, getter) = _proxyTemplate(ch);
            e.implEq(target, getter, impl);
            d = _descriptor(logic, sel);
        }
        if (d.blob.length == 0) {
            bytes memory l = "Unverified call";
            _callBegin(t, target, ch, sel, bytes32(0), l, 0, l.length, bytes32(0), ATTEST_NONE);
            if (value > 0) t.fieldEth(value);
            if (kind == 2) t.riskAddr(Risk.UPGRADEABLE_TARGET, upgrader);
            _blindCall(t, c, data);
            t.callEnd();
            return;
        }
        _renderDesc(t, c, h, target, ch, sel, value, data, d, depth, kind == 2, upgrader);
    }

    function _blindCall(Buf.B memory t, URRender.Ctx memory c, bytes memory data) private pure {
        t.risk(Risk.UNVERIFIED_CONTRACT);
        t.blind("calldata", keccak256(data), data.length);
        c.risk |= Risk.BIT_UNVERIFIED | Risk.BIT_BLIND;
    }

    function _renderDesc(Buf.B memory t, URRender.Ctx memory c, Host memory h, address target, bytes32 ch, bytes4 sel, uint256 value, bytes memory data, Desc memory desc, uint256 depth, bool isProxy, address upgrader) private view {
        bytes memory d = desc.blob;
        if (d.rdBe(0, 4) != VDesc.MAGIC) revert VDesc.BadDescriptor();
        uint256 labelLen = d.u8At(4);
        _callBegin(t, target, ch, sel, keccak256(d), d, 5, labelLen, desc.publisher, desc.status);
        if (value > 0) t.fieldEth(value);
        if (isProxy) t.riskAddr(Risk.UPGRADEABLE_TARGET, upgrader);

        uint256 p = 5 + labelLen;
        uint256 exact = d.u8At(p++);
        if (exact != VDesc.EXACT_UNCHECKED && data.length != 4 + exact * 32) revert BadCalldata();
        uint256 n = d.u8At(p++);
        for (uint256 i = 0; i < n; i++) p = _field(t, c, h, target, value, data, d, p, depth);
        n = d.u8At(p++);
        uint256 flags = d.rdBe(d.length - 2, 2);
        for (uint256 i = 0; i < n; i++) p = _effect(t, c, target, value, data, d, p, flags);
        if (flags & VDesc.F_ADMIN != 0) {
            t.risk(Risk.TRUST_CHANGE);
            c.risk |= Risk.BIT_TRUST_CHANGE;
            h.trustChange = true;
        }
        t.callEnd();
    }

    /// Word position of a path: each step is (deref flag 0x80 | word index), the last step names the leaf.
    function _pos(bytes memory d, uint256 p, bytes memory cd) private pure returns (uint256 pos, uint256 next) {
        uint256 n = d.u8At(p);
        if (n == 0) revert VDesc.BadDescriptor();
        uint256 base = 4;
        for (uint256 i = 0; i < n; i++) {
            uint256 s = d.u8At(p + 1 + i);
            pos = base + (s & 0x7f) * 32;
            if (i + 1 < n) base = s & 0x80 != 0 ? base + cd.rdWord(pos) : pos;
        }
        next = p + 1 + n;
    }

    function _skipPath(bytes memory d, uint256 p) private pure returns (uint256) {
        return p + 1 + d.u8At(p);
    }

    /// Tail of a dynamic `bytes` whose pointer sits at `pos`, relative to the enclosing tuple. Only top-level or
    /// single-tuple paths reach here, so the base is recomputed from the path.
    function _dynAt(bytes memory cd, bytes memory d, uint256 pathAt) private pure returns (uint256 off, uint256 len) {
        uint256 n = d.u8At(pathAt);
        uint256 base = 4;
        uint256 pos;
        for (uint256 i = 0; i < n; i++) {
            uint256 s = d.u8At(pathAt + 1 + i);
            pos = base + (s & 0x7f) * 32;
            if (i + 1 < n) base = s & 0x80 != 0 ? base + cd.rdWord(pos) : pos;
        }
        uint256 at = base + cd.rdWord(pos);
        len = cd.rdWord(at);
        off = at + 32;
        if (off + len > cd.length) revert BadCalldata();
    }

    function _src(bytes memory d, uint256 p, address target, bytes memory cd) private pure returns (address token, uint256 next) {
        uint256 kind = d.u8At(p);
        if (kind == VDesc.SRC_TARGET) return (target, p + 1);
        if (kind == VDesc.SRC_CONST) return (address(uint160(d.rdBe(p + 1, 20))), p + 21);
        uint256 pos;
        (pos, next) = _pos(d, p + 1, cd);
        token = cd.rdAddr(pos);
    }

    function _field(Buf.B memory t, URRender.Ctx memory c, Host memory h, address target, uint256 value, bytes memory cd, bytes memory d, uint256 p, uint256 depth) private view returns (uint256) {
        uint256 pathAt = p;
        p = _skipPath(d, p);
        uint256 kind = d.u8At(p++);
        uint256 lOff = p + 1;
        uint256 lLen = d.u8At(p);
        p = lOff + lLen;
        bytes memory label = d.slice(lOff, lLen);

        if (kind == VDesc.K_ETH_VALUE) {
            t.fieldEth(value);
        } else if (kind == VDesc.K_ADDRESS) {
            (uint256 pos, ) = _pos(d, pathAt, cd);
            _addressField(t, label, cd.rdAddr(pos), uint8(d.u8At(p++)), c, h);
        } else if (kind == VDesc.K_TOKEN_AMOUNT) {
            (uint256 pos, ) = _pos(d, pathAt, cd);
            address token;
            (token, p) = _src(d, p, target, cd);
            _amountField(t, label, token, cd.rdWord(pos), c);
        } else if (kind == VDesc.K_UINT) {
            (uint256 pos, ) = _pos(d, pathAt, cd);
            t.fieldUint(label, cd.rdWord(pos), uint8(d.u8At(p++)));
        } else if (kind == VDesc.K_BOOL) {
            (uint256 pos, ) = _pos(d, pathAt, cd);
            uint256 v = cd.rdWord(pos);
            if (v > 1) revert BadCalldata();
            t.fieldBool(label, v == 1);
        } else if (kind == VDesc.K_ENUM) {
            (uint256 pos, ) = _pos(d, pathAt, cd);
            uint256 v = cd.rdWord(pos);
            p = _enum(t, label, v, d, p);
        } else if (kind == VDesc.K_BYTES) {
            (uint256 off, uint256 len) = _dynAt(cd, d, pathAt);
            t.fieldBytes(label, cd.hashRange(off, len), len);
        } else if (kind == VDesc.K_CALLDATA) {
            (uint256 off, uint256 len) = _dynAt(cd, d, pathAt);
            address nt = target;
            uint256 tk = d.u8At(p++);
            if (tk == 1) {
                (uint256 pos, uint256 nx) = _pos(d, p, cd);
                nt = cd.rdAddr(pos);
                p = nx;
            }
            uint256 nv;
            uint256 vk = d.u8At(p++);
            if (vk == 1) {
                (uint256 pos, uint256 nx) = _pos(d, p, cd);
                nv = cd.rdWord(pos);
                p = nx;
            }
            t.groupBegin(label);
            _renderCall(t, c, h, nt, nv, cd.slice(off, len), depth + 1);
            t.groupEnd();
        } else {
            revert VDesc.BadDescriptor();
        }
        return p;
    }

    function _enum(Buf.B memory t, bytes memory label, uint256 v, bytes memory d, uint256 p) private pure returns (uint256) {
        uint256 n = d.u8At(p++);
        bool found;
        for (uint256 j = 0; j < n; j++) {
            uint256 code = d.rdBe(p, 2);
            uint256 sLen = d.u8At(p + 2);
            if (code == v && !found) {
                found = true;
                uint256 at = t.begin(VTree.FIELD_ENUM);
                t.str(label);
                t.be(code, 2);
                t.strFrom(d, p + 3, sLen);
                t.end(at);
            }
            p += 3 + sLen;
        }
        if (!found) revert UnknownEnum();
        return p;
    }

    function _effect(Buf.B memory t, URRender.Ctx memory c, address target, uint256 value, bytes memory cd, bytes memory d, uint256 p, uint256 flags) private view returns (uint256) {
        uint256 kind = d.u8At(p++);
        address token;
        (token, p) = _src(d, p, target, cd);
        if (kind == VDesc.E_IN_VALUE) {
            // What the call's ETH buys, one for one: WETH's deposit.
            c.effects.addDelta(c.cfg.account, token, VSpec.toInt(value), true);
            return p;
        }
        (uint256 a, uint256 nx) = _pos(d, p, cd);
        p = nx;
        uint256 v1 = cd.rdWord(a);
        uint256 v2;
        if (kind != VDesc.E_IN_MIN && kind != VDesc.E_SHARES_MIN) {
            (uint256 b, uint256 nx2) = _pos(d, p, cd);
            p = nx2;
            v2 = cd.rdWord(b);
        }
        VSpec.Effects memory e = c.effects;
        address account = c.cfg.account;
        if (kind == VDesc.E_OUT_EXACT) {
            // (amount, to)
            e.addDelta(account, token, address(uint160(v2)) == account ? int256(0) : -VSpec.toInt(v1), false);
        } else if (kind == VDesc.E_IN_MIN || kind == VDesc.E_SHARES_MIN) {
            e.addDelta(account, token, VSpec.toInt(v1), true);
        } else if (kind == VDesc.E_APPROVE_SET) {
            // (spender, amount)
            e.allowLe(token, address(uint160(v1)), v2);
            if (v2 != 0) _spenderCheck(t, c, address(uint160(v1)));
            if (flags & VDesc.F_UNLIMITED_IF != 0 && v2 >> 255 != 0) {
                t.risk(Risk.UNLIMITED_APPROVAL);
                c.risk |= Risk.BIT_UNLIMITED;
            }
        } else if (kind == VDesc.E_OPERATOR_SET) {
            // (operator, approved)
            if (v2 > 1) revert BadCalldata();
            e.operatorEq(token, address(uint160(v1)), v2 == 1);
            if (v2 == 1) _spenderCheck(t, c, address(uint160(v1)));
            if (flags & VDesc.F_OPERATOR != 0 && v2 == 1) t.risk(Risk.OPERATOR_APPROVAL);
        } else if (kind == VDesc.E_NFT_OUT) {
            // (id, to)
            e.ownerEq(token, v1, address(uint160(v2)));
        } else if (kind == VDesc.E_P2_APPROVE_SET) {
            // token is the path's token field; (spender, amount), the call's target is Permit2.
            if (v2 >> 160 != 0) revert BadCalldata();
            e.p2AllowLe(target, token, address(uint160(v1)), v2);
            if (v2 != 0) _spenderCheck(t, c, address(uint160(v1)));
            t.risk(Risk.PERMIT2_ALLOWANCE_CHANGE);
            if (v2 >= type(uint160).max) {
                t.risk(Risk.UNLIMITED_APPROVAL);
                c.risk |= Risk.BIT_UNLIMITED;
            }
        } else {
            revert VDesc.BadDescriptor();
        }
        return p;
    }

    /// D17: standing permission only goes to spenders the attestors know.
    function _spenderCheck(Buf.B memory t, URRender.Ctx memory c, address spender) private view {
        if (!_spenderIsAttested(spender)) {
            t.risk(Risk.SPENDER_UNATTESTED);
            c.risk |= Risk.BIT_SPENDER_UNATTESTED;
        }
    }

    function _addressField(Buf.B memory t, bytes memory label, address a, uint8 role, URRender.Ctx memory c, Host memory h) private view {
        address account = c.cfg.account;
        bool self = a == account;
        bool hasCode = self;
        if (!self) hasCode = _hinted(h, c.effects, a) != bytes32(0);
        bytes32 name = _nameOf(a);
        if (name != bytes32(0)) c.effects.nameEq(a, _nameResolver(a), name);
        uint256 at = t.begin(VTree.FIELD_ADDRESS);
        t.str(label);
        t.addr(a);
        t.u8(name == bytes32(0) ? 0 : 1);
        t.strPacked(name);
        t.u8((hasCode ? 1 : 0) | (self ? 2 : 0));
        t.end(at);
        if (role == VDesc.ROLE_RECIPIENT && !self) {
            t.risk(Risk.RECIPIENT_NOT_SELF);
            if (hasCode) t.risk(Risk.RECIPIENT_HAS_CODE);
        }
    }

    function _tokenBody(Buf.B memory t, address token, uint256 raw, URRender.Ctx memory c) private view {
        bytes32 symbol;
        uint8 decimals;
        if (token == address(0)) {
            symbol = _ETH;
            decimals = 18;
        } else {
            uint8 flags;
            bool known;
            (symbol, decimals, flags, known) = _tokenInfo(token);
            if (!known) {
                symbol = _UNKNOWN;
                decimals = 0;
                c.risk |= Risk.BIT_UNVERIFIED;
            } else if (flags != 0) {
                c.risk |= Risk.BIT_TOKEN_UNSAFE;
            }
        }
        t.strPacked(symbol);
        t.u8(decimals);
        t.word(raw);
    }

    // "ETH" and "?" as packed strs: text left-aligned, length in the last byte.
    bytes32 private constant _ETH = 0x4554480000000000000000000000000000000000000000000000000000000003;
    bytes32 private constant _UNKNOWN = 0x3f00000000000000000000000000000000000000000000000000000000000001;

    function _amountField(Buf.B memory t, bytes memory label, address token, uint256 raw, URRender.Ctx memory c) private view {
        uint256 at = t.begin(VTree.FIELD_AMOUNT);
        t.str(label);
        t.addr(token);
        _tokenBody(t, token, raw, c);
        t.end(at);
    }

    function _host(URRender.Ctx memory c) private pure returns (Host memory h) {
        assembly ("memory-safe") {
            h := mload(add(c, 0xa0))
        }
    }

    function _urAmount(Buf.B memory t, bytes memory label, address token, uint256 raw, URRender.Ctx memory c) private view {
        _amountField(t, label, token, raw, c);
    }

    function _urAddressField(Buf.B memory t, bytes memory label, address a, URRender.Ctx memory c) private view {
        _addressField(t, label, a, VDesc.ROLE_RECIPIENT, c, _host(c));
    }

    function _urHookAttested(address hook, URRender.Ctx memory c) private view returns (bool) {
        bytes32 ch = _hinted(_host(c), c.effects, hook);
        if (ch == bytes32(0)) return false;
        c.effects.codehashEq(hook, ch);
        return _hookIsAttested(ch);
    }
}
