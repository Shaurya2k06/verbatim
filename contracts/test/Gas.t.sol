// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {RenderHarness} from "./Harness.sol";
import {DisplayVM} from "../src/lib/DisplayVM.sol";
import {TestVectors} from "./TestVectors.sol";

contract GasTest is Test, TestVectors {
    function test_renderGas_transfer() public {
        RenderHarness h = harness();
        uint256 g = h.renderGas(transferIn(h));
        console2.log("transfer render gas", g);
    }

    function test_renderGas_v4swap() public {
        RenderHarness h = harness();
        uint256 g = h.renderGas(swapIn(h, address(0), 1e6));
        console2.log("v4 swap render gas", g);
    }
}
