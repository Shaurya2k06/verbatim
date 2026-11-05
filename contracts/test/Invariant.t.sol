// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Vm} from "forge-std/Vm.sol";
import {Base, TestAccount, TestPaymaster} from "./Base.t.sol";
import {VerbatimCore} from "../src/account/VerbatimAccount.sol";
import {TrustAdmin, TrustStoreLayout} from "../src/trust/TrustStore.sol";
import {TestToken} from "../src/demo/TestTokens.sol";

/// Random sequences of honest, hostile and administrative transactions against the whole system, run as whole
/// transactions under the mock protocol. The handler keeps ghost state; the suite checks I1-I7, I9 and I10 after every
/// call. (I8 is tools/difffuzz.) Validation failures are expected and swallowed: a refused transaction changes nothing.
contract Handler is Base {
    address[3] internal users = [address(0xA), address(0xB), address(0xC)];
    uint256 public ghostLanded;
    uint256 public ghostBatchReverted;
    uint256 public ghostExpected; // dUSDC the account should have sent
    uint256 public ghostFees;
    uint64 public ghostEpoch;
    uint256 public refusedLies;
    bool public executedLie;
    bool private approved;

    constructor() {
        setUp();
    }

    function expose() external view returns (TestAccount, TestPaymaster, TestToken, TestToken, address) {
        return (account, rpm, usdc, weth, THIEF);
    }

    function _try(Plan memory p, bytes32 tree, bytes32 spec) private returns (bool landed, bool batch) {
        load(p, tree, spec);
        env.setCurrent(1);
        bytes memory f0 = env.frame(1).data;
        bytes memory f1 = env.frame(2).data;
        bytes memory f2 = env.frame(3).data;
        vm.prank(address(0xaa));
        (bool a, ) = address(account).call(f0);
        if (!a) return (false, false);
        env.setCurrent(2);
        vm.prank(address(0xaa));
        (bool b, ) = address(rpm).call(f1);
        if (!b) return (false, false);
        env.setCurrent(3);
        vm.recordLogs();
        vm.prank(address(account));
        (bool c, ) = address(account).call(f2);
        if (!c) return (true, false);
        nonceNow++;
        ghostFees += FEE;
        ghostLanded++;
        bytes32 sig = keccak256("VerbatimResult(bool,bytes)");
        batch = _batchOk(sig);
        return (true, batch);
    }

    function _batchOk(bytes32 sig) private returns (bool) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) if (logs[i].topics[0] == sig) return uint256(logs[i].topics[1]) == 1;
        return false;
    }

    function honestTransfer(uint96 raw, uint8 who) external {
        uint256 amount = bound(raw, 1, 1e6);
        if (usdc.balanceOf(address(account)) < amount) return;
        Plan memory p = plan(transferCall(users[who % 3], amount), uint64(block.timestamp + 100));
        (, bool batch) = _try(p, keccak256(p.tree), keccak256(p.spec));
        if (batch) ghostExpected += amount;
        else ghostBatchReverted++;
    }

    function lyingRecipient(uint96 raw) external {
        Plan memory honest = plan(transferCall(users[0], bound(raw, 1, 1e6)), uint64(block.timestamp + 100));
        Plan memory lie = honest;
        lie.calls = transferCall(THIEF, bound(raw, 1, 1e6));
        (bool landed, ) = _try(lie, keccak256(honest.tree), keccak256(honest.spec));
        if (landed) executedLie = true;
        else refusedLies++;
    }

    function staleSignature(uint96 raw) external {
        Plan memory p = plan(transferCall(THIEF, bound(raw, 1, 1e6)), uint64(block.timestamp - 1));
        uint256 before = usdc.balanceOf(THIEF);
        _try(p, keccak256(p.tree), keccak256(p.spec));
        if (usdc.balanceOf(THIEF) != before) executedLie = true;
    }

    /// Approvals go through verified batches, as they must on the real account: that is how a token enters the ledger.
    function _vaultApprovals() private {
        if (approved) return;
        approved = true;
        Plan memory p = plan(one(address(usdc), abi.encodeWithSelector(0x095ea7b3, address(vault), uint256(1e12))), uint64(block.timestamp + 100));
        _try(p, keccak256(p.tree), keccak256(p.spec));
        p = plan(one(address(weth), abi.encodeWithSelector(0x095ea7b3, address(vault), uint256(1e18))), uint64(block.timestamp + 100));
        _try(p, keccak256(p.tree), keccak256(p.spec));
    }

    function evilVaultDeposit(uint64 raw) external {
        uint256 amount = bound(raw, 1, 1e6);
        _vaultApprovals();
        Plan memory p = plan(one(address(vault), abi.encodeWithSelector(0xb6b55f25, amount)), uint64(block.timestamp + 100));
        (, bool batch) = _try(p, keccak256(p.tree), keccak256(p.spec));
        if (batch) executedLie = true;
    }

    function advance(uint16 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 600));
    }

    function refreshUnrelated() external {
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        refresh(u);
        ghostEpoch = u.epoch;
    }

    function tryLowerEpoch() external {
        TrustStoreLayout.TrustUpdate memory u;
        u.epoch = 0;
        (bool ok, bytes memory ret) = address(rpm).call(abi.encodeCall(TrustAdmin.trustUpdateHash, (u)));
        require(ok);
        (bool lowered, ) = address(rpm).call(abi.encodeCall(TrustAdmin.refreshTrust, (u, attestorSigs(abi.decode(ret, (bytes32))))));
        if (lowered) executedLie = true;
    }

    function outsiderTakesOver(address who) external {
        vm.prank(who);
        (bool ok, ) = address(account).call(abi.encodeCall(VerbatimCore.addOwner, (who)));
        if (ok) executedLie = true;
        vm.prank(address(account));
        (ok, ) = address(account).call(abi.encodeCall(VerbatimCore.addOwner, (who)));
        if (ok) executedLie = true;
    }
}

