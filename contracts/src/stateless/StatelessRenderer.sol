// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DisplayVM} from "../lib/DisplayVM.sol";
import {SnapshotVerifier} from "../lib/SnapshotVerifier.sol";
import {Buf, Risk} from "../lib/VTree.sol";

/// DisplayVM with no storage: every lookup comes from a proof against the snapshot root, read from this call's own calldata.
/// A separate contract because rendering does not fit in an account under EIP-170. The account reaches it by STATICCALL at an
/// immutable address, so it still holds no DELEGATECALL, and the VERIFY frame reads only the sender's own storage (§5).
contract StatelessRenderer is DisplayVM {
    using Buf for bytes;
    using SnapshotVerifier for SnapshotVerifier.Item;

    address public immutable PERMIT2;
    address public immutable WETH;
    bytes32 public immutable ROUTER_PUBLISHER;

    error DescriptorHashMismatch();

    constructor(address permit2, address weth, bytes32 routerPublisher) {
        PERMIT2 = permit2;
        WETH = weth;
        ROUTER_PUBLISHER = routerPublisher;
    }

    /// Head of the calldata: selector, root, then an offset to `proofs`. `In` follows. Lookups read these by position.
    function render(bytes32 root, bytes calldata proofs, In memory i) external view returns (bytes32 treeHash, bytes32 specHash, uint256 risk, bytes32 argSpecHash) {
        root;
        proofs;
        Out memory o = _render(i);
        treeHash = keccak256(o.tree);
        specHash = keccak256(o.spec);
        risk = o.risk;
        bytes memory body = i.body;
        uint256 sp = body.rdWord(32);
        argSpecHash = body.hashRange(sp + 32, body.rdWord(sp));
    }

    function renderView(bytes32 root, bytes calldata proofs, In memory i) external view returns (bytes memory tree, bytes memory spec, uint256 risk) {
        root;
        proofs;
        Out memory o = _render(i);
        return (o.tree, o.spec, o.risk);
    }

    /// The item for a leaf with these key words, verified. `found` is false when the list holds none: a host that leaves a
    /// proof out only makes the render refuse or show less, never lie.
    function _find(uint8 kind, uint256 k0, uint256 k1, uint256 k2) private pure returns (SnapshotVerifier.Item memory it, bool found) {
        uint256 start;
        uint256 len;
        bytes32 root;
        assembly ("memory-safe") {
            root := calldataload(4)
            let off := add(4, calldataload(36))
            len := calldataload(off)
            start := add(off, 32)
        }
        if (len == 0) return (it, false);
        uint256 end = start + len;
        uint256 depth = SnapshotVerifier.depthAt(start);
        uint256 p = start + 1;
        while (p < end) {
            it = SnapshotVerifier.parse(p, depth, end);
            if (it.kind == kind && SnapshotVerifier.word(it.keyAt) == k0 && SnapshotVerifier.word(it.keyAt + 32) == k1 && (it.nKey < 3 || SnapshotVerifier.word(it.keyAt + 64) == k2)) {
                it.verify(depth, root);
                return (it, true);
            }
            p = it.next;
        }
        return (it, false);
    }

    function _codehashOf(address a) internal view override returns (bytes32) {
        return a.codehash;
    }

    function _descriptor(bytes32 codehash, bytes4 selector) internal view override returns (Desc memory d) {
        (SnapshotVerifier.Item memory it, bool found) = _find(SnapshotVerifier.DESC, block.chainid, uint256(codehash), uint256(bytes32(selector)));
        if (!found) return d;
        uint256 at = it.vdescAt;
        uint256 n = it.vdescLen;
        bytes memory blob = new bytes(n);
        assembly ("memory-safe") {
            calldatacopy(add(blob, 0x20), at, n)
        }
        // The tree shows this hash. An attested leaf binds it to the code hash and selector.
        if (keccak256(blob) != bytes32(SnapshotVerifier.word(it.valueAt))) revert DescriptorHashMismatch();
        d.blob = blob;
        d.publisher = bytes32(SnapshotVerifier.word(it.valueAt + 32));
        d.status = uint8(SnapshotVerifier.word(it.valueAt + 64));
    }

    function _tokenInfo(address token) internal view override returns (bytes32 symbol, uint8 decimals, uint8 flags, bool known) {
        (SnapshotVerifier.Item memory it, bool found) = _find(SnapshotVerifier.TOKEN, block.chainid, uint160(token), 0);
        if (!found) return (bytes32(0), 0, 0, false);
        symbol = bytes32(SnapshotVerifier.word(it.valueAt));
        decimals = uint8(SnapshotVerifier.word(it.valueAt + 32));
        // Any risk flag at all refuses the token: §6.
        flags = SnapshotVerifier.word(it.valueAt + 64) != 0 ? 1 : 0;
        known = true;
    }

    function _nameOf(address a) internal view override returns (bytes32) {
        (SnapshotVerifier.Item memory it, bool found) = _find(SnapshotVerifier.NAME, block.chainid, uint160(a), 0);
        return found ? bytes32(SnapshotVerifier.word(it.valueAt)) : bytes32(0);
    }

    function _nameResolver(address a) internal view override returns (address) {
        (SnapshotVerifier.Item memory it, bool found) = _find(SnapshotVerifier.NAME, block.chainid, uint160(a), 0);
        return found ? address(uint160(SnapshotVerifier.word(it.valueAt + 32))) : address(0);
    }

    function _hookIsAttested(bytes32 codehash) internal view override returns (bool) {
        (, bool found) = _find(SnapshotVerifier.HOOK, block.chainid, uint256(codehash), 0);
        return found;
    }

    function _spenderIsAttested(address spender) internal view override returns (bool) {
        (, bool found) = _find(SnapshotVerifier.SPENDER, block.chainid, uint160(spender), 0);
        return found;
    }

    function _codeKind(bytes32 codehash) internal view override returns (uint8) {
        (SnapshotVerifier.Item memory it, bool found) = _find(SnapshotVerifier.ROUTER, block.chainid, uint256(codehash), 0);
        if (found) return uint8(SnapshotVerifier.word(it.valueAt));
        (, found) = _find(SnapshotVerifier.PROXY, block.chainid, uint256(codehash), 0);
        return found ? 2 : 0;
    }

    function _routerConfig() internal view override returns (address, address, bytes32) {
        return (PERMIT2, WETH, ROUTER_PUBLISHER);
    }

    function _proxyTemplate(bytes32 codehash) internal view override returns (address upgrader, bytes32 logicCodehash, address impl, bytes4 getter) {
        (SnapshotVerifier.Item memory it, bool found) = _find(SnapshotVerifier.PROXY, block.chainid, uint256(codehash), 0);
        if (!found) return (address(0), bytes32(0), address(0), bytes4(0));
        upgrader = address(uint160(SnapshotVerifier.word(it.valueAt)));
        logicCodehash = bytes32(SnapshotVerifier.word(it.valueAt + 32));
        impl = address(uint160(SnapshotVerifier.word(it.valueAt + 64)));
        getter = bytes4(bytes32(SnapshotVerifier.word(it.valueAt + 96)));
    }
}
