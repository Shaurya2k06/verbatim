// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Buf} from "./VTree.sol";
import {VSpec} from "./VTree.sol";

/// Snapshot and assertion over VSPEC bytes. Every read is a bounded STATICCALL; a failed read fails the assertion.
library AssertionKit {
    using Buf for bytes;

    error AssertionFailed(uint256 index, uint256 expected, uint256 actual);
    error ReadFailed(address target);
    error BadSpec();

    uint256 internal constant READ_GAS = 100_000;

    uint8 internal constant LEDGER_ERC20 = 1;
    uint8 internal constant LEDGER_PERMIT2 = 2;
    uint8 internal constant LEDGER_OPERATOR = 3;

    struct LedgerEntry {
        uint8 kind;
        address token;
        address spender;
        address permit2;
    }

    struct Pre {
        address[] assets;
        uint256[] balances;
        address[] holders;
        address[] holderAssets;
        uint256[] holderBalances;
        uint256[] p2;
        uint256[] allowances;
    }

    function _read(address target, bytes memory data) private view returns (uint256 v) {
        (bool ok, bytes memory out) = target.staticcall{gas: READ_GAS}(data);
        if (!ok || out.length < 32) revert ReadFailed(target);
        v = abi.decode(out, (uint256));
    }

    function balance(address holder, address asset) internal view returns (uint256) {
        if (asset == address(0)) return holder.balance;
        return _read(asset, abi.encodeWithSelector(0x70a08231, holder));
    }

    function erc20Allowance(address token, address owner, address spender) internal view returns (uint256) {
        return _read(token, abi.encodeWithSelector(0xdd62ed3e, owner, spender));
    }

    function p2Allowance(address permit2, address owner, address token, address spender) internal view returns (uint256) {
        // allowance(owner, token, spender) -> (uint160 amount, uint48 expiration, uint48 nonce); first word is amount.
        return _read(permit2, abi.encodeWithSelector(0x927da105, owner, token, spender));
    }

    function isOperator(address collection, address owner, address operator) internal view returns (bool) {
        return _read(collection, abi.encodeWithSelector(0xe985e9c5, owner, operator)) != 0;
    }

    function ownerOf(address collection, uint256 id) internal view returns (address) {
        return address(uint160(_read(collection, abi.encodeWithSelector(0x6352211e, id))));
    }

    function ledgerRead(LedgerEntry memory l, address owner) internal view returns (uint256) {
        if (l.kind == LEDGER_ERC20) return erc20Allowance(l.token, owner, l.spender);
        if (l.kind == LEDGER_PERMIT2) return p2Allowance(l.permit2, owner, l.token, l.spender);
        return isOperator(l.token, owner, l.spender) ? 1 : 0;
    }

    /// Walks a spec, calling `visit`-style logic through the returned cursor. Item sizes, excluding the op byte.
    function itemSize(uint8 op) internal pure returns (uint256) {
        if (op == VSpec.DELTA_EQ || op == VSpec.DELTA_GE) return 72;
        if (op == VSpec.ALLOW_LE) return 72;
        if (op == VSpec.P2ALLOW_LE) return 81;
        if (op == VSpec.OPERATOR_EQ) return 41;
        if (op == VSpec.OWNER_EQ) return 72;
        if (op == VSpec.CODEHASH_EQ) return 52;
        if (op == VSpec.NO_CODE) return 20;
        if (op == VSpec.TRACKED_NO_DECREASE || op == VSpec.TRACKED_NO_ALLOW_INC) return 0;
        if (op == VSpec.ACCOUNT_INVARIANT) return 1;
        if (op == VSpec.IMPL_EQ) return 44;
        revert BadSpec();
    }

    function header(bytes memory spec) internal pure returns (uint256 n) {
        if (spec.rdBe(0, 4) != VSpec.MAGIC) revert BadSpec();
        n = spec.rdBe(4, 2);
    }

    function addrAt(bytes memory s, uint256 p) internal pure returns (address) {
        return address(uint160(s.rdBe(p, 20)));
    }
}
