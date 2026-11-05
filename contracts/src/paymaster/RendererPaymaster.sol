// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FrameIntrospection, DevnetFrames} from "../lib/FrameIntrospection.sol";
import {TrustStore} from "../trust/TrustStore.sol";
import {DisplayVM} from "../lib/DisplayVM.sol";
import {Buf, Risk} from "../lib/VTree.sol";

interface IStakingRegistry {
    function addStake(uint32 unstakeDelaySec) external payable;
    function unlockStake() external;
    function withdrawStake(address payable to) external;
}

interface IERC20Min {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// Deposits, fees and policies shared by both legs (D16). Validation reads only this contract's own storage.
abstract contract RendererCore is TrustStore {
    using Buf for bytes;

    /// Policy `allowMask` bits lift the matching default refusal; they use the Risk.BIT_* positions.
    struct Policy {
        uint64 ttl;
        uint64 allowMask;
        bool set;
    }

    struct Deposit {
        uint128 amount;
        uint128 pendingWithdraw;
    }

    struct FeeAsset {
        uint128 ratePerGas;
        bool allowed;
    }

    uint256 public constant WITHDRAW_DELAY = 1 hours;
    uint256 public constant TOLERANCE_BPS = 2000;
    /// The sidecar lets one sender have 4 linear transactions pending, and a VERIFY frame cannot reserve. A deposit
    /// covering every pending fee keeps `charge` from failing after validation (A9).
    uint256 public constant FEE_HEADROOM = 4;

    address public immutable OWNER;
    address public immutable TRUST_ADMIN;
    address public immutable PERMIT2;
    address public immutable WETH;
    bytes32 internal immutable ROUTER_PUBLISHER;

    mapping(address => Policy) public policyOf;
    mapping(address => mapping(address => Deposit)) public deposits;
    mapping(address => mapping(address => uint256)) public withdrawReadyAt;
    mapping(address => FeeAsset) public feeAssets;
    mapping(address => uint256) public feesAccrued;

    error NotOwner();
    error PolicyRefused(uint256 risk);
    error TreeMismatch(bytes32 expected, bytes32 actual);
    error SpecHashMismatch(bytes32 expected, bytes32 actual);
    error FeeAssetNotAllowed(address asset);
    error FeeTooLow(uint256 min, uint256 amount);
    error InsufficientDeposit(uint256 available, uint256 needed);
    error WithdrawNotReady(uint256 readyAt);
    error TransferFailed();

    event Charged(address indexed account, address indexed asset, uint256 amount);
    event Deposited(address indexed account, address indexed asset, uint256 amount);
    event WithdrawRequested(address indexed account, address indexed asset, uint256 amount, uint256 readyAt);
    event PolicySet(address indexed account, bytes32 indexed policyHash);

    constructor(address owner_, address trustAdmin, address permit2, address weth, bytes32 routerPublisher, address[] memory attestors_, uint8 threshold) {
        OWNER = owner_;
        TRUST_ADMIN = trustAdmin;
        PERMIT2 = permit2;
        WETH = weth;
        ROUTER_PUBLISHER = routerPublisher;
        _setAttestors(attestors_, threshold);
        feeAssets[address(0)] = FeeAsset(1, true);
    }

    modifier onlyOwner() {
        if (msg.sender != OWNER) revert NotOwner();
        _;
    }

    function _codehashOf(address a) internal view virtual override returns (bytes32) {
        return a.codehash;
    }

    function _routerConfig() internal view override returns (address, address, bytes32) {
        return (PERMIT2, WETH, ROUTER_PUBLISHER);
    }

    // ----------------------------------------------------------------- render + policy + fee ----

    /// Everything validation checks about one transaction, independent of how the leg gets at its data.
    function _validateTx(DisplayVM.In memory i, bytes32 treeHash, bytes32 specHash) internal view {
        DisplayVM.Out memory o = _render(i);
        bytes32 tree = keccak256(o.tree);
        if (tree != treeHash) revert TreeMismatch(treeHash, tree);
        bytes32 spec = keccak256(o.spec);
        if (spec != specHash) revert SpecHashMismatch(specHash, spec);
        bytes memory b = i.body;
        uint256 sp = b.rdWord(96);
        bytes32 argSpec = b.hashRange(sp + 32, b.rdWord(sp));
        if (argSpec != specHash) revert SpecHashMismatch(specHash, argSpec);
        _applyPolicy(o.risk, policyOf[i.account].allowMask);
        _checkFee(i.account, i.feeAsset, i.feeAmount, i.gasLimitTotal);
    }

    /// §9.3, failing closed on the refused set.
    function _applyPolicy(uint256 risk, uint256 allow) internal pure {
        uint256 refused = Risk.BIT_UNVERIFIED | Risk.BIT_BLIND | Risk.BIT_UNLIMITED | Risk.BIT_TTL_LONG | Risk.BIT_TOKEN_UNSAFE;
        if (risk & refused & ~allow != 0) revert PolicyRefused(risk);
        if (risk & Risk.BIT_HOOK_TAKE != 0 && allow & Risk.BIT_HOOK_TAKE == 0 && risk & (Risk.BIT_NO_MIN_OUT | Risk.BIT_HOOK_UNVERIFIED) != 0) revert PolicyRefused(risk);
    }

    function _checkFee(address account, address asset, uint256 amount, uint256 gasLimitTotal) internal view {
        FeeAsset memory f = feeAssets[asset];
        if (!f.allowed) revert FeeAssetNotAllowed(asset);
        uint256 min = (gasLimitTotal * f.ratePerGas * (10_000 - TOLERANCE_BPS)) / 10_000;
        if (amount < min) revert FeeTooLow(min, amount);
        Deposit memory d = deposits[account][asset];
        uint256 available = d.amount > d.pendingWithdraw ? d.amount - d.pendingWithdraw : 0;
        if (available < amount * FEE_HEADROOM) revert InsufficientDeposit(available, amount * FEE_HEADROOM);
    }

    // ------------------------------------------------------------------------------ deposits ----

    /// Anyone may fund an account's deposit; only the account can spend it.
    function deposit(address account, address asset, uint256 amount) external payable {
        if (asset == address(0)) {
            amount = msg.value;
        } else if (!IERC20Min(asset).transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }
        deposits[account][asset].amount += uint128(amount);
        emit Deposited(account, asset, amount);
    }

    function charge(address asset, uint256 amount) external virtual {
        Deposit storage d = deposits[msg.sender][asset];
        if (d.amount < amount) revert InsufficientDeposit(d.amount, amount);
        d.amount -= uint128(amount);
        feesAccrued[asset] += amount;
        emit Charged(msg.sender, asset, amount);
    }

    /// Lowers what validation counts as available at once, but the money stays until the delay passes, so a pending
    /// transaction's fee cannot be raced away (WITHDRAW_DELAY > the TTL).
    function requestWithdraw(address asset, uint256 amount) external {
        Deposit storage d = deposits[msg.sender][asset];
        d.pendingWithdraw = uint128(amount);
        uint256 readyAt = block.timestamp + WITHDRAW_DELAY;
        withdrawReadyAt[msg.sender][asset] = readyAt;
        emit WithdrawRequested(msg.sender, asset, amount, readyAt);
    }

    function withdraw(address asset) external {
        uint256 readyAt = withdrawReadyAt[msg.sender][asset];
        if (readyAt == 0 || block.timestamp < readyAt) revert WithdrawNotReady(readyAt);
        Deposit storage d = deposits[msg.sender][asset];
        uint256 amount = d.pendingWithdraw < d.amount ? d.pendingWithdraw : d.amount;
        d.amount -= uint128(amount);
        d.pendingWithdraw = 0;
        withdrawReadyAt[msg.sender][asset] = 0;
        _pay(msg.sender, asset, amount);
    }

    function _pay(address to, address asset, uint256 amount) private {
        if (asset == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else if (!IERC20Min(asset).transfer(to, amount)) {
            revert TransferFailed();
        }
    }

    function withdrawFees(address asset, address to, uint256 amount) external onlyOwner {
        feesAccrued[asset] -= amount;
        _pay(to, asset, amount);
    }

    function setFeeAsset(address asset, uint128 ratePerGas, bool allowed) external onlyOwner {
        feeAssets[asset] = FeeAsset(ratePerGas, allowed);
    }

    // ------------------------------------------------------------------------------ policies ----

    function setPolicy(uint64 ttl, uint64 allowMask) external {
        policyOf[msg.sender] = Policy(ttl, allowMask, true);
        emit PolicySet(msg.sender, policyHashOf(msg.sender));
    }

    function ttlOf(address account) public view returns (uint64) {
        Policy memory p = policyOf[account];
        return p.set ? p.ttl : DEFAULT_TTL;
    }

    function policyHashOf(address account) public view returns (bytes32) {
        Policy memory p = policyOf[account];
        return keccak256(abi.encode(p.set ? p.ttl : DEFAULT_TTL, p.allowMask));
    }

    receive() external payable {}

    /// refreshTrust and its view live in the TrustAdmin module.
    fallback() external {
        address m = TRUST_ADMIN;
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), m, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
}

/// Leg A: the staked VERIFY frame. Pays only for a transaction whose real calldata renders to what the owners signed.
abstract contract RendererPaymasterBase is RendererCore, FrameIntrospection {
    using Buf for bytes;

    bytes32 public immutable VERBATIM_ACCOUNT_CODEHASH;

    error NotEntryPoint();
    error NotCanonicalSender(bytes32 codehash);
    error BadFrame();

    constructor(bytes32 accountCodehash, address owner_, address trustAdmin, address permit2, address weth, bytes32 routerPublisher, address[] memory attestors_, uint8 threshold) RendererCore(owner_, trustAdmin, permit2, weth, routerPublisher, attestors_, threshold) {
        VERBATIM_ACCOUNT_CODEHASH = accountCodehash;
    }

    /// Frame 1. Layout is the canonical account's frame 0's job, which the protocol ran first and which the code
    /// hash check pins. `hints` is bound by `sig_hash`, like all frame data on this build.
    function verifyFrame(address[] calldata hints) external {
        if (msg.sender != address(0xaa)) revert NotEntryPoint();
        Layout memory l = _layout();
        if (l.current != 1) revert BadFrame();
        address sender = address(uint160(l.sender));
        bytes32 ch = sender.codehash;
        if (ch != VERBATIM_ACCOUNT_CODEHASH) revert NotCanonicalSender(ch);

        bytes memory f0 = _framedatacopy(4, 96, 0);
        bytes memory body = _framedatacopy(4, l.l2 - 4, 2);
        uint256 gasTotal = l.g0 + l.s0 + l.g1 + l.s1 + l.g2 + l.s2;

        DisplayVM.In memory i;
        i.chainId = uint64(block.chainid);
        i.account = sender;
        i.signedAtBlock = uint64(f0.rdWord(64));
        i.ttl = ttlOf(sender);
        i.feeAsset = body.rdAddr(0);
        i.feeAmount = body.rdWord(32);
        i.gasLimitTotal = uint64(gasTotal);
        i.policyHash = policyHashOf(sender);
        i.body = body;
        i.hints = hints;
        _validateTx(i, bytes32(f0.rdWord(0)), bytes32(f0.rdWord(32)));
        _approve(SCOPE_PAYMENT);
    }

    function stake(address registry, uint32 delay) external payable onlyOwner {
        IStakingRegistry(registry).addStake{value: msg.value}(delay);
    }
}

contract RendererPaymaster is RendererPaymasterBase, DevnetFrames {
    constructor(bytes32 accountCodehash, address owner_, address trustAdmin, address permit2, address weth, bytes32 routerPublisher, address[] memory attestors_, uint8 threshold, address frameReader) RendererPaymasterBase(accountCodehash, owner_, trustAdmin, permit2, weth, routerPublisher, attestors_, threshold) DevnetFrames(frameReader) {}
}

/// Test deployment only: `charge` fails on demand, because the real one cannot fail after validation passes.
/// Lets I4 (fee failure means nothing protected runs) be proven by a real transaction on the devnet.
contract FeeFailPaymaster is RendererPaymaster {
    error ChargeForcedToFail();

    constructor(bytes32 accountCodehash, address owner_, address trustAdmin, address permit2, address weth, bytes32 routerPublisher, address[] memory attestors_, uint8 threshold, address frameReader) RendererPaymaster(accountCodehash, owner_, trustAdmin, permit2, weth, routerPublisher, attestors_, threshold, frameReader) {}

    function charge(address, uint256) external pure override {
        revert ChargeForcedToFail();
    }
}
