// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Buf} from "./VTree.sol";

/// VDesc v1 (docs/VDESC.md). `validate` runs at attestation time, so rendering can trust the structure of what it reads.
library VDesc {
    using Buf for bytes;

    error BadDescriptor();

    uint32 internal constant MAGIC = 0x56440001;

    uint8 internal constant K_ADDRESS = 1;
    uint8 internal constant K_TOKEN_AMOUNT = 2;
    uint8 internal constant K_UINT = 3;
    uint8 internal constant K_BOOL = 4;
    uint8 internal constant K_ENUM = 5;
    uint8 internal constant K_BYTES = 6;
    uint8 internal constant K_CALLDATA = 7;
    uint8 internal constant K_ETH_VALUE = 8;

    uint8 internal constant E_OUT_EXACT = 1;
    uint8 internal constant E_IN_MIN = 2;
    uint8 internal constant E_APPROVE_SET = 3;
    uint8 internal constant E_OPERATOR_SET = 4;
    uint8 internal constant E_SHARES_MIN = 5;
    uint8 internal constant E_NFT_OUT = 6;
    uint8 internal constant E_P2_APPROVE_SET = 7;

    uint8 internal constant SRC_TARGET = 0;
    uint8 internal constant SRC_FIELD = 1;
    uint8 internal constant SRC_CONST = 2;

    uint8 internal constant ROLE_OTHER = 0;
    uint8 internal constant ROLE_RECIPIENT = 1;

    uint256 internal constant F_UNLIMITED_IF = 1;
    uint256 internal constant F_OPERATOR = 2;
    uint256 internal constant F_ADMIN = 4;

    uint256 internal constant EXACT_UNCHECKED = 0xff;
    uint256 internal constant MAX_PATH = 8;

    function validStr(bytes memory d, uint256 p) internal pure returns (uint256 next) {
        uint256 n = d.rdU8(p);
        if (n > 48 || p + 1 + n > d.length) revert BadDescriptor();
        for (uint256 i = 0; i < n; i++) {
            uint256 c = d.rdU8(p + 1 + i);
            if (c < 0x20 || c > 0x7e || c == 0x5c) revert BadDescriptor();
        }
        next = p + 1 + n;
    }

    function _path(bytes memory d, uint256 p) private pure returns (uint256) {
        uint256 n = d.rdU8(p);
        if (n > MAX_PATH || p + 1 + n > d.length) revert BadDescriptor();
        return p + 1 + n;
    }

    function _src(bytes memory d, uint256 p) private pure returns (uint256) {
        uint256 kind = d.rdU8(p);
        if (kind == SRC_TARGET) return p + 1;
        if (kind == SRC_FIELD) return _path(d, p + 1);
        if (kind == SRC_CONST) return p + 21;
        revert BadDescriptor();
    }

    function validate(bytes memory d) internal pure {
        if (d.rdBe(0, 4) != MAGIC) revert BadDescriptor();
        uint256 p = validStr(d, 4);
        p += 1; // exactWords
        uint256 nFields = d.rdU8(p++);
        for (uint256 i = 0; i < nFields; i++) {
            p = _path(d, p);
            uint256 kind = d.rdU8(p++);
            p = validStr(d, p);
            if (kind == K_ADDRESS) {
                p += 1;
            } else if (kind == K_TOKEN_AMOUNT) {
                p = _src(d, p);
            } else if (kind == K_UINT) {
                p += 1;
            } else if (kind == K_ENUM) {
                uint256 n = d.rdU8(p++);
                for (uint256 j = 0; j < n; j++) p = validStr(d, p + 2);
            } else if (kind == K_CALLDATA) {
                uint256 tk = d.rdU8(p++);
                if (tk > 1) revert BadDescriptor();
                if (tk == 1) p = _path(d, p);
                uint256 vk = d.rdU8(p++);
                if (vk > 1) revert BadDescriptor();
                if (vk == 1) p = _path(d, p);
            } else if (kind != K_BOOL && kind != K_BYTES && kind != K_ETH_VALUE) {
                revert BadDescriptor();
            }
        }
        uint256 nEffects = d.rdU8(p++);
        for (uint256 i = 0; i < nEffects; i++) {
            uint256 kind = d.rdU8(p++);
            if (kind == 0 || kind > E_P2_APPROVE_SET) revert BadDescriptor();
            p = _src(d, p);
            p = _path(d, p);
            if (kind != E_IN_MIN && kind != E_SHARES_MIN) p = _path(d, p);
        }
        if (p + 2 != d.length) revert BadDescriptor();
    }
}
