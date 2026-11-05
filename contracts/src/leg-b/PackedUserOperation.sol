// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// As in eth-infinitism/account-abstraction v0.7.
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

enum PostOpMode {
    opSucceeded,
    opReverted,
    postOpReverted
}

interface IEntryPointV07 {
    function depositTo(address account) external payable;
    function addStake(uint32 unstakeDelaySec) external payable;
    function getNonce(address sender, uint192 key) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}
