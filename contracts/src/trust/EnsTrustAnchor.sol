// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPermissionedRegistryV2, IPermissionedResolverV2} from "./EnsTrustChecker.sol";

/// ENSv2 as the trust root on chains with ENS (§13). Read at execution, so it never touches the mempool.
/// `<label>.eth` holds two text records, each written only through an argument-scoped role, whose exclusivity this checks:
///   `attestors`  comma-separated lowercase hex addresses. Every attestor whose signature was used must be listed.
///   `revoked`    comma-separated lowercase hex leaf hashes. No leaf used may be listed.
/// Nothing is hard-coded: the name, the registries and the resolver's code come from the deployment and the records.
contract EnsTrustAnchor {
    address public immutable ROOT_REGISTRY;
    address public immutable ETH_REGISTRY;
    bytes32 public immutable RESOLVER_CODEHASH;
    address public immutable GOVERNANCE;
    bytes32 public immutable NODE;
    bytes32 private immutable LABEL_HASH;

    string internal constant ATTESTORS_KEY = "attestors";
    string internal constant REVOKED_KEY = "revoked";
    // Each role holds a 4-bit count at its own nybble, as in EnsTrustChecker.
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    uint256 internal constant ROLE_LINK = 1 << 28;
    uint256 internal constant ROLE_UPGRADE = 1 << 124;
    uint256 internal constant NYBBLE = 0xf;

    string private _label;
    bytes private _dns;

    error AttestorNotListed(address attestor);
    error LeafRevokedInEns(bytes32 leafHash);
    error WrongEthRegistry(address found);
    error NoResolver();
    error WrongResolverCode(bytes32 found);
    error RootRolesHeld(uint256 roleCount);
    error RecordSetterNotExclusive(string key, uint256 roleCount);

    constructor(address rootRegistry, address ethRegistry, bytes32 resolverCodehash, address governance, string memory label) {
        ROOT_REGISTRY = rootRegistry;
        ETH_REGISTRY = ethRegistry;
        RESOLVER_CODEHASH = resolverCodehash;
        GOVERNANCE = governance;
        _label = label;
        _dns = abi.encodePacked(uint8(bytes(label).length), label, uint8(3), "eth", uint8(0));
        bytes32 eth = keccak256(abi.encodePacked(bytes32(0), keccak256("eth")));
        LABEL_HASH = keccak256(bytes(label));
        NODE = keccak256(abi.encodePacked(eth, LABEL_HASH));
    }

    function _resolver() private view returns (IPermissionedResolverV2 r) {
        address eth = IPermissionedRegistryV2(ROOT_REGISTRY).getSubregistry("eth");
        if (eth != ETH_REGISTRY) revert WrongEthRegistry(eth);
        address a = IPermissionedRegistryV2(eth).getResolver(_label);
        if (a == address(0)) revert NoResolver();
        if (a.codehash != RESOLVER_CODEHASH) revert WrongResolverCode(a.codehash);
        r = IPermissionedResolverV2(a);
    }

    function _record(IPermissionedResolverV2 r, string memory key) private view returns (bytes memory) {
        return bytes(abi.decode(r.resolve(_dns, abi.encodeWithSignature("text(bytes32,string)", NODE, key)), (string)));
    }

    /// The record can only be written by the governance key, and that right cannot be handed on.
    function _exclusive(IPermissionedResolverV2 r, string memory key) private view {
        uint256 resource = uint256(keccak256(bytes(key)));
        uint256 count = r.roleCount(resource);
        if ((count & (ROLE_SET_TEXT * NYBBLE)) != ROLE_SET_TEXT || count >> 128 != 0 || !r.hasRoles(resource, ROLE_SET_TEXT, GOVERNANCE)) revert RecordSetterNotExclusive(key, count);
    }

    function check(address[] calldata attestorsUsed, bytes32[] calldata leafHashes) external view {
        IPermissionedResolverV2 r = _resolver();
        uint256 root = r.roleCount(0);
        uint256 forbidden = (ROLE_SET_TEXT * NYBBLE) | (ROLE_LINK * NYBBLE) | (ROLE_UPGRADE * NYBBLE);
        if (root & (forbidden | (forbidden << 128)) != 0) revert RootRolesHeld(root);
        _exclusive(r, ATTESTORS_KEY);
        _exclusive(r, REVOKED_KEY);

        bytes memory listed = _record(r, ATTESTORS_KEY);
        for (uint256 i = 0; i < attestorsUsed.length; i++) {
            if (!_contains(listed, _hexAddress(attestorsUsed[i]))) revert AttestorNotListed(attestorsUsed[i]);
        }
        bytes memory revoked = _record(r, REVOKED_KEY);
        if (revoked.length != 0) {
            for (uint256 i = 0; i < leafHashes.length; i++) {
                if (_contains(revoked, _hexBytes(abi.encodePacked(leafHashes[i])))) revert LeafRevokedInEns(leafHashes[i]);
            }
        }
    }

    function _hexAddress(address a) private pure returns (bytes memory) {
        return _hexBytes(abi.encodePacked(a));
    }

    function _hexBytes(bytes memory b) private pure returns (bytes memory out) {
        bytes16 table = "0123456789abcdef";
        out = new bytes(2 + b.length * 2);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < b.length; i++) {
            out[2 + i * 2] = table[uint8(b[i]) >> 4];
            out[3 + i * 2] = table[uint8(b[i]) & 0xf];
        }
    }

    function _contains(bytes memory hay, bytes memory needle) private pure returns (bool) {
        if (hay.length < needle.length) return false;
        for (uint256 i = 0; i <= hay.length - needle.length; i++) {
            uint256 j = 0;
            while (j < needle.length && hay[i + j] == needle[j]) j++;
            if (j == needle.length) return true;
        }
        return false;
    }
}
