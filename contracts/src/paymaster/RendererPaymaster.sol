// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FrameIntrospection, DevnetFrames} from "../lib/FrameIntrospection.sol";
import {OwnerDigest} from "../account/VerbatimAccount.sol";
import {IERC20Min, TrustStore} from "../trust/TrustStore.sol";
import {DisplayVM} from "../lib/DisplayVM.sol";
import {Buf, PolicyRules} from "../lib/VTree.sol";

interface IPolicySource {
    function policyWord() external view returns (uint256);
}

interface IStakingRegistry {
    function addStake(uint32 unstakeDelaySec) external payable;
    function unlockStake() external;
    function withdrawStake(address payable to) external;
}

/// Deposits, fees and policies shared by both legs (D16). Validation reads only this contract's own storage.
abstract contract RendererCore is TrustStore {
    using Buf for bytes;

    // Policy `allowMask` bits lift the matching default refusal; they use the Risk.BIT_* positions.
    address public immutable OWNER;
    address public immutable TRUST_ADMIN;
    address public immutable PERMIT2;
    address public immutable WETH;
    bytes32 internal immutable ROUTER_PUBLISHER;

    error NotOwner();
    error PolicyRefused(uint256 risk);
    error TreeMismatch(bytes32 expected, bytes32 actual);
    error SpecHashMismatch(bytes32 expected, bytes32 actual);
    error DigestMismatch(bytes32 expected, bytes32 signed);
    error SnapshotMissing();
    error SnapshotMismatch(bytes32 given, bytes32 cached);
    error SnapshotExpiresTooSoon(uint64 expiry, uint64 snapshotExpiry);
    error SnapshotTtlTooLong(uint256 ttl, uint256 max);
    error NoTicket(uint256 nonce, uint256 needed);
    error InsufficientDeposit(uint256 available, uint256 needed);


    constructor(address owner_, address trustAdmin, address permit2, address weth, bytes32 routerPublisher, address[] memory attestors_, uint8 threshold) {
        OWNER = owner_;
        TRUST_ADMIN = trustAdmin;
        PERMIT2 = permit2;
        WETH = weth;
        ROUTER_PUBLISHER = routerPublisher;
        _setAttestors(attestors_, threshold);
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

    /// §9.3, failing closed on the refused set.
    function _applyPolicy(uint256 risk, uint256 allow) internal pure {
        if (PolicyRules.refuses(risk, allow)) revert PolicyRefused(risk);
    }

    // ----------------------------------------------------- deposits (the rest is in TrustAdmin) ----

    function withdrawFees(address asset, address to, uint256 amount) external onlyOwner {
        _feesAccrued[asset] -= amount;
        if (asset == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok);
        } else {
            require(IERC20Min(asset).transfer(to, amount));
        }
    }

    receive() external payable {}

    /// refreshTrust, deposits and all storage getters live in the TrustAdmin module.
    fallback() external payable {
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
    event TicketCharged(address indexed account, uint256 indexed nonce, uint256 amount);

    constructor(bytes32 accountCodehash, address owner_, address trustAdmin, address permit2, address weth, bytes32 routerPublisher, address[] memory attestors_, uint8 threshold) RendererCore(owner_, trustAdmin, permit2, weth, routerPublisher, attestors_, threshold) {
        VERBATIM_ACCOUNT_CODEHASH = accountCodehash;
    }

    /// Frame 2. The layout is the canonical account's frame 1's job, which the protocol ran first and which the code hash
    /// check pins. This frame rebuilds the owners' digest from its own render and requires every entry to carry it (D2).
    function verifyFrame(address[] calldata hints, bytes32 root, uint64 issuedAt, uint64 snapExpiry) external {
        if (msg.sender != address(0xaa)) revert NotEntryPoint();
        Layout memory l = _layout();
        if (l.current != 2) revert BadFrame();
        address sender = address(uint160(l.sender));
        bytes32 ch = sender.codehash;
        if (ch != VERBATIM_ACCOUNT_CODEHASH) revert NotCanonicalSender(ch);
        // Frame 1, which that code ran, checked this word against the sender's storage.
        uint256 policy = l.policyClaim;

        // One slot for all three: the rest travels in this frame's data and only has to hash to it.
        bytes32 cached = _snapshotCommit;
        if (cached == bytes32(0)) revert SnapshotMissing();
        bytes32 commit = keccak256(abi.encode(root, issuedAt, snapExpiry));
        if (commit != cached) revert SnapshotMismatch(commit, cached);
        uint64 expiry = uint64(l.expiryWord >> 192);
        if (expiry > snapExpiry) revert SnapshotExpiresTooSoon(expiry, snapExpiry);
        uint256 maxSnapshotTtl = uint32(policy >> 56);
        if (snapExpiry - issuedAt > maxSnapshotTtl) revert SnapshotTtlTooLong(snapExpiry - issuedAt, maxSnapshotTtl);

        bytes memory body = _framedatacopy(4, l.l3 - 4, 3);
        DisplayVM.In memory i;
        i.chainId = uint64(block.chainid);
        i.account = sender;
        i.expiry = expiry;
        i.snapshotRoot = root;
        i.policyVersion = uint32(policy >> 120);
        i.path = uint8(PATH_PAYMASTER);
        i.maxFee = l.maxFee * (l.g0 + l.s0 + l.g1 + l.s1 + l.g2 + l.s2 + l.g3 + l.s3);
        i.body = body;
        i.hints = hints;
        DisplayVM.Out memory o = _render(i);

        bytes32 specHash = keccak256(o.spec);
        uint256 sp = body.rdWord(32);
        bytes32 argSpec = body.hashRange(sp + 32, body.rdWord(sp));
        if (argSpec != specHash) revert SpecHashMismatch(specHash, argSpec);
        _applyPolicy(o.risk, uint32(policy >> 88));

        bytes32 treeHash = keccak256(o.tree);
        bytes32 digest = OwnerDigest.compute(sender, treeHash, specHash, expiry, root, uint8(PATH_PAYMASTER), l.txCommit);
        uint256 n = uint8(policy);
        if (l.sigCount != n || n > MAX_SIGNATURES) revert BadFrame();
        for (uint256 k = 0; k < n; k++) {
            (, uint256 signed, ) = _sigAt(l, k);
            if (signed != uint256(digest)) _explainMismatch(treeHash, specHash, digest, signed);
        }
        _checkTicket(sender, l.nonce, l.maxCost);
        _approve(SCOPE_PAYMENT);
    }

    /// Only on the way to a revert, so the common path never pays for it: names which part the owners signed differently.
    function _explainMismatch(bytes32 treeHash, bytes32 specHash, bytes32 digest, uint256 signed) private view {
        bytes32 claimedTree = bytes32(_framedataload(4, 1));
        if (claimedTree != treeHash) revert TreeMismatch(claimedTree, treeHash);
        bytes32 claimedSpec = bytes32(_framedataload(36, 1));
        if (claimedSpec != specHash) revert SpecHashMismatch(claimedSpec, specHash);
        revert DigestMismatch(digest, bytes32(signed));
    }

    /// A ticket for this very nonce must hold the most this transaction can cost. Tickets are per nonce, so pending
    /// transactions cannot overcommit one balance (A14).
    function _checkTicket(address sender, uint256 nonce, uint256 maxCost) private view {
        FeeTicket memory t = _feeTickets[sender][nonce];
        if (t.reclaimAt != 0 || t.amount < maxCost) revert NoTicket(nonce, maxCost);
    }

    /// The last frame's first act. The ticket is spent whole; anything above the fee goes back to the account's deposit.
    function chargeTicket(uint256 nonce, uint256 amount) external virtual {
        FeeTicket memory t = _feeTickets[msg.sender][nonce];
        if (t.amount < amount) revert NoTicket(nonce, amount);
        delete _feeTickets[msg.sender][nonce];
        _feesAccrued[address(0)] += amount;
        _deposits[msg.sender][address(0)].amount += uint128(t.amount - amount);
        emit TicketCharged(msg.sender, nonce, amount);
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

    function chargeTicket(uint256, uint256) external pure override {
        revert ChargeForcedToFail();
    }
}
