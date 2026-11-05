// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VerbatimCore} from "../account/VerbatimAccount.sol";
import {PackedUserOperation} from "./PackedUserOperation.sol";

/// Leg B: same owners, digest, assertions and batch as the frame account, behind EntryPoint v0.7.
/// `signature` = abi.encode(treeHash, specHash, validUntil, ownerSigs); `sigHash` in the digest is the userOpHash.
interface IDepositCharge {
    function charge(address asset, uint256 amount) external;
}

contract VerbatimAccount4337 is VerbatimCore {
    address public immutable ENTRY_POINT;

    uint256 private constant SIG_VALIDATION_FAILED = 1;

    error NotEntryPoint();

    constructor(address entryPoint, address renderer, address[] memory owners_, uint8 threshold_) VerbatimCore(renderer, owners_, threshold_) {
        ENTRY_POINT = entryPoint;
    }

    function validateUserOp(PackedUserOperation calldata op, bytes32 userOpHash, uint256) external view returns (uint256) {
        if (msg.sender != ENTRY_POINT) revert NotEntryPoint();
        // The layout lock of Leg A: the canonical renderer pays, and only the protected batch runs.
        if (op.paymasterAndData.length < 20 || address(bytes20(op.paymasterAndData[0:20])) != RENDERER_PAYMASTER) return SIG_VALIDATION_FAILED;
        if (op.callData.length < 4 || bytes4(op.callData[0:4]) != this.executeVerified.selector || op.initCode.length != 0) return SIG_VALIDATION_FAILED;
        (bytes32 treeHash, bytes32 specHash, uint64 validUntil, bytes memory sigs) = abi.decode(op.signature, (bytes32, bytes32, uint64, bytes));
        // The call data must carry the same expiry the owners signed; the digest covers it through userOpHash too.
        if (uint64(uint256(bytes32(op.callData[4 + 128:4 + 160]))) != validUntil) return SIG_VALIDATION_FAILED;
        _checkSignatures(digestOf(userOpHash, treeHash, specHash, validUntil), sigs);
        return 0;
    }

    function _chargeFee(Fee calldata fee) internal override {
        IDepositCharge(RENDERER_PAYMASTER).charge(fee.asset, fee.amount);
    }

    function executeVerified(Fee calldata fee, Call[] calldata calls, bytes calldata spec, uint64 validUntil) external {
        if (msg.sender != ENTRY_POINT) revert NotEntryPoint();
        _execute(fee, calls, spec, keccak256(spec), validUntil);
    }
}
