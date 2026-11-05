// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RendererCore} from "../paymaster/RendererPaymaster.sol";
import {DisplayVM} from "../lib/DisplayVM.sol";
import {Buf} from "../lib/VTree.sol";
import {IEntryPointV07, PackedUserOperation, PostOpMode} from "./PackedUserOperation.sol";

/// Leg B: the same render, derive, policy and deposit checks, as an ERC-4337 staked paymaster. Reads its own storage
/// and the code hash of targets the sender claims have code (OP-041). `paymasterAndData[52:]` is abi.encode(hints).
contract RendererPaymaster4337 is RendererCore {
    using Buf for bytes;

    IEntryPointV07 public immutable ENTRY_POINT;
    bytes32 public immutable VERBATIM_ACCOUNT_CODEHASH;

    mapping(address => uint256) public reserved;
    mapping(address => bool) private _charged;

    event Charged(address indexed account, address indexed asset, uint256 amount);

    error NotEntryPoint();
    error NotCanonicalSender(bytes32 codehash);
    error OverReserved(uint256 available, uint256 needed);

    constructor(IEntryPointV07 entryPoint, bytes32 accountCodehash, address owner_, address trustAdmin, address permit2, address weth, bytes32 routerPublisher, address[] memory attestors_, uint8 threshold) RendererCore(owner_, trustAdmin, permit2, weth, routerPublisher, attestors_, threshold) {
        ENTRY_POINT = entryPoint;
        VERBATIM_ACCOUNT_CODEHASH = accountCodehash;
    }

    function validatePaymasterUserOp(PackedUserOperation calldata op, bytes32, uint256 maxCost) external returns (bytes memory context, uint256 validationData) {
        if (msg.sender != address(ENTRY_POINT)) revert NotEntryPoint();
        bytes32 ch = op.sender.codehash;
        if (ch != VERBATIM_ACCOUNT_CODEHASH) revert NotCanonicalSender(ch);

        (bytes32 treeHash, bytes32 specHash, uint64 validUntil, ) = abi.decode(op.signature, (bytes32, bytes32, uint64, bytes));
        uint256 gasTotal = uint128(bytes16(op.accountGasLimits)) + uint128(uint256(op.accountGasLimits)) + op.preVerificationGas + uint128(bytes16(op.paymasterAndData[20:36])) + uint128(bytes16(op.paymasterAndData[36:52]));

        bytes memory body = op.callData[4:];
        DisplayVM.In memory i;
        i.chainId = uint64(block.chainid);
        i.account = op.sender;
        i.validUntil = validUntil;
        i.feeAsset = body.rdAddr(0);
        i.feeAmount = body.rdWord(32);
        i.gasLimitTotal = uint64(gasTotal);
        i.policyHash = policyHashOf(op.sender);
        i.body = body;
        i.hints = abi.decode(op.paymasterAndData[52:], (address[]));
        _validateTx(i, treeHash, specHash);

        if (i.feeAsset != address(0)) revert FeeAssetNotAllowed(i.feeAsset);
        if (i.feeAmount < maxCost) revert FeeTooLow(maxCost, i.feeAmount);

        // Reserve, so a second pending operation cannot count the same deposit.
        Deposit memory d = _deposits[op.sender][i.feeAsset];
        uint256 free = d.amount > d.pendingWithdraw ? d.amount - d.pendingWithdraw : 0;
        uint256 taken = reserved[op.sender] + i.feeAmount;
        if (free < taken) revert OverReserved(free, taken);
        reserved[op.sender] = taken;
        context = abi.encode(op.sender, i.feeAsset, i.feeAmount);
        validationData = 0;
    }

    function charge(address asset, uint256 amount) external {
        Deposit storage d = _deposits[msg.sender][asset];
        if (d.amount < amount) revert InsufficientDeposit(d.amount, amount);
        d.amount -= uint128(amount);
        _feesAccrued[asset] += amount;
        _charged[msg.sender] = true;
        emit Charged(msg.sender, asset, amount);
    }

    /// Cannot fail: the fee was reserved in validation. If the batch never reached `charge`, the fee is taken here.
    function postOp(PostOpMode, bytes calldata context, uint256 actualGasCost, uint256) external {
        if (msg.sender != address(ENTRY_POINT)) revert NotEntryPoint();
        (address sender, address asset, uint256 fee) = abi.decode(context, (address, address, uint256));
        reserved[sender] -= fee;
        if (_charged[sender]) {
            _charged[sender] = false;
            // The fee covered the maximum; the account gets back what the operation did not cost.
            if (fee > actualGasCost) {
                _deposits[sender][asset].amount += uint128(fee - actualGasCost);
                _feesAccrued[asset] -= fee - actualGasCost;
            }
        } else {
            Deposit storage d = _deposits[sender][asset];
            uint256 take = d.amount < fee ? d.amount : fee;
            d.amount -= uint128(take);
            _feesAccrued[asset] += take;
        }
    }

    function _nameOf(address a) internal view override returns (bytes32) {
        return _names[a];
    }

    function fundEntryPoint() external payable onlyOwner {
        ENTRY_POINT.depositTo{value: msg.value}(address(this));
    }

    function stakeEntryPoint(uint32 delay) external payable onlyOwner {
        ENTRY_POINT.addStake{value: msg.value}(delay);
    }
}
