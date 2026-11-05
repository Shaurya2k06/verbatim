// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Proofs against a snapshot's sorted Merkle tree (context.md §6). packages/snapshot-cli is the other half.
///   leaf: keccak(0x00 ‖ type ‖ key words ‖ value words)    node: keccak(0x01 ‖ left ‖ right)    order: keccak(type ‖ key words)
/// The domain bytes keep a node from being replayed as a leaf and the reverse. An item in the proof list is
///   type(1) index(2) nKey(1) nValue(1) vdescLen(2) key words, value words, path(depth words), vdesc
library SnapshotVerifier {
    error BadProof();
    error NotAdjacent();

    uint8 internal constant DESC = 1;
    uint8 internal constant TOKEN = 2;
    uint8 internal constant HOOK = 3;
    uint8 internal constant NAME = 4;
    uint8 internal constant PROXY = 5;
    uint8 internal constant ROUTER = 6;
    uint8 internal constant SPENDER = 7;
    uint8 internal constant SENTINEL_LOW = 0;
    uint8 internal constant SENTINEL_HIGH = 255;

    uint256 internal constant ITEM_HEAD = 7;

    /// One parsed item. All offsets are absolute calldata positions.
    struct Item {
        uint256 kind;
        uint256 index;
        uint256 nKey;
        uint256 nValue;
        uint256 vdescLen;
        uint256 keyAt;
        uint256 valueAt;
        uint256 pathAt;
        uint256 vdescAt;
        uint256 next;
    }

    function depthAt(uint256 start) internal pure returns (uint256 d) {
        assembly ("memory-safe") {
            d := byte(0, calldataload(start))
        }
    }

    function parse(uint256 p, uint256 depth, uint256 end) internal pure returns (Item memory it) {
        uint256 w;
        assembly ("memory-safe") {
            w := calldataload(p)
        }
        it.kind = w >> 248;
        it.index = (w >> 232) & 0xffff;
        it.nKey = (w >> 224) & 0xff;
        it.nValue = (w >> 216) & 0xff;
        it.vdescLen = (w >> 200) & 0xffff;
        unchecked {
            it.keyAt = p + ITEM_HEAD;
            it.valueAt = it.keyAt + it.nKey * 32;
            it.pathAt = it.valueAt + it.nValue * 32;
            it.vdescAt = it.pathAt + depth * 32;
            it.next = it.vdescAt + it.vdescLen;
        }
        if (it.next > end || it.nKey > 4 || it.nValue > 4) revert BadProof();
    }

    /// The leaf's hash, from the item's own words.
    function leafHash(Item memory it) internal pure returns (bytes32 h) {
        uint256 kind = it.kind;
        uint256 keyAt = it.keyAt;
        uint256 n = (it.nKey + it.nValue) * 32;
        assembly ("memory-safe") {
            let m := mload(0x40)
            mstore8(m, 0)
            mstore8(add(m, 1), kind)
            calldatacopy(add(m, 2), keyAt, n)
            h := keccak256(m, add(n, 2))
        }
    }

    function sortKey(Item memory it) internal pure returns (uint256 k) {
        if (it.kind == SENTINEL_LOW) return 0;
        if (it.kind == SENTINEL_HIGH) return type(uint256).max;
        uint256 kind = it.kind;
        uint256 keyAt = it.keyAt;
        uint256 n = it.nKey * 32;
        assembly ("memory-safe") {
            let m := mload(0x40)
            mstore8(m, kind)
            calldatacopy(add(m, 1), keyAt, n)
            k := keccak256(m, add(n, 1))
        }
    }

    /// Walks the path. Reverts on a mismatch, which is always a hostile or stale proof.
    function verify(Item memory it, uint256 depth, bytes32 root) internal pure {
        bytes32 h = leafHash(it);
        uint256 i = it.index;
        uint256 at = it.pathAt;
        assembly ("memory-safe") {
            // Past the free pointer: unallocated, and the two scratch words are one byte too small for 65 bytes.
            let m := mload(0x40)
            for { let d := 0 } lt(d, depth) { d := add(d, 1) } {
                let sib := calldataload(at)
                mstore8(m, 1)
                switch and(i, 1)
                case 0 {
                    mstore(add(m, 1), h)
                    mstore(add(m, 0x21), sib)
                }
                default {
                    mstore(add(m, 1), sib)
                    mstore(add(m, 0x21), h)
                }
                h := keccak256(m, 0x41)
                i := shr(1, i)
                at := add(at, 0x20)
            }
        }
        if (i != 0 || h != root) revert BadProof();
    }

    /// Two consecutive leaves whose keys bracket `key`. §6's non-membership proof.
    function verifyAbsent(Item memory low, Item memory high, uint256 depth, bytes32 root, uint256 key) internal pure {
        verify(low, depth, root);
        verify(high, depth, root);
        if (high.index != low.index + 1) revert NotAdjacent();
        if (!(sortKey(low) < key && key < sortKey(high))) revert NotAdjacent();
    }

    function word(uint256 at) internal pure returns (uint256 v) {
        assembly ("memory-safe") {
            v := calldataload(at)
        }
    }

    function digest(bytes32 root, uint64 issuedAt, uint64 expiry, uint16 schema) internal view returns (bytes32 d) {
        bytes32 domainType = keccak256("EIP712Domain(string name,string version,uint256 chainId)");
        bytes32 nameHash = keccak256("VerbatimSnapshot");
        bytes32 versionHash = keccak256("1");
        bytes32 structType = keccak256("Snapshot(bytes32 root,uint64 issuedAt,uint64 expiry,uint16 schema)");
        assembly ("memory-safe") {
            let m := mload(0x40)
            mstore(m, domainType)
            mstore(add(m, 0x20), nameHash)
            mstore(add(m, 0x40), versionHash)
            mstore(add(m, 0x60), chainid())
            let domain := keccak256(m, 0x80)
            mstore(m, structType)
            mstore(add(m, 0x20), root)
            mstore(add(m, 0x40), and(issuedAt, 0xffffffffffffffff))
            mstore(add(m, 0x60), and(expiry, 0xffffffffffffffff))
            mstore(add(m, 0x80), and(schema, 0xffff))
            let structHash := keccak256(m, 0xa0)
            mstore(m, 0x1901000000000000000000000000000000000000000000000000000000000000)
            mstore(add(m, 0x02), domain)
            mstore(add(m, 0x22), structHash)
            d := keccak256(m, 0x42)
        }
    }
}
