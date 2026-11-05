// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Hook permission bits, as in Uniswap/v4-core src/libraries/Hooks.sol (lines 44-45), and the dynamic-fee flag
/// from src/libraries/LPFeeLibrary.sol (line 15).
library HookFlags {
    uint160 internal constant BEFORE_SWAP_RETURNS_DELTA = 1 << 3;
    uint160 internal constant AFTER_SWAP_RETURNS_DELTA = 1 << 2;
    uint24 internal constant DYNAMIC_FEE = 0x800000;

    function canTakeInput(address hook) internal pure returns (bool) {
        return uint160(hook) & BEFORE_SWAP_RETURNS_DELTA != 0;
    }

    function canTakeOutput(address hook) internal pure returns (bool) {
        return uint160(hook) & AFTER_SWAP_RETURNS_DELTA != 0;
    }
}
