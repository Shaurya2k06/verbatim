// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Buf, VTree, VSpec, Risk} from "../lib/VTree.sol";
import {HookFlags} from "./HookFlags.sol";

/// On-chain human-readable decoding of Universal Router calldata, with v4 hook risk from the hook address bits.
/// Emits VTREE nodes and VSPEC effects; pure over its input plus three caller-supplied lookups, so anyone can use it
/// without the rest of Verbatim. Anything not on the whitelist renders as an unbounded BLIND and fails closed.
///
/// Whitelist and layouts checked against Uniswap/universal-router main (Commands.sol, Dispatcher.sol) and
/// Uniswap/v4-periphery main (Actions.sol, CalldataDecoder.sol, IV4Router.sol).
library URRender {
    using Buf for Buf.B;
    using Buf for bytes;
    using VTree for Buf.B;
    using VSpec for VSpec.Effects;

    error MalformedUR();
    error UnsupportedETHFlow();

    bytes4 internal constant EXECUTE_DEADLINE = 0x3593564c;
    bytes4 internal constant EXECUTE = 0x24856bc3;

    uint8 internal constant FLAG_ALLOW_REVERT = 0x80;
    uint8 internal constant COMMAND_MASK = 0x7f;
    uint8 internal constant V3_SWAP_EXACT_IN = 0x00;
    uint8 internal constant SWEEP = 0x04;
    uint8 internal constant PAY_PORTION = 0x06;
    uint8 internal constant WRAP_ETH = 0x0b;
    uint8 internal constant UNWRAP_WETH = 0x0c;
    uint8 internal constant V4_SWAP = 0x10;

    uint8 internal constant SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 internal constant SWAP_EXACT_IN = 0x07;
    uint256 internal constant MAX_HOPS = 4;
    uint8 internal constant SETTLE_ALL = 0x0c;
    uint8 internal constant TAKE_ALL = 0x0f;

    address internal constant MSG_SENDER = address(1);
    address internal constant ADDRESS_THIS = address(2);
    uint256 internal constant CONTRACT_BALANCE = 1 << 255;

    struct Config {
        address router;
        address account;
        address permit2;
        address weth;
        /// Older routers (such as the official Sepolia one) have no minHopPriceX36 in ExactInputSingleParams.
        bool legacyParams;
    }

    struct Lookups {
        /// Emits a FIELD_AMOUNT for a token.
        function(Buf.B memory, bytes memory, address, uint256, Ctx memory) view amount;
        /// True if the hook's code is attested. May also record the hook's code in the effects.
        function(address, Ctx memory) view returns (bool) hookAttested;
        /// Emits a FIELD_ADDRESS, with its code and recipient checks.
        function(Buf.B memory, bytes memory, address, Ctx memory) view addressField;
    }

    struct Ctx {
        Config cfg;
        Lookups fn;
        VSpec.Effects effects;
        uint256 risk;
        uint256 value;
        /// Free for the host (a pointer to its own context).
        uint256 host;
    }

    /// `data` is the full call data of the router call, selector included.
    function render(Buf.B memory t, bytes memory data, Ctx memory c) internal view {
        if (data.length < 4) revert MalformedUR();
        bytes4 sel = bytes4(uint32(data.rdBe(0, 4)));
        bool hasDeadline = sel == EXECUTE_DEADLINE;
        if (!hasDeadline && sel != EXECUTE) {
            t.blind("router call", keccak256(data), data.length);
            c.risk |= Risk.BIT_BLIND;
            return;
        }
        uint256 base = 4;
        (uint256 cmdOff, uint256 nCmd) = _dyn(data, base, 0);
        uint256 inputsPtr = base + _ptr(data, base, 1);
        uint256 nInputs = data.rdWord(inputsPtr);
        if (nInputs != nCmd || nCmd > 16) revert MalformedUR();
        if (hasDeadline) t.fieldUint("Deadline", data.rdWord(base + 64), VTree.UNIT_TIMESTAMP);

        for (uint256 i = 0; i < nCmd; i++) {
            uint256 raw = data.rdU8(cmdOff + i);
            uint256 elem = inputsPtr + 32 + data.rdWord(inputsPtr + 32 + i * 32);
            uint256 len = data.rdWord(elem);
            uint256 inp = elem + 32;
            if (inp + len > data.length) revert MalformedUR();
            if (raw & FLAG_ALLOW_REVERT != 0) {
                t.risk(Risk.UR_ALLOW_REVERT);
                c.risk |= Risk.BIT_ALLOW_REVERT;
            }
            _command(t, data, uint8(raw & COMMAND_MASK), inp, len, c);
        }
    }

    function _command(Buf.B memory t, bytes memory d, uint8 cmd, uint256 inp, uint256 len, Ctx memory c) private view {
        if (cmd == V4_SWAP) {
            _v4Swap(t, d, inp, len, c);
        } else if (cmd == WRAP_ETH) {
            _wrap(t, d, inp, len, c);
        } else if (cmd == UNWRAP_WETH) {
            _unwrap(t, d, inp, len, c);
        } else if (cmd == SWEEP) {
            _sweep(t, d, inp, len, c);
        } else if (cmd == PAY_PORTION) {
            _payPortion(t, d, inp, len, c);
        } else if (cmd == V3_SWAP_EXACT_IN) {
            _v3Swap(t, d, inp, len, c);
        } else {
            t.groupBegin("Unsupported command");
            t.blind("command input", d.hashRange(inp, len), len);
            t.groupEnd();
            c.risk |= Risk.BIT_BLIND;
        }
    }

    /// ABI head pointer at word `i`, relative to `base`.
    function _ptr(bytes memory d, uint256 base, uint256 i) private pure returns (uint256) {
        return d.rdWord(base + i * 32);
    }

    /// Offset and length of a dynamic `bytes` at head word `i`.
    function _dyn(bytes memory d, uint256 base, uint256 i) private pure returns (uint256 off, uint256 n) {
        uint256 at = base + _ptr(d, base, i);
        n = d.rdWord(at);
        off = at + 32;
        if (off + n > d.length) revert MalformedUR();
    }

    function _word(bytes memory d, uint256 inp, uint256 len, uint256 i) private pure returns (uint256) {
        if ((i + 1) * 32 > len) revert MalformedUR();
        return d.rdWord(inp + i * 32);
    }

    function _addrArg(bytes memory d, uint256 inp, uint256 len, uint256 i) private pure returns (address) {
        uint256 v = _word(d, inp, len, i);
        if (v >> 160 != 0) revert MalformedUR();
        return address(uint160(v));
    }

    /// Output recipient, with the router's own mapping (Dispatcher `map`): 1 is the caller, 2 the router.
    function _recipient(Buf.B memory t, address r, Ctx memory c) private view returns (address resolved) {
        if (r == MSG_SENDER) {
            resolved = c.cfg.account;
            c.fn.addressField(t, "Recipient", resolved, c);
        } else if (r == ADDRESS_THIS) {
            resolved = c.cfg.router;
            uint256 at = t.begin(VTree.FIELD_ENUM);
            t.str("Recipient");
            t.be(2, 2);
            t.str("ROUTER (transient)");
            t.end(at);
        } else {
            resolved = r;
            c.fn.addressField(t, "Recipient", r, c);
        }
    }

    function _v4Swap(Buf.B memory t, bytes memory d, uint256 inp, uint256 len, Ctx memory c) private view {
        t.groupBegin("Uniswap v4 swap");
        // Strict layout, as in CalldataDecoder.decodeActionsRouterParams.
        if (_word(d, inp, len, 0) != 0x40) revert MalformedUR();
        uint256 nActions = _word(d, inp, len, 2);
        if (nActions % 3 != 0 || nActions == 0 || nActions > 12) revert MalformedUR();
        uint256 actions = inp + 96;
        uint256 paramsLenOff = ((nActions + 31) & ~uint256(31)) + 0x60;
        if (_word(d, inp, len, 1) != paramsLenOff || paramsLenOff + 32 > len) revert MalformedUR();
        uint256 pArr = inp + paramsLenOff + 32;
        if (d.rdWord(pArr - 32) != nActions) revert MalformedUR();

        for (uint256 i = 0; i < nActions; i += 3) {
            uint256 swapAction = d.rdU8(actions + i);
            bool known = (swapAction == SWAP_EXACT_IN_SINGLE || swapAction == SWAP_EXACT_IN) && d.rdU8(actions + i + 1) == SETTLE_ALL && d.rdU8(actions + i + 2) == TAKE_ALL;
            if (!known) {
                t.blind("v4 actions", d.hashRange(inp, len), len);
                c.risk |= Risk.BIT_BLIND;
                t.groupEnd();
                return;
            }
            if (swapAction == SWAP_EXACT_IN) _v4Multi(t, d, pArr, i, inp + len, c);
            else _v4Single(t, d, pArr, i, inp + len, c);
        }
        t.groupEnd();
    }

    function _param(bytes memory d, uint256 pArr, uint256 i, uint256 end) private pure returns (uint256 off, uint256 n) {
        uint256 at = pArr + d.rdWord(pArr + i * 32);
        n = d.rdWord(at);
        off = at + 32;
        if (off + n > end) revert MalformedUR();
    }

    function _v4Single(Buf.B memory t, bytes memory d, uint256 pArr, uint256 i, uint256 end, Ctx memory c) private view {
        (uint256 p, uint256 pn) = _param(d, pArr, i, end);
        bool legacy = c.cfg.legacyParams;
        if (pn < (legacy ? 0x140 : 0x160)) revert MalformedUR();
        uint256 s = p + d.rdWord(p);
        address c0 = d.rdAddr(s);
        address c1 = d.rdAddr(s + 32);
        uint256 fee = d.rdWord(s + 64);
        uint256 spacing = d.rdWord(s + 96);
        address hook = d.rdAddr(s + 128);
        uint256 z = d.rdWord(s + 160);
        if (z > 1) revert MalformedUR();
        uint256 amountIn = d.rdWord(s + 192);
        uint256 minOut = d.rdWord(s + 224);
        uint256 minHop = legacy ? 0 : d.rdWord(s + 256);
        uint256 hd = s + d.rdWord(s + (legacy ? 256 : 288));
        uint256 hdLen = d.rdWord(hd);
        if (amountIn == 0 || amountIn >> 128 != 0 || minOut >> 128 != 0) revert MalformedUR();

        (uint256 sp, uint256 sn) = _param(d, pArr, i + 1, end);
        (uint256 tp, uint256 tn) = _param(d, pArr, i + 2, end);
        if (sn < 64 || tn < 64) revert MalformedUR();
        address tokenIn = z == 1 ? c0 : c1;
        address tokenOut = z == 1 ? c1 : c0;
        if (d.rdAddr(sp) != tokenIn || d.rdAddr(tp) != tokenOut) revert MalformedUR();
        uint256 maxIn = d.rdWord(sp + 32);
        uint256 takeMin = d.rdWord(tp + 32);
        uint256 min = takeMin > minOut ? takeMin : minOut;

        c.fn.amount(t, "You pay", tokenIn, amountIn, c);
        c.fn.amount(t, "Minimum received", tokenOut, min, c);
        // Fields that only restate the defaults stay out, to keep the sentence short and cheap.
        if (maxIn != amountIn) c.fn.amount(t, "Maximum paid", tokenIn, maxIn, c);
        t.fieldUint("Pool fee", fee, VTree.UNIT_NONE);
        if (minHop != 0) t.fieldUint("Min hop price", minHop, VTree.UNIT_NONE);
        if (hdLen != 0) t.fieldBytes("Hook data", d.hashRange(hd + 32, hdLen), hdLen);

        if (min == 0) {
            t.risk(Risk.NO_MIN_OUT);
            c.risk |= Risk.BIT_NO_MIN_OUT;
        }
        _poolRisks(t, fee, hook, c);

        _swapEffects(tokenIn, tokenOut, amountIn, min, c);
    }

    function _poolRisks(Buf.B memory t, uint256 fee, address hook, Ctx memory c) private view {
        if (fee == HookFlags.DYNAMIC_FEE) t.risk(Risk.HOOK_DYNAMIC_FEE);
        if (hook != address(0)) {
            if (HookFlags.canTakeInput(hook)) {
                t.risk(Risk.HOOK_CAN_TAKE_INPUT);
                c.risk |= Risk.BIT_HOOK_TAKE;
            }
            if (HookFlags.canTakeOutput(hook)) {
                t.risk(Risk.HOOK_CAN_TAKE_OUTPUT);
                c.risk |= Risk.BIT_HOOK_TAKE;
            }
            if (!c.fn.hookAttested(hook, c)) {
                t.risk(Risk.HOOK_UNVERIFIED);
                c.risk |= Risk.BIT_HOOK_UNVERIFIED;
            }
        }
    }

    function _swapEffects(address tokenIn, address tokenOut, uint256 amountIn, uint256 min, Ctx memory c) private pure {
        address account = c.cfg.account;
        c.effects.addDelta(account, tokenOut, VSpec.toInt(min), true);
        if (tokenIn == address(0)) {
            // Native input settles from msg.value, which the call's own value effect already took. Exactly that much: anything
            // more would sit in the router for the next caller to sweep.
            if (c.value != amountIn) revert UnsupportedETHFlow();
        } else {
            c.effects.addDelta(account, tokenIn, -VSpec.toInt(amountIn), false);
            c.effects.p2AllowLe(c.cfg.permit2, tokenIn, c.cfg.router, 0);
        }
    }

    /// SWAP_EXACT_IN: ExactInputParams, where the older router's layout has no per-hop price array.
    function _v4Multi(Buf.B memory t, bytes memory d, uint256 pArr, uint256 i, uint256 end, Ctx memory c) private view {
        (uint256 p, uint256 pn) = _param(d, pArr, i, end);
        bool legacy = c.cfg.legacyParams;
        if (pn < 0x20) revert MalformedUR();
        uint256 s = p + d.rdWord(p);
        address tokenIn = d.rdAddr(s);
        uint256 path = s + d.rdWord(s + 32);
        uint256 amountIn = d.rdWord(s + (legacy ? 64 : 96));
        uint256 minOut = d.rdWord(s + (legacy ? 96 : 128));
        uint256 hops = d.rdWord(path);
        if (hops == 0 || hops > MAX_HOPS || amountIn == 0 || amountIn >> 128 != 0 || minOut >> 128 != 0) revert MalformedUR();
        uint256 pathEls = path + 32;

        // The output is the last hop's currency, which must also be what TAKE_ALL takes.
        uint256 last = pathEls + d.rdWord(pathEls + (hops - 1) * 32);
        address tokenOut = d.rdAddr(last);
        (uint256 sp, uint256 sn) = _param(d, pArr, i + 1, end);
        (uint256 tp, uint256 tn) = _param(d, pArr, i + 2, end);
        if (sn < 64 || tn < 64) revert MalformedUR();
        if (d.rdAddr(sp) != tokenIn || d.rdAddr(tp) != tokenOut) revert MalformedUR();
        uint256 maxIn = d.rdWord(sp + 32);
        uint256 takeMin = d.rdWord(tp + 32);
        uint256 min = takeMin > minOut ? takeMin : minOut;

        c.fn.amount(t, "You pay", tokenIn, amountIn, c);
        c.fn.amount(t, "Minimum received", tokenOut, min, c);
        if (maxIn != amountIn) c.fn.amount(t, "Maximum paid", tokenIn, maxIn, c);
        if (min == 0) {
            t.risk(Risk.NO_MIN_OUT);
            c.risk |= Risk.BIT_NO_MIN_OUT;
        }
        for (uint256 h = 0; h < hops; h++) {
            uint256 el = pathEls + d.rdWord(pathEls + h * 32);
            address via = d.rdAddr(el);
            uint256 fee = d.rdWord(el + 32);
            address hook = d.rdAddr(el + 96);
            uint256 hd = el + d.rdWord(el + 128);
            uint256 hdLen = d.rdWord(hd);
            if (h + 1 < hops) c.fn.amount(t, "Through", via, 0, c);
            t.fieldUint("Pool fee", fee, VTree.UNIT_NONE);
            if (hdLen != 0) t.fieldBytes("Hook data", d.hashRange(hd + 32, hdLen), hdLen);
            _poolRisks(t, fee, hook, c);
        }
        _swapEffects(tokenIn, tokenOut, amountIn, min, c);
    }

    function _wrap(Buf.B memory t, bytes memory d, uint256 inp, uint256 len, Ctx memory c) private view {
        t.groupBegin("Wrap ETH");
        address r = _addrArg(d, inp, len, 0);
        uint256 amount = _word(d, inp, len, 1);
        if (amount != c.value || amount == CONTRACT_BALANCE) revert UnsupportedETHFlow();
        c.fn.amount(t, "Wrap", address(0), amount, c);
        address to = _recipient(t, r, c);
        if (to != c.cfg.router) {
            if (to == c.cfg.account) {
                c.effects.addDelta(to, c.cfg.weth, VSpec.toInt(amount), false);
            } else {
                c.effects.addDelta(to, c.cfg.weth, VSpec.toInt(amount), true);
            }
        }
        t.groupEnd();
    }

    function _unwrap(Buf.B memory t, bytes memory d, uint256 inp, uint256 len, Ctx memory c) private view {
        t.groupBegin("Unwrap WETH");
        address r = _addrArg(d, inp, len, 0);
        uint256 min = _word(d, inp, len, 1);
        c.fn.amount(t, "Minimum received", address(0), min, c);
        address to = _recipient(t, r, c);
        if (to == c.cfg.account) c.effects.addDelta(to, address(0), VSpec.toInt(min), true);
        t.groupEnd();
    }

    function _sweep(Buf.B memory t, bytes memory d, uint256 inp, uint256 len, Ctx memory c) private view {
        t.groupBegin("Sweep");
        address token = _addrArg(d, inp, len, 0);
        address r = _addrArg(d, inp, len, 1);
        uint256 min = _word(d, inp, len, 2);
        c.fn.amount(t, "Minimum swept", token, min, c);
        address to = _recipient(t, r, c);
        if (to != c.cfg.account) t.risk(Risk.SWEEP_TO_OTHER);
        c.effects.addDelta(to, token, VSpec.toInt(min), true);
        t.groupEnd();
    }

    function _payPortion(Buf.B memory t, bytes memory d, uint256 inp, uint256 len, Ctx memory c) private view {
        t.groupBegin("Pay portion");
        address token = _addrArg(d, inp, len, 0);
        address r = _addrArg(d, inp, len, 1);
        uint256 bips = _word(d, inp, len, 2);
        c.fn.amount(t, "Token", token, 0, c);
        t.fieldUint("Portion", bips, VTree.UNIT_BIPS);
        address to = _recipient(t, r, c);
        if (to != c.cfg.account) t.risk(Risk.SWEEP_TO_OTHER);
        t.groupEnd();
    }

    function _v3Swap(Buf.B memory t, bytes memory d, uint256 inp, uint256 len, Ctx memory c) private view {
        t.groupBegin("Uniswap v3 swap");
        address r = _addrArg(d, inp, len, 0);
        uint256 amountIn = _word(d, inp, len, 1);
        uint256 minOut = _word(d, inp, len, 2);
        uint256 payer = _word(d, inp, len, 4);
        if (payer > 1 || amountIn == 0 || amountIn == CONTRACT_BALANCE) revert MalformedUR();
        uint256 pathAt = inp + _word(d, inp, len, 3);
        uint256 pathLen = d.rdWord(pathAt);
        uint256 path = pathAt + 32;
        if (pathLen < 43 || (pathLen - 20) % 23 != 0 || path + pathLen > inp + len) revert MalformedUR();
        address tokenIn = address(uint160(d.rdBe(path, 20)));
        address tokenOut = address(uint160(d.rdBe(path + pathLen - 20, 20)));

        c.fn.amount(t, "You pay", tokenIn, amountIn, c);
        c.fn.amount(t, "Minimum received", tokenOut, minOut, c);
        uint256 hops = (pathLen - 20) / 23;
        for (uint256 h = 0; h < hops; h++) {
            uint256 at = path + 20 + h * 23;
            t.fieldUint("Hop fee", d.rdBe(at, 3), VTree.UNIT_NONE);
            c.fn.amount(t, "Hop token", address(uint160(d.rdBe(at + 3, 20))), 0, c);
        }
        address to = _recipient(t, r, c);
        if (minOut == 0) {
            t.risk(Risk.NO_MIN_OUT);
            c.risk |= Risk.BIT_NO_MIN_OUT;
        }
        if (payer == 1) {
            c.effects.addDelta(c.cfg.account, tokenIn, -VSpec.toInt(amountIn), false);
            c.effects.p2AllowLe(c.cfg.permit2, tokenIn, c.cfg.router, 0);
        }
        if (to != c.cfg.router) c.effects.addDelta(to, tokenOut, VSpec.toInt(minOut), true);
        t.groupEnd();
    }
}
