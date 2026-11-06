// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RenderHarness} from "./Harness.sol";
import {DisplayVM} from "../src/lib/DisplayVM.sol";
import {Test} from "forge-std/Test.sol";

/// Shared fixtures: addresses are constants so vectors match the TypeScript side.
abstract contract TestVectors is Test {
    address internal constant ACCOUNT = address(0xA11CE);
    address internal constant TOKEN = address(0x7070);
    address internal constant TOKEN2 = address(0x8080);
    address internal constant WETH = address(0x9090);
    address internal constant PERMIT2 = address(0x2222);
    address internal constant ROUTER = address(0x3333);
    address internal constant BOB = address(0xB0B);
    bytes32 internal constant TOKEN_CODE = keccak256("token code");
    bytes32 internal constant ROUTER_CODE = keccak256("router code");
    bytes32 internal constant PUBLISHER = 0x556e697377617000000000000000000000000000000000000000000000000007;

    struct CallT {
        address target;
        uint256 value;
        bytes data;
    }

    // "Send tokens"; exactWords 2; To (recipient); Amount (target token); OUT_EXACT.
    bytes internal constant TRANSFER_DESC = hex"564400010b53656e6420746f6b656e73020201000102546f0101010206416d6f756e7400010100010101000000";

    function harness() internal returns (RenderHarness h) {
        h = new RenderHarness(PERMIT2, WETH, PUBLISHER);
        h.setCode(TOKEN, TOKEN_CODE);
        h.setCode(TOKEN2, TOKEN_CODE);
        h.setCode(ROUTER, ROUTER_CODE);
        h.setKind(ROUTER_CODE, 1);
        h.setToken(TOKEN, bytes11("dUSDC"), 5, 6, 0);
        h.setToken(TOKEN2, bytes11("dWETH"), 5, 18, 0);
        h.setDesc(TOKEN_CODE, 0xa9059cbb, TRANSFER_DESC, PUBLISHER, 1, 2);
    }

    function baseIn(bytes memory body, address[] memory hints) internal pure returns (DisplayVM.In memory i) {
        i.chainId = 1337;
        i.account = ACCOUNT;
        i.expiry = 1_800_000_000;
        i.snapshotRoot = keccak256("root");
        i.policyVersion = 1;
        i.path = 2;
        i.feeAsset = address(0);
        i.maxFee = 1e9;
        i.body = body;
        i.hints = hints;
    }

    function body(CallT[] memory calls) internal pure returns (bytes memory) {
        return abi.encode(calls, bytes(""));
    }

    function transferIn(RenderHarness) internal pure returns (DisplayVM.In memory) {
        CallT[] memory calls = new CallT[](1);
        calls[0] = CallT(TOKEN, 0, abi.encodeWithSelector(0xa9059cbb, BOB, uint256(1e6)));
        address[] memory hints = new address[](1);
        hints[0] = TOKEN;
        return baseIn(body(calls), hints);
    }

    struct PoolKeyT {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct SwapT {
        PoolKeyT poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    function swapData(address hook, uint128 minOut) internal pure returns (bytes memory) {
        SwapT memory s = SwapT(PoolKeyT(TOKEN, TOKEN2, 3000, 60, hook), true, 1e6, minOut, 0, "");
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(s);
        params[1] = abi.encode(TOKEN, uint256(1e6));
        params[2] = abi.encode(TOKEN2, uint256(minOut));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0f", params);
        return abi.encodeWithSelector(0x3593564c, hex"10", inputs, uint256(2e9));
    }

    function swapIn(RenderHarness, address hook, uint128 minOut) internal pure returns (DisplayVM.In memory) {
        CallT[] memory calls = new CallT[](1);
        calls[0] = CallT(ROUTER, 0, swapData(hook, minOut));
        address[] memory hints = new address[](hook == address(0) ? 1 : 2);
        hints[0] = ROUTER;
        if (hook != address(0)) hints[1] = hook;
        return baseIn(body(calls), hints);
    }
}
