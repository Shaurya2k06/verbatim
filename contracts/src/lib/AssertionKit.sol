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

    function itemSize(uint8 op) internal pure returns (uint256) {
        return VSpec.itemSize(op);
    }

    function header(bytes memory spec) internal pure returns (uint256 n) {
        if (spec.rdBe(0, 4) != VSpec.MAGIC) revert BadSpec();
        n = spec.rdBe(4, 2);
    }

    /// DNS-encodes a packed `label.label` ASCII name, and asks its resolver for the name's address.
    function resolveAddr(address resolver, bytes32 packed) internal view returns (address) {
        uint256 n = uint256(packed) & 0xff;
        bytes memory dns = new bytes(n + 2);
        uint256 lenAt = 0;
        uint256 count = 0;
        for (uint256 i = 0; i < n; i++) {
            bytes1 c = packed[i];
            if (c == ".") {
                dns[lenAt] = bytes1(uint8(count));
                lenAt = i + 1;
                count = 0;
            } else {
                dns[i + 1] = c;
                count++;
            }
        }
        dns[lenAt] = bytes1(uint8(count));
        // dns[n + 1] is the root terminator, already zero.
        (bool ok, bytes memory out) = resolver.staticcall{gas: READ_GAS}(abi.encodeWithSignature("resolve(bytes,bytes)", dns, abi.encodeWithSignature("addr(bytes32)", bytes32(0))));
        if (!ok) revert ReadFailed(resolver);
        return abi.decode(abi.decode(out, (bytes)), (address));
    }

    function addrAt(bytes memory s, uint256 p) internal pure returns (address) {
        return address(uint160(s.rdBe(p, 20)));
    }
}
