// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DisplayVM} from "../lib/DisplayVM.sol";
import {VDesc} from "../lib/VDesc.sol";
import {SSTORE2} from "../lib/SSTORE2.sol";

/// The trust store's storage (§7.6). Shared by the render path and the admin module, which runs by DELEGATECALL
/// from the paymaster, so both must see these slots first and in this order.
abstract contract TrustStoreLayout {
    uint8 internal constant STATUS_ATTESTED_ENS = 1;
    uint8 internal constant STATUS_ATTESTED_NO_ENS = 2;

    struct DescSlot {
        address blob;
        uint64 epoch;
        uint8 status;
        bool revoked;
    }

    struct TokenSlot {
        bytes11 symbol;
        uint8 symLen;
        uint8 decimals;
        uint8 flags;
        bool known;
    }

    struct ProxyTemplate {
        address upgrader;
        bytes32 logicCodehash;
        address impl;
        bytes4 getter;
    }

    struct DescUpdate {
        bytes32 codehash;
        bytes4 selector;
        bytes vdesc;
        bytes32 publisher;
    }

    struct TokenUpdate {
        address token;
        bytes11 symbol;
        uint8 symLen;
        uint8 decimals;
        uint8 flags;
    }

    struct ProxyUpdate {
        bytes32 codehash;
        ProxyTemplate template;
    }

    struct NameUpdate {
        address addr;
        bytes32 name;
    }

    struct Revocation {
        bytes32 codehash;
        bytes4 selector;
    }

    struct TrustUpdate {
        uint64 epoch;
        DescUpdate[] descriptors;
        Revocation[] revocations;
        TokenUpdate[] tokens;
        ProxyUpdate[] proxies;
        bytes32[] routers;
        bytes32[] hooks;
        NameUpdate[] names;
    }

    uint64 public trustEpoch;
    mapping(bytes32 => mapping(bytes4 => DescSlot)) public descOf;
    mapping(bytes32 => mapping(bytes4 => bytes32)) public publisherOf;
    mapping(bytes32 => bool) public everRevoked;
    mapping(address => TokenSlot) public tokens;
    mapping(bytes32 => uint8) public codeKind;
    mapping(bytes32 => ProxyTemplate) public proxyTemplates;
    mapping(bytes32 => bool) public attestedHooks;
    mapping(address => bytes32) public names;

    address[] public attestors;
    mapping(address => bool) public isAttestor;
    uint8 public attestorThreshold;

    error EpochNotIncreasing();
    error NotEnoughAttestors();
    error AttestorsNotSorted();
    error DescriptorRevoked();
    error BadSymbol();

    event TrustRefreshed(uint64 indexed epoch, bytes32 indexed updateHash);
}

/// Attested descriptors, tokens, hooks and names, read during render. Lives in the paymaster's own storage, so
/// validation reads only the entity's own state. One slot per lookup, read at most once per node.
abstract contract TrustStore is DisplayVM, TrustStoreLayout {
    function _setAttestors(address[] memory list, uint8 threshold) internal {
        attestors = list;
        attestorThreshold = threshold;
        for (uint256 i = 0; i < list.length; i++) isAttestor[list[i]] = true;
    }

    // ------------------------------------------------------------- DisplayVM lookups -------------

    function _descriptor(bytes32 codehash, bytes4 selector) internal view virtual override returns (Desc memory d) {
        DescSlot memory s = descOf[codehash][selector];
        if (s.blob == address(0) || s.revoked) return d;
        d.blob = SSTORE2.read(s.blob);
        d.publisher = publisherOf[codehash][selector];
        d.epoch = s.epoch;
        d.status = s.status;
    }

    function _tokenInfo(address token) internal view virtual override returns (bytes32 symbol, uint8 decimals, uint8 flags, bool known) {
        TokenSlot memory t = tokens[token];
        symbol = bytes32(uint256(uint88(t.symbol)) << 168) | bytes32(uint256(t.symLen));
        decimals = t.decimals;
        flags = t.flags;
        known = t.known;
    }

    function _nameOf(address) internal view virtual override returns (bytes32) {
        return bytes32(0);
    }

    function _hookIsAttested(bytes32 codehash) internal view virtual override returns (bool) {
        return attestedHooks[codehash];
    }

    function _codeKind(bytes32 codehash) internal view virtual override returns (uint8) {
        return codeKind[codehash];
    }

    function _proxyTemplate(bytes32 codehash) internal view virtual override returns (address, bytes32, address, bytes4) {
        ProxyTemplate memory p = proxyTemplates[codehash];
        return (p.upgrader, p.logicCodehash, p.impl, p.getter);
    }
}

/// `refreshTrust` and friends: everything outside validation. Split out to keep the paymaster under EIP-170.
contract TrustAdmin is TrustStoreLayout {
    function trustUpdateHash(TrustUpdate calldata u) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), u));
    }

    /// Outside validation, so it may read anything. Monotonic epoch, k-of-n attestors, no un-revoking (I10).
    function refreshTrust(TrustUpdate calldata u, bytes[] calldata sigs) external {
        if (u.epoch <= trustEpoch) revert EpochNotIncreasing();
        bytes32 h = trustUpdateHash(u);
        if (sigs.length < attestorThreshold) revert NotEnoughAttestors();
        address last;
        for (uint256 i = 0; i < sigs.length; i++) {
            address s = _recover(h, sigs[i]);
            if (s <= last || !isAttestor[s]) revert AttestorsNotSorted();
            last = s;
        }
        trustEpoch = u.epoch;

        for (uint256 i = 0; i < u.revocations.length; i++) {
            Revocation calldata r = u.revocations[i];
            DescSlot storage slot = descOf[r.codehash][r.selector];
            if (slot.blob != address(0)) everRevoked[keccak256(SSTORE2.read(slot.blob))] = true;
            slot.revoked = true;
        }
        for (uint256 i = 0; i < u.descriptors.length; i++) {
            DescUpdate calldata d = u.descriptors[i];
            bytes32 descHash = keccak256(d.vdesc);
            if (everRevoked[descHash]) revert DescriptorRevoked();
            VDesc.validate(d.vdesc);
            uint8 status = _checkPublisher(d.publisher, descHash);
            descOf[d.codehash][d.selector] = DescSlot(SSTORE2.write(d.vdesc), u.epoch, status, false);
            publisherOf[d.codehash][d.selector] = d.publisher;
        }
        for (uint256 i = 0; i < u.tokens.length; i++) {
            TokenUpdate calldata t = u.tokens[i];
            if (t.symLen > 11) revert BadSymbol();
            tokens[t.token] = TokenSlot(t.symbol, t.symLen, t.decimals, t.flags, true);
        }
        for (uint256 i = 0; i < u.proxies.length; i++) {
            codeKind[u.proxies[i].codehash] = 2;
            proxyTemplates[u.proxies[i].codehash] = u.proxies[i].template;
        }
        for (uint256 i = 0; i < u.routers.length; i++) codeKind[u.routers[i]] = 1;
        for (uint256 i = 0; i < u.hooks.length; i++) attestedHooks[u.hooks[i]] = true;
        for (uint256 i = 0; i < u.names.length; i++) names[u.names[i].addr] = u.names[i].name;
        emit TrustRefreshed(u.epoch, h);
    }

    /// Leg A has no ENS: attestors only, marked as such.
    function _checkPublisher(bytes32, bytes32) internal view virtual returns (uint8) {
        return STATUS_ATTESTED_NO_ENS;
    }

    function _recover(bytes32 h, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) return address(0);
        return ecrecover(h, v, r, s);
    }
}
