// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Immutable blobs stored as contract code, prefixed with STOP so the pointer can never be executed meaningfully.
library SSTORE2 {
    error WriteFailed();

    function write(bytes memory data) internal returns (address ptr) {
        bytes memory code = abi.encodePacked(hex"61", uint16(data.length + 1), hex"80600a3d393df300", data);
        assembly ("memory-safe") {
            ptr := create(0, add(code, 0x20), mload(code))
        }
        if (ptr == address(0)) revert WriteFailed();
    }

    function read(address ptr) internal view returns (bytes memory out) {
        uint256 size = ptr.code.length;
        if (size == 0) return out;
        out = new bytes(size - 1);
        assembly ("memory-safe") {
            extcodecopy(ptr, add(out, 0x20), 1, sub(size, 1))
        }
    }
}
