// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, TestAccount, TestPaymaster} from "./Base.t.sol";
import {VerbatimCore, VerbatimAccountBase} from "../src/account/VerbatimAccount.sol";
import {RendererCore, RendererPaymasterBase} from "../src/paymaster/RendererPaymaster.sol";
import {AssertionKit} from "../src/lib/AssertionKit.sol";
import {TrustAdmin, TrustStoreLayout} from "../src/trust/TrustStore.sol";
import {RevocationRegistry} from "../src/stateless/RevocationRegistry.sol";

/// balanceOf that answers with nothing: a token the account can no longer read.
contract MuteToken {
    bool public mute;

    function setMute(bool m) external {
        mute = m;
    }

    function balanceOf(address) external view returns (uint256) {
        if (mute) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        return 0;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }
}

/// Named guards no other test reaches, each asserted by name.
contract GuardsTest is Base {
    function _self(bytes memory data) private returns (bool ok, bytes memory ret) {
        vm.prank(address(account));
        (ok, ret) = address(account).call(data);
    }

    // ------------------------------------------------------------------- the batch's own state ---

    /// A direct self-call outside any transaction: the phase has to be set by `_execute`.
    function test_protected_batch_needs_the_lock() public {
        (bool ok, bytes memory err) = _self(abi.encodeCall(VerbatimCore.protectedBatch, (transferCall(THIEF, 1), "", bytes32(0), 0)));
        assertFalse(ok);
        assertEq(errorName(err), VerbatimCore.NotLocked.selector);
    }

    /// A batch calling the account's own entry point, under a descriptor that hides it.
    function test_a_batch_cannot_start_a_second_batch() public {
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](1);
        bytes4 sel = VerbatimAccountBase.executeVerified.selector;
        u.descriptors[0] = _du(address(account).codehash, sel, bytes.concat(hex"56440001", hex"04", "Ping", hex"ff", hex"00", hex"00", hex"0000"));
        refresh(u);
        VerbatimCore.Call[] memory c = one(address(account), abi.encodeCall(VerbatimAccountBase.executeVerified, (transferCall(THIEF, 1), "")));
        (bool ok, bytes memory err) = run(plan(c, T0 + 100));
        assertFalse(ok);
        assertEq(errorName(err), VerbatimCore.CallFailed.selector);
        assertEq(innerError(err), VerbatimCore.Reentrant.selector);
        assertEq(usdc.balanceOf(THIEF), 0);
    }

    /// Too little gas for the outer reserve: the frame reverts, so nothing is consumed and nothing protected ran.
    function test_starved_frame_keeps_its_reserve() public {
        load(plan(transferCall(address(0xF00D), 1), T0 + 100));
        frame0();
        frame1();
        env.setCurrent(3);
        bytes memory data = env.frame(3).data;
        // Enough to reach the guard after the fee charge, whatever that costs, short of the reserve itself.
        bool sawGuard;
        for (uint256 g = 20_000; g < 400_000 && !sawGuard; g += 2_000) {
            vm.prank(address(account));
            (bool ok, bytes memory ret) = address(account).call{gas: g}(data);
            assertFalse(ok && g < 30_000);
            if (!ok && ret.length >= 4 && errorName(ret) == VerbatimCore.NoGasReserve.selector) sawGuard = true;
            if (ok) break;
        }
        assertTrue(sawGuard);
        assertEq(usdc.balanceOf(address(0xF00D)), 0);
    }

    /// A contract the sentence reads, gone mute between validation and execution.
    function test_an_unreadable_asset_stops_the_batch() public {
        MuteToken t = new MuteToken();
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](1);
        u.descriptors[0] = _du(address(t).codehash, 0xa9059cbb, transferDesc());
        u.tokens = new TrustStoreLayout.TokenUpdate[](1);
        u.tokens[0] = TrustStoreLayout.TokenUpdate(address(t), bytes11("MUTE"), 4, 6, 0);
        refresh(u);
        load(plan(one(address(t), abi.encodeWithSelector(0xa9059cbb, address(0xF00D), uint256(1))), T0 + 100));
        frame0();
        frame1();
        t.setMute(true);
        (bool ok, bytes memory err) = frame2();
        assertFalse(ok);
        assertEq(errorName(err), AssertionKit.ReadFailed.selector);
    }

    // ------------------------------------------------------------------------- administration ---

    function _batchCall(bytes memory inner) private returns (bool, bytes memory) {
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](1);
        u.descriptors[0] = _du(address(account).codehash, bytes4(inner), bytes.concat(hex"56440001", hex"05", "Admin", hex"ff", hex"00", hex"00", hex"0004"));
        refresh(u);
        return run(plan(one(address(account), inner), T0 + 100));
    }

    function test_owner_cannot_be_zero_or_twice() public {
        (bool ok, bytes memory err) = _batchCall(abi.encodeCall(VerbatimCore.addOwner, (vm.addr(O1))));
        assertFalse(ok);
        assertEq(innerError(err), VerbatimCore.BadOwner.selector);
    }

    function test_threshold_must_fit_the_owners() public {
        (bool ok, bytes memory err) = _batchCall(abi.encodeCall(VerbatimCore.setThreshold, (uint8(9))));
        assertFalse(ok);
        assertEq(innerError(err), VerbatimCore.BadThreshold.selector);
    }

    function test_watchlist_is_bounded() public {
        uint256 cap = account.MAX_WATCH();
        for (uint256 i = 0; i < cap; i++) account.watchForTest(address(usdc));
        (bool ok, bytes memory err) = _batchCall(abi.encodeCall(VerbatimCore.addWatch, (address(usdc))));
        assertFalse(ok);
        assertEq(innerError(err), VerbatimCore.WatchFull.selector);
    }

    function test_only_the_owner_withdraws_fees() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(RendererCore.NotOwner.selector);
        rpm.withdrawFees(address(0xBAD), address(0xBAD), 1);
    }

    // ------------------------------------------------------------------------------- the frames ---

    function test_renderer_only_runs_as_frame_two() public {
        load(plan(transferCall(address(0xF00D), 1), T0 + 100));
        env.setCurrent(1);
        bytes memory data = env.frame(2).data;
        vm.prank(address(0xaa));
        vm.expectRevert(RendererPaymasterBase.BadFrame.selector);
        (bool ok, ) = address(rpm).call(data);
        ok;
    }

    function test_a_snapshot_the_paymaster_does_not_hold_is_refused() public {
        Plan memory p = plan(transferCall(address(0xF00D), 1), T0 + 100);
        load(p);
        frame0();
        env.setCurrent(2);
        (bytes32 root, uint64 issuedAt, uint64 snapExpiry) = admin_().snapshot();
        bytes memory forged = abi.encodeCall(RendererPaymasterBase.verifyFrame, (p.hints, root, issuedAt, snapExpiry - 1));
        vm.prank(address(0xaa));
        bytes32 got = keccak256(abi.encode(root, issuedAt, snapExpiry - 1));
        bytes32 held = keccak256(abi.encode(root, issuedAt, snapExpiry));
        vm.expectRevert(abi.encodeWithSelector(RendererCore.SnapshotMismatch.selector, got, held));
        (bool ok, ) = address(rpm).call(forged);
        ok;
    }

    // ------------------------------------------------------------------- attestor signature order ---

    function test_trust_update_signers_must_ascend() public {
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        (bool ok, bytes memory ret) = address(rpm).call(abi.encodeCall(TrustAdmin.trustUpdateHash, (u)));
        require(ok, "hash");
        bytes[] memory sigs = attestorSigs(abi.decode(ret, (bytes32)));
        (sigs[0], sigs[1]) = (sigs[1], sigs[0]);
        vm.expectRevert(TrustStoreLayout.AttestorsNotSorted.selector);
        (bool ok2, ) = address(rpm).call(abi.encodeCall(TrustAdmin.refreshTrust, (u, sigs)));
        ok2;
    }

    function test_revocation_signers_must_be_attestors() public {
        RevocationRegistry reg = registry();
        bytes32[] memory list = new bytes32[](1);
        list[0] = keccak256("leaf");
        bytes32 d = reg.digest(list);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(uint256(0xBAD), d);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = abi.encodePacked(r, s, v);
        sigs[1] = abi.encodePacked(r, s, v);
        vm.expectRevert(RevocationRegistry.AttestorsNotSorted.selector);
        reg.revoke(list, sigs);
    }
}