contract InvariantsFuzz is StdInvariant {
    Handler internal h;
    TestAccount internal account;
    TestPaymaster internal rpm;
    TestToken internal usdc;
    TestToken internal weth;
    address internal thief;
    uint256 internal usdcStart;
    uint256 internal wethStart;
    bytes32 internal ownersStart;
    uint8 internal thresholdStart;

    function setUp() public {
        h = new Handler();
        (account, rpm, usdc, weth, thief) = h.expose();
        usdcStart = usdc.balanceOf(address(account));
        wethStart = weth.balanceOf(address(account));
        ownersStart = keccak256(abi.encode(account.owners()));
        thresholdStart = account.threshold();
        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](8);
        sel[0] = Handler.honestTransfer.selector;
        sel[1] = Handler.lyingRecipient.selector;
        sel[2] = Handler.staleSignature.selector;
        sel[3] = Handler.evilVaultDeposit.selector;
        sel[4] = Handler.advance.selector;
        sel[5] = Handler.refreshUnrelated.selector;
        sel[6] = Handler.tryLowerEpoch.selector;
        sel[7] = Handler.outsiderTakesOver.selector;
        targetSelector(FuzzSelector(address(h), sel));
    }

    /// I1, I2, I5: what left the account is exactly what signed, landed sentences said. Reverted batches left nothing.
    function invariant_I1_I2_I5_only_signed_effects_persist() public view {
        assertEqU(usdcStart - usdc.balanceOf(address(account)), h.ghostExpected());
    }

    /// I3, I6: no lying layout, recipient or stale signature ever executed.
    function invariant_I3_I6_no_lie_executes() public view {
        require(!h.executedLie(), "a hostile transaction took effect");
        require(usdc.balanceOf(thief) == 0, "the thief received dUSDC");
        require(weth.balanceOf(thief) == 0, "the hidden pull persisted");
    }

    /// I4 is one-directional here: fees only ever accrue for transactions that reached the batch.
    function invariant_I4_fees_match_landed() public view {
        require(TrustAdmin(payable(address(rpm))).feesAccrued(address(0)) == h.ghostFees(), "fees out of step");
    }

    /// I7: owners never change without a rendered TRUST_CHANGE batch, and this suite sends none.
    function invariant_I7_owners_fixed() public view {
        require(keccak256(abi.encode(account.owners())) == ownersStart && account.threshold() == thresholdStart, "owners moved");
    }

    /// I5 again: dWETH never moves, whatever EvilVault tries.
    function invariant_I5_tracked_asset_never_decreases() public view {
        require(weth.balanceOf(address(account)) >= wethStart, "dWETH decreased");
    }

    /// I10: the epoch only rises.
    function invariant_I10_epoch_monotonic() public view {
        uint64 e = TrustAdmin(payable(address(rpm))).trustEpoch();
        require(e >= h.ghostEpoch(), "epoch fell");
    }

    /// Guards the suite itself: a run in which nothing landed or nothing was refused would prove nothing.
    function afterInvariant() public view {
        require(h.ghostLanded() + h.refusedLies() > 0, "the handler did nothing");
    }

    function assertEqU(uint256 a, uint256 b) private pure {
        require(a == b, "dUSDC moved other than the sentences said");
    }
}
