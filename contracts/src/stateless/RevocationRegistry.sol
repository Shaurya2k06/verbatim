// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Liveness only (§6): read at execution, never in validation, so it cannot invalidate the mempool. It can make a batch revert
/// and it cannot authorize anything. Keyed by leaf hash, so it covers every leaf type. Revocation is one-way.
contract RevocationRegistry {
    mapping(address => bool) public isAttestor;
    uint256 public immutable THRESHOLD;
    mapping(bytes32 => bool) public isRevoked;

    bytes32 private immutable DOMAIN;
    bytes32 private constant TYPEHASH = keccak256("Revoke(bytes32[] leafHashes)");

    error NotEnoughAttestors();
    error AttestorsNotSorted();
    error BadThreshold();

    event Revoked(bytes32 indexed leafHash);

    constructor(address[] memory attestors, uint256 threshold) {
        if (threshold == 0 || threshold > attestors.length) revert BadThreshold();
        THRESHOLD = threshold;
        for (uint256 i = 0; i < attestors.length; i++) isAttestor[attestors[i]] = true;
        DOMAIN = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("VerbatimRevocation"), keccak256("1"), block.chainid, address(this)));
    }

    function digest(bytes32[] calldata leafHashes) public view returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", DOMAIN, keccak256(abi.encode(TYPEHASH, keccak256(abi.encodePacked(leafHashes))))));
    }

    /// `sigs` are r||s||v, signers ascending.
    function revoke(bytes32[] calldata leafHashes, bytes[] calldata sigs) external {
        if (sigs.length < THRESHOLD) revert NotEnoughAttestors();
        bytes32 d = digest(leafHashes);
        address last;
        for (uint256 i = 0; i < sigs.length; i++) {
            bytes calldata s = sigs[i];
            if (s.length != 65) revert AttestorsNotSorted();
            address who = ecrecover(d, uint8(s[64]), bytes32(s[0:32]), bytes32(s[32:64]));
            if (who <= last || !isAttestor[who]) revert AttestorsNotSorted();
            last = who;
        }
        for (uint256 i = 0; i < leafHashes.length; i++) {
            isRevoked[leafHashes[i]] = true;
            emit Revoked(leafHashes[i]);
        }
    }
}
