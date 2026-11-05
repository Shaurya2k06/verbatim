// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RenderHarness} from "./Harness.sol";
import {TestVectors} from "./TestVectors.sol";
import {DisplayVM} from "../src/lib/DisplayVM.sol";
import {HookFlags} from "../src/uniswap/HookFlags.sol";
import {URRender} from "../src/uniswap/URRender.sol";
import {Risk} from "../src/lib/VTree.sol";

/// The constants exactly as Uniswap publishes them (see the README's pinned commits). A hard-coded copy on purpose:
/// if ours drift from these, the test says so.
library UpstreamHooks {
    uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 internal constant AFTER_SWAP_FLAG = 1 << 6;
    uint160 internal constant BEFORE_SWAP_FLAG = 1 << 7;
    uint160 internal constant BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 3;
    uint160 internal constant AFTER_SWAP_RETURNS_DELTA_FLAG = 1 << 2;
    uint24 internal constant DYNAMIC_FEE_FLAG = 0x800000;
}

contract URRenderTest is Test, TestVectors {
    function _codes(bytes memory tree) private pure returns (uint256 mask) {
        uint256 p = 4 + 8 + 20 + 8 + 8 + 8;
        while (p < tree.length) {
            uint8 kind = uint8(tree[p]);
            uint256 len = (uint256(uint8(tree[p + 1])) << 8) | uint8(tree[p + 2]);
            if (kind == 0x30) {
                uint256 code = (uint256(uint8(tree[p + 3])) << 8) | uint8(tree[p + 4]);
                if (code == 0x0101) mask |= 1;
                if (code == 0x0102) mask |= 2;
                if (code == 0x0103) mask |= 4;
                if (code == 0x0104) mask |= 8;
                if (code == 0x0105) mask |= 16;
                if (code == 0x0106) mask |= 32;
                if (code == 0x0108) mask |= 64;
            }
            p += 3 + len;
        }
    }

    function test_hook_flags_match_uniswap_hooks_sol() public pure {
        assertEq(HookFlags.BEFORE_SWAP_RETURNS_DELTA, UpstreamHooks.BEFORE_SWAP_RETURNS_DELTA_FLAG);
        assertEq(HookFlags.AFTER_SWAP_RETURNS_DELTA, UpstreamHooks.AFTER_SWAP_RETURNS_DELTA_FLAG);
        assertEq(HookFlags.DYNAMIC_FEE, UpstreamHooks.DYNAMIC_FEE_FLAG);
    }

    function testFuzz_risk_nodes_follow_address_bits(uint160 raw) public {
        address hook = address(raw | (1 << 20)); // never the zero hook
        RenderHarness h = harness();
        h.setCode(hook, keccak256("a hook"));
        (bytes memory tree, , ) = h.render(swapIn(h, hook, 1e6));
        uint256 m = _codes(tree);
        assertEq(m & 2 != 0, uint160(hook) & UpstreamHooks.BEFORE_SWAP_RETURNS_DELTA_FLAG != 0, "input");
        assertEq(m & 4 != 0, uint160(hook) & UpstreamHooks.AFTER_SWAP_RETURNS_DELTA_FLAG != 0, "output");
        assertTrue(m & 16 != 0, "unattested");
    }

    function test_no_hook_no_hook_nodes() public {
        RenderHarness h = harness();
        (bytes memory tree, , uint256 risk) = h.render(swapIn(h, address(0), 1e6));
        assertEq(_codes(tree), 0);
        assertEq(risk, 0);
    }

    function test_attested_hook_is_not_unverified() public {
        RenderHarness h = harness();
        address hook = address(0x4044);
        h.setCode(hook, keccak256("good hook"));
        h.setHook(keccak256("good hook"), true);
        (bytes memory tree, , uint256 risk) = h.render(swapIn(h, hook, 1e6));
        assertEq(_codes(tree) & 16, 0);
        assertTrue(risk & Risk.BIT_HOOK_TAKE != 0);
    }

    function test_no_min_out_is_flagged() public {
        RenderHarness h = harness();
        (bytes memory tree, , uint256 risk) = h.render(swapIn(h, address(0), 0));
        assertEq(_codes(tree) & 1, 1);
        assertTrue(risk & Risk.BIT_NO_MIN_OUT != 0);
    }

    function _withData(RenderHarness, bytes memory data, uint256 value) private pure returns (DisplayVM.In memory) {
        CallT[] memory calls = new CallT[](1);
        calls[0] = CallT(ROUTER, value, data);
        address[] memory hints = new address[](1);
        hints[0] = ROUTER;
        return baseIn(body(calls), hints);
    }

    function test_unknown_command_renders_blind() public {
        RenderHarness h = harness();
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = hex"1234";
        (, , uint256 risk) = h.render(_withData(h, abi.encodeWithSelector(0x3593564c, hex"0a", inputs, uint256(1)), 0));
        assertTrue(risk & Risk.BIT_BLIND != 0, "PERMIT2_PERMIT is refused");
    }

    function test_unknown_router_selector_renders_blind() public {
        RenderHarness h = harness();
        (, , uint256 risk) = h.render(_withData(h, hex"deadbeef", 0));
        assertTrue(risk & Risk.BIT_BLIND != 0);
    }

    function test_allow_revert_flag_is_flagged_and_masked_as_upstream() public {
        RenderHarness h = harness();
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(TOKEN, address(1), uint256(5));
        (bytes memory tree, , ) = h.render(_withData(h, abi.encodeWithSelector(0x3593564c, hex"84", inputs, uint256(1)), 0));
        assertEq(_codes(tree) & 64, 64);
    }

    function test_mismatched_inputs_fail_closed() public {
        RenderHarness h = harness();
        bytes[] memory inputs = new bytes[](2);
        vm.expectRevert(URRender.MalformedUR.selector);
        h.render(_withData(h, abi.encodeWithSelector(0x3593564c, hex"10", inputs, uint256(1)), 0));
    }

    function test_wrap_must_match_value() public {
        RenderHarness h = harness();
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(1), uint256(5));
        vm.expectRevert(URRender.UnsupportedETHFlow.selector);
        h.render(_withData(h, abi.encodeWithSelector(0x3593564c, hex"0b", inputs, uint256(1)), 4));
        (bytes memory tree, bytes memory spec, ) = h.render(_withData(h, abi.encodeWithSelector(0x3593564c, hex"0b", inputs, uint256(1)), 5));
        assertGt(tree.length, 0);
        assertGt(spec.length, 0);
    }

    function test_sweep_elsewhere_is_flagged() public {
        RenderHarness h = harness();
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(TOKEN, BOB, uint256(5));
        (bytes memory tree, , ) = h.render(_withData(h, abi.encodeWithSelector(0x3593564c, hex"04", inputs, uint256(1)), 0));
        assertEq(_codes(tree) & 32, 32);
    }
}
