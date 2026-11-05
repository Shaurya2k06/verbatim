// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TrustAdmin} from "./TrustStore.sol";
import {AssertionKit} from "../lib/AssertionKit.sol";

interface IPermissionedRegistryV2 {
    struct State {
        uint8 status;
        uint64 expiry;
        address latestOwner;
        uint256 tokenId;
        uint256 resource;
    }

    function getSubregistry(string calldata label) external view returns (address);
    function getResolver(string calldata label) external view returns (address);
    function getState(uint256 anyId) external view returns (State memory);
    function roleCount(uint256 resource) external view returns (uint256);
}

interface IPermissionedResolverV2 {
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
    function roleCount(uint256 resource) external view returns (uint256);
    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool);
}

/// §12.2: a publisher's claim on a descriptor stands only if nobody but its council can change the record, for at least
/// the horizon. Checked against ENSv2 docs and the live Sepolia deployment (contracts-v2 07e55a05).
/// Irreducible trust: the ENS DAO and the root registry.
contract EnsTrustChecker {
    // Roles per docs.ens.domains/ensv2/permissioned-resolver and /permissioned-registry; admin is `role << 128`.
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    uint256 internal constant ROLE_LINK = 1 << 28;
    uint256 internal constant ROLE_UPGRADE = 1 << 124;
    uint256 internal constant REG_ROLE_SET_SUBREGISTRY = 1 << 20;
    uint256 internal constant REG_ROLE_SET_RESOLVER = 1 << 24;
    /// Every holder of a role is counted in one nybble of `roleCount`, so these masks read "nobody holds it".
    uint256 internal constant NYBBLE = 0xf;

    string public constant RECORD_KEY = "clear-signing";

    address public immutable ROOT_REGISTRY;
    address public immutable ETH_REGISTRY;
    bytes32 public immutable RESOLVER_CODEHASH;
    address public immutable COUNCIL;
    uint256 public immutable HORIZON;

    error BadName();
    error WrongEthRegistry(address found);
    error NoResolver();
    error WrongResolverCode(bytes32 found);
    error RecordMissing(bytes32 descHash);
    error RootRolesHeld(uint256 roleCount);
    error SetterNotExclusive(uint256 roleCount);
    error RegistryRolesHeld(uint256 roleCount);
    error ExpiresTooSoon(uint64 expiry);
    error ForwardMismatch(address found);

    constructor(address rootRegistry, address ethRegistry, bytes32 resolverCodehash, address council, uint256 horizon) {
        ROOT_REGISTRY = rootRegistry;
        ETH_REGISTRY = ethRegistry;
        RESOLVER_CODEHASH = resolverCodehash;
        COUNCIL = council;
        HORIZON = horizon;
    }

    function _nybble(uint256 roleBit) private pure returns (uint256) {
        // A role at 1 << 4n occupies the nybble at bits 4n..4n+3.
        return roleBit * NYBBLE;
    }

    /// `label.eth`, packed as text plus length: the label, and the DNS form of the whole name.
    function _parse(bytes32 packed) private pure returns (string memory label, bytes memory dns) {
        uint256 n = uint256(packed) & 0xff;
        if (n < 5 || n > 31) revert BadName();
        uint256 labelLen = n - 4;
        if (packed[labelLen] != "." || packed[labelLen + 1] != "e" || packed[labelLen + 2] != "t" || packed[labelLen + 3] != "h") revert BadName();
        bytes memory l = new bytes(labelLen);
        for (uint256 i = 0; i < labelLen; i++) {
            if (packed[i] == ".") revert BadName();
            l[i] = packed[i];
        }
        label = string(l);
        dns = abi.encodePacked(uint8(labelLen), l, uint8(3), "eth", uint8(0));
    }

    function _node(string memory label) private pure returns (bytes32) {
        bytes32 eth = keccak256(abi.encodePacked(bytes32(0), keccak256("eth")));
        return keccak256(abi.encodePacked(eth, keccak256(bytes(label))));
    }

    /// The resolver for an exact, on-chain `label.eth`. Wildcards and CCIP-read cannot reach here: only a direct
    /// registry entry and a resolver with the pinned code count.
    function _resolver(string memory label) private view returns (IPermissionedResolverV2 r) {
        address eth = IPermissionedRegistryV2(ROOT_REGISTRY).getSubregistry("eth");
        if (eth != ETH_REGISTRY) revert WrongEthRegistry(eth);
        address a = IPermissionedRegistryV2(eth).getResolver(label);
        if (a == address(0)) revert NoResolver();
        if (a.codehash != RESOLVER_CODEHASH) revert WrongResolverCode(a.codehash);
        r = IPermissionedResolverV2(a);
    }

    function check(bytes32 packedName, bytes32 descHash) external view {
        (string memory label, bytes memory dns) = _parse(packedName);
        IPermissionedResolverV2 r = _resolver(label);

        // The record lists the hashes this publisher stands behind.
        bytes memory out = r.resolve(dns, abi.encodeWithSignature("text(bytes32,string)", _node(label), RECORD_KEY));
        if (!_contains(bytes(abi.decode(out, (string))), _hex(descHash))) revert RecordMissing(descHash);

        // Nobody may write any text, relink the name to other records, or swap the implementation.
        uint256 rootCount = r.roleCount(0);
        uint256 forbidden = _nybble(ROLE_SET_TEXT) | _nybble(ROLE_LINK) | _nybble(ROLE_UPGRADE);
        if (rootCount & (forbidden | (forbidden << 128)) != 0) revert RootRolesHeld(rootCount);

        // Only the council may write this one key, and nobody may hand that right on.
        uint256 keyResource = uint256(keccak256(bytes(RECORD_KEY)));
        uint256 keyCount = r.roleCount(keyResource);
        if ((keyCount & _nybble(ROLE_SET_TEXT)) != ROLE_SET_TEXT || keyCount >> 128 != 0 || !r.hasRoles(keyResource, ROLE_SET_TEXT, COUNCIL)) revert SetterNotExclusive(keyCount);

        // The name stays pointed at this resolver, and stays registered.
        IPermissionedRegistryV2 eth = IPermissionedRegistryV2(ETH_REGISTRY);
        // Parents hold no direct right to repoint names. Their admin roles stay with ENS: the irreducible trust.
        uint256 parentCount = eth.roleCount(0) | IPermissionedRegistryV2(ROOT_REGISTRY).roleCount(0);
        if (parentCount & (_nybble(REG_ROLE_SET_RESOLVER) | _nybble(REG_ROLE_SET_SUBREGISTRY)) != 0) revert RegistryRolesHeld(parentCount);
        IPermissionedRegistryV2.State memory st = eth.getState(uint256(keccak256(bytes(label))));
        uint256 regForbidden = _nybble(REG_ROLE_SET_RESOLVER) | _nybble(REG_ROLE_SET_SUBREGISTRY);
        uint256 nameCount = eth.roleCount(st.resource);
        if (nameCount & (regForbidden | (regForbidden << 128)) != 0) revert RegistryRolesHeld(nameCount);
        if (st.expiry < block.timestamp + HORIZON) revert ExpiresTooSoon(st.expiry);
    }

    /// Forward check for a cached name: it must resolve to the address it will be shown for.
    function checkName(address a, bytes32 packedName, address resolver) external view {
        (string memory label, ) = _parse(packedName);
        if (address(_resolver(label)) != resolver) revert NoResolver();
        address found = AssertionKit.resolveAddr(resolver, packedName);
        if (found != a) revert ForwardMismatch(found);
    }

    function _hex(bytes32 h) private pure returns (bytes memory out) {
        bytes16 table = "0123456789abcdef";
        out = new bytes(66);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            out[2 + i * 2] = table[uint8(h[i]) >> 4];
            out[3 + i * 2] = table[uint8(h[i]) & 0xf];
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

/// Leg B's admin module: attestors and ENS exclusivity must both pass (D6).
contract TrustAdminEns is TrustAdmin {
    EnsTrustChecker public immutable CHECKER;

    constructor(EnsTrustChecker checker) {
        CHECKER = checker;
    }

    function _checkPublisher(bytes32 publisher, bytes32 descHash) internal view override returns (uint8) {
        CHECKER.check(publisher, descHash);
        return STATUS_ATTESTED_ENS;
    }

    function _checkName(address a, bytes32 name, address resolver) internal view override {
        CHECKER.checkName(a, name, resolver);
    }
}
