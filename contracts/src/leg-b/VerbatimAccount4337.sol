// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VerbatimCore, OwnerDigest, IStatelessRenderer, IRevocationRegistry} from "../account/VerbatimAccount.sol";
import {PackedUserOperation} from "./PackedUserOperation.sol";
import {SnapshotVerifier} from "../lib/SnapshotVerifier.sol";
import {PolicyRules} from "../lib/VTree.sol";

/// Reads ENS records at execution (§13). Optional: address zero where a chain has no ENS.
interface ITrustAnchor {
    struct Used {
        address[] attestors;
        bytes32[] leaves;
        /// Each descriptor's publisher name and hash.
        bytes32[] publishers;
        bytes32[] descHashes;
        /// Each recipient name shown: its address, packed name and resolver.
        address[] nameAddrs;
        bytes32[] names;
        address[] nameResolvers;
    }

    function check(Used calldata used) external view;
}

/// The production leg (§11): stateless semantics behind EntryPoint v0.7, so any bundler takes it, with no paymaster and no stake.
/// `validateUserOp` reads only this account's own storage (STO-010). Owners' and attestors' signatures and the proofs travel in
/// `userOp.signature`, verified with ecrecover, which ERC-4337 allows. `txCommit` is the userOpHash; `validUntil` is the expiry.
contract VerbatimAccount4337 is VerbatimCore {
    address public immutable ENTRY_POINT;
    address public immutable STATELESS_RENDERER;
    address public immutable REVOCATIONS;
    address public immutable TRUST_ANCHOR;

    uint8 internal constant PATH_ERC4337 = 3;
    bytes4 internal constant EXECUTE_USER_OP = this.executeUserOp.selector;

    struct Sig {
        bytes32 treeHash;
        bytes32 specHash;
        uint64 expiry;
        bytes32 root;
        uint64 issuedAt;
        uint64 snapExpiry;
        /// r||s||v, signers ascending.
        bytes ownerSigs;
        bytes attestorSigs;
        address[] attestors;
        address[] hints;
        bytes proofs;
    }

    error NotEntryPoint();
    error BadCallData();
    error SnapshotExpiresTooSoon(uint64 expiry, uint64 snapshotExpiry);
    error SnapshotTtlTooLong(uint256 ttl, uint256 max);
    error TreeMismatch(bytes32 expected, bytes32 actual);
    error SpecHashMismatch(bytes32 expected, bytes32 actual);
    error PolicyRefused(uint256 risk);
    error WrongAttestors();
    error LeafRevoked(bytes32 leafHash);

    constructor(address entryPoint, address statelessRenderer, address revocations, address anchor, address permit2, address[] memory owners_, uint8 threshold_, address[] memory attestors_, uint8 attestorThreshold_) VerbatimCore(address(0), permit2, owners_, threshold_) {
        ENTRY_POINT = entryPoint;
        STATELESS_RENDERER = statelessRenderer;
        REVOCATIONS = revocations;
        TRUST_ANCHOR = anchor;
        _setAttestors(attestors_, attestorThreshold_);
    }

    function _chargeFee() internal override {}

    function _liveLeafChecks() internal view override {}

    /// The body the renderer reads: the call data with the selector off.
    function _body(bytes calldata callData) private pure returns (bytes memory) {
        return callData[4:];
    }

    function validateUserOp(PackedUserOperation calldata op, bytes32 userOpHash, uint256 missingAccountFunds) external returns (uint256) {
        if (msg.sender != ENTRY_POINT) revert NotEntryPoint();
        // The layout lock of this leg: only the protected batch runs, and nobody else pays.
        if (op.callData.length < 4 || bytes4(op.callData[0:4]) != EXECUTE_USER_OP || op.initCode.length != 0 || op.paymasterAndData.length != 0) revert BadCallData();
        Sig memory s = abi.decode(op.signature, (Sig));

        if (s.expiry > s.snapExpiry) revert SnapshotExpiresTooSoon(s.expiry, s.snapExpiry);
        if (s.snapExpiry - s.issuedAt > maxSnapshotTtl) revert SnapshotTtlTooLong(s.snapExpiry - s.issuedAt, maxSnapshotTtl);
        if (keccak256(abi.encodePacked(s.attestors)) != attestorsHash) revert WrongAttestors();

        bytes32 digest = OwnerDigest.compute(address(this), s.treeHash, s.specHash, s.expiry, s.root, PATH_ERC4337, userOpHash);
        if (consumed[digest]) revert Replayed(digest);
        _checkSignatures(digest, s.ownerSigs);
        _checkAttestorSigs(SnapshotVerifier.digest(s.root, s.issuedAt, s.snapExpiry, 1), s.attestorSigs, s.attestors);

        IStatelessRenderer.In memory i;
        i.chainId = uint64(block.chainid);
        i.account = address(this);
        i.expiry = s.expiry;
        i.snapshotRoot = s.root;
        i.policyVersion = policyVersion;
        i.path = PATH_ERC4337;
        i.maxFee = _maxFee(op);
        i.body = _body(op.callData);
        i.hints = s.hints;
        (bytes32 tree, bytes32 spec, uint256 risk, bytes32 argSpec) = IStatelessRenderer(STATELESS_RENDERER).render(s.root, s.proofs, i);
        if (tree != s.treeHash) revert TreeMismatch(s.treeHash, tree);
        if (spec != s.specHash) revert SpecHashMismatch(s.specHash, spec);
        if (argSpec != s.specHash) revert SpecHashMismatch(s.specHash, argSpec);
        if (PolicyRules.refuses(risk, allowMask)) revert PolicyRefused(risk);

        if (missingAccountFunds != 0) {
            (bool ok, ) = payable(msg.sender).call{value: missingAccountFunds}("");
            ok;
        }
        // validUntil in bits 160..207, validAfter zero, no aggregator: §11's `validUntil = D_owner.expiry`.
        return uint256(s.expiry) << 160;
    }

    /// Gas limits times the fee cap: the cap the sentence shows, known before signing.
    function _maxFee(PackedUserOperation calldata op) private pure returns (uint256) {
        uint256 verification = uint256(op.accountGasLimits) >> 128;
        uint256 call_ = uint128(uint256(op.accountGasLimits));
        uint256 maxFeePerGas = uint128(uint256(op.gasFees));
        return (verification + call_ + op.preVerificationGas) * maxFeePerGas;
    }

    function _checkAttestorSigs(bytes32 d, bytes memory sigs, address[] memory list) private view {
        uint256 k = attestorThreshold;
        if (k == 0 || sigs.length != k * 65) revert BadSignatureLength();
        address last;
        for (uint256 i = 0; i < k; i++) {
            bytes32 r;
            bytes32 ss;
            uint8 v;
            assembly ("memory-safe") {
                let p := add(add(sigs, 0x20), mul(i, 65))
                r := mload(p)
                ss := mload(add(p, 0x20))
                v := byte(0, mload(add(p, 0x40)))
            }
            if (uint256(ss) > SECP256K1N_HALF) revert SignatureMalleable();
            address who = ecrecover(d, v, r, ss);
            if (who <= last) revert SignersNotSortedOrUnknown();
            bool known;
            for (uint256 j = 0; j < list.length; j++) if (list[j] == who) known = true;
            if (!known) revert SignersNotSortedOrUnknown();
            last = who;
        }
    }

    /// EntryPoint v0.7 calls this with the whole operation when the call data starts with its selector, which is how execution
    /// gets at the proofs. §10 otherwise unchanged.
    function executeUserOp(PackedUserOperation calldata op, bytes32 userOpHash) external {
        if (msg.sender != ENTRY_POINT) revert NotEntryPoint();
        Sig memory s = abi.decode(op.signature, (Sig));
        ITrustAnchor.Used memory used = _parse(s.proofs);
        for (uint256 i = 0; i < used.leaves.length; i++) if (IRevocationRegistry(REVOCATIONS).isRevoked(used.leaves[i])) revert LeafRevoked(used.leaves[i]);
        if (TRUST_ANCHOR != address(0)) {
            used.attestors = _recoverAttestors(s);
            ITrustAnchor(TRUST_ANCHOR).check(used);
        }
        (Call[] memory calls, bytes memory spec) = abi.decode(op.callData[4:], (Call[], bytes));
        bytes32 digest = OwnerDigest.compute(address(this), s.treeHash, s.specHash, s.expiry, s.root, PATH_ERC4337, userOpHash);
        this.executeBatch(calls, spec, s.specHash, s.expiry, digest);
    }

    /// A self-call so that memory arguments become the calldata `_execute` works from.
    function executeBatch(Call[] calldata calls, bytes calldata spec, bytes32 specHash, uint64 expiry, bytes32 digest) external onlySelf {
        _execute(calls, spec, specHash, expiry, digest);
    }

    function _recoverAttestors(Sig memory s) private view returns (address[] memory out) {
        uint256 k = s.attestorSigs.length / 65;
        out = new address[](k);
        bytes32 d = SnapshotVerifier.digest(s.root, s.issuedAt, s.snapExpiry, 1);
        bytes memory sigs = s.attestorSigs;
        for (uint256 i = 0; i < k; i++) {
            bytes32 r;
            bytes32 ss;
            uint8 v;
            assembly ("memory-safe") {
                let p := add(add(sigs, 0x20), mul(i, 65))
                r := mload(p)
                ss := mload(add(p, 0x20))
                v := byte(0, mload(add(p, 0x40)))
            }
            out[i] = ecrecover(d, v, r, ss);
        }
    }

    function _parse(bytes memory proofs) private pure returns (ITrustAnchor.Used memory u) {
        if (proofs.length == 0) return u;
        uint256 depth = uint8(proofs[0]);
        uint256 n;
        uint256 nDesc;
        uint256 nName;
        uint256 p = 1;
        u.leaves = new bytes32[](32);
        u.publishers = new bytes32[](32);
        u.descHashes = new bytes32[](32);
        u.nameAddrs = new address[](32);
        u.names = new bytes32[](32);
        u.nameResolvers = new address[](32);
        while (p < proofs.length) {
            uint256 w;
            assembly ("memory-safe") {
                w := mload(add(add(proofs, 0x20), p))
            }
            uint256 nKey = (w >> 224) & 0xff;
            uint256 words = nKey + ((w >> 216) & 0xff);
            uint256 keyAt = p + 7;
            uint256 kind = w >> 248;
            bytes32 h;
            assembly ("memory-safe") {
                let m := mload(0x40)
                mstore8(m, 0)
                mstore8(add(m, 1), kind)
                let len := mul(words, 0x20)
                mcopy(add(m, 2), add(add(proofs, 0x20), keyAt), len)
                h := keccak256(m, add(len, 2))
            }
            u.leaves[n++] = h;
            uint256 valueAt = keyAt + nKey * 32;
            if (kind == SnapshotVerifier.DESC) {
                u.descHashes[nDesc] = bytes32(_wordAt(proofs, valueAt));
                u.publishers[nDesc++] = bytes32(_wordAt(proofs, valueAt + 32));
            } else if (kind == SnapshotVerifier.NAME) {
                u.nameAddrs[nName] = address(uint160(_wordAt(proofs, keyAt + 32)));
                u.names[nName] = bytes32(_wordAt(proofs, valueAt));
                u.nameResolvers[nName++] = address(uint160(_wordAt(proofs, valueAt + 32)));
            }
            p = keyAt + words * 32 + depth * 32 + ((w >> 200) & 0xffff);
        }
        bytes32[] memory leaves = u.leaves;
        bytes32[] memory pubs = u.publishers;
        bytes32[] memory descs = u.descHashes;
        address[] memory addrs = u.nameAddrs;
        bytes32[] memory names = u.names;
        address[] memory resolvers = u.nameResolvers;
        assembly ("memory-safe") {
            mstore(leaves, n)
            mstore(pubs, nDesc)
            mstore(descs, nDesc)
            mstore(addrs, nName)
            mstore(names, nName)
            mstore(resolvers, nName)
        }
    }

    function _wordAt(bytes memory d, uint256 at) private pure returns (uint256 v) {
        assembly ("memory-safe") {
            v := mload(add(add(d, 0x20), at))
        }
    }
}
