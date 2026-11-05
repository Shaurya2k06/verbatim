// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {VerbatimCore, VerbatimAccountBase} from "../src/account/VerbatimAccount.sol";
import {RendererCore} from "../src/paymaster/RendererPaymaster.sol";
import {TrustAdmin, TrustStoreLayout} from "../src/trust/TrustStore.sol";
import {AssertionKit} from "../src/lib/AssertionKit.sol";
import {FrameEnv} from "./MockFrames.sol";

/// I1 to I10 (§15). I8's full form is tools/difffuzz; here it is the golden vectors.
contract InvariantsTest is Base {
    function test_I1_success_means_executed_calls_render_to_signed_tree() public {
        Plan memory p = plan(transferCall(BOB, 5e6), 1000);
        bytes32 signed = keccak256(p.tree);
        (bool ok, ) = run(p);
        assertTrue(ok);
        // Decode what frame 2 actually carried, and re-render exactly that.
        (VerbatimCore.Fee memory fee, VerbatimCore.Call[] memory calls, ) = _decodeFrame2();
        Plan memory again = p;
        again.fee = fee;
        again.calls = calls;
        (bytes memory tree, , ) = rpm.renderView(input(again));
        assertEq(keccak256(tree), signed);
    }

    function _decodeFrame2() private view returns (VerbatimCore.Fee memory fee, VerbatimCore.Call[] memory calls, bytes memory spec) {
        bytes memory d = env.frame(2).data;
        bytes memory payload = new bytes(d.length - 4);
        for (uint256 i = 0; i < payload.length; i++) payload[i] = d[i + 4];
        return abi.decode(payload, (VerbatimCore.Fee, VerbatimCore.Call[], bytes));
    }

    function test_I2_success_means_spec_held_and_hash_matches() public {
        Plan memory p = plan(transferCall(BOB, 5e6), 1000);
        uint256 before = usdc.balanceOf(address(account));
        (bool ok, ) = run(p);
        assertTrue(ok);
        (, , bytes memory spec) = _decodeFrame2();
        assertEq(keccak256(spec), keccak256(p.spec));
        assertEq(before - usdc.balanceOf(address(account)), 5e6, "DELTA_EQ held");
    }

    function _expectLayoutFail(uint256 check) private {
        expectFrame0(abi.encodeWithSelector(VerbatimAccountBase.BadLayout.selector, check));
    }

    function test_I3_only_the_canonical_layout_gets_approval() public {
        Plan memory p = plan(transferCall(BOB, 1), 1000);
        // Other renderer.
        load(p);
        env.setFrameTarget(1, address(0x1234));
        _expectLayoutFail(4);
        // Atomic flag on frame 2.
        load(p);
        env.setFrameFlags(2, 4);
        _expectLayoutFail(5);
        // Value on frame 2.
        load(p);
        env.setFrameValue(2, 1);
        _expectLayoutFail(5);
        // Frame 2 calling something else.
        load(p);
        env.setFrameData(2, abi.encodeWithSelector(0xdeadbeef));
        _expectLayoutFail(6);
        // Frame 1 in the wrong mode.
        load(p);
        env.setFrameMode(1, 2);
        _expectLayoutFail(4);
        // Frame count.
        load(p);
        env.popFrame();
        (bool ok, ) = callFrame(0, address(account), address(0xaa));
        assertFalse(ok);
    }

    function test_I3_signature_binds_fees_gas_and_frames() public {
        Plan memory p = plan(transferCall(BOB, 1), 1000);
        // A relayer raising the priority fee after signing changes txCommit.
        load(p);
        env.setTx(address(account), 1, 999, 100);
        expectFrame0(abi.encodeWithSelector(VerbatimAccountBase.BadSignatureEntry.selector));
        // So does changing the renderer's hints.
        load(p);
        env.setFrameData(1, hex"00");
        expectFrame0(abi.encodeWithSelector(VerbatimAccountBase.BadSignatureEntry.selector));
    }

    function test_I3_needs_threshold_of_owners_sorted() public {
        Plan memory p = plan(transferCall(BOB, 1), 1000);
        load(p);
        env.reset();
        // Reload frames with a non-owner signing.
        load(p);
        bytes32 d = account.digestOf(txCommit(), keccak256(p.tree), keccak256(p.spec), p.signedAt);
        _resign(d, vm.addr(O1), vm.addr(0xDEAD));
        (bool ok, ) = callFrame(0, address(account), address(0xaa));
        assertFalse(ok, "non-owner");
    }

    function _resign(bytes32 d, address a, address b) private {
        // load() already pushed two entries; rebuild the env without them.
        FrameEnv.Frame memory f0 = env.frame(0);
        FrameEnv.Frame memory f1 = env.frame(1);
        FrameEnv.Frame memory f2 = env.frame(2);
        env.reset();
        env.pushFrame(f0);
        env.pushFrame(f1);
        env.pushFrame(f2);
        if (a > b) (a, b) = (b, a);
        env.pushSig(FrameEnv.Sig(1, a, d));
        env.pushSig(FrameEnv.Sig(1, b, d));
    }


    function test_I4_fee_failure_means_no_protected_call() public {
        Plan memory p = plan(transferCall(BOB, 5e6), 1000);
        load(p);
        frame0();
        frame1();
        // The deposit disappears between validation and execution, which the real deposit rules prevent.
        (uint128 amount, ) = rpm.deposits(address(account), address(0));
        vm.prank(address(account));
        rpm.charge(address(0), amount);
        (bool ok, ) = callFrame(2, address(account), address(account));
        assertFalse(ok, "frame 2 reverts");
        assertEq(usdc.balanceOf(BOB), 0, "nothing ran");
    }

    function test_I5_assert_failure_undoes_everything_and_fee_is_paid() public {
        // A token that moves less than the sentence said: it underdelivers the output, so DELTA_GE fails.
        (uint128 before, ) = rpm.deposits(address(account), address(0));
        uint256 usdcBefore = usdc.balanceOf(BOB);
        vm.prank(address(account));
        usdc.approve(address(p2), 1);
        Plan memory p = plan(transferCall(BOB, 5e6), 1000);
        p.spec[12] = bytes1(uint8(p.spec[12]) ^ 1); // an honest render would refuse this; go in below validation
        load(p, keccak256(p.tree), keccak256(p.spec));
        (bool ok, ) = callFrame(2, address(account), address(account));
        assertTrue(ok, "the frame itself succeeds");
        assertEq(usdc.balanceOf(BOB), usdcBefore, "no effect persists");
        (uint128 afterDep, ) = rpm.deposits(address(account), address(0));
        assertEq(before - afterDep, p.fee.amount, "fee paid");
    }

    function test_I6_ttl_boundary() public {
        Plan memory p = plan(transferCall(BOB, 1e6), 1000);
        vm.roll(1025);
        (bool ok, ) = run(p);
        assertTrue(ok, "last valid block");
        Plan memory q = plan(transferCall(BOB, 1e6), 1000);
        vm.roll(1026);
        (bool ok2, bytes memory err) = run(q);
        assertFalse(ok2);
        assertEq(errorName(err), VerbatimCore.Expired.selector);
    }

    /// The deployed bytecode itself: no DELEGATECALL, CALLCODE, SELFDESTRUCT, CREATE or CREATE2 anywhere.
    function test_I7_account_bytecode_has_no_delegatecall_or_selfdestruct() public view {
        bytes memory code = vm.getDeployedCode("VerbatimAccount.sol:VerbatimAccount");
        uint256 log1s;
        for (uint256 i = 0; i < code.length; i++) {
            uint8 op = uint8(code[i]);
            assertTrue(op != 0xf4, "DELEGATECALL");
            assertTrue(op != 0xf2, "CALLCODE");
            assertTrue(op != 0xff, "SELFDESTRUCT");
            assertTrue(op != 0xf0 && op != 0xf5, "CREATE");
            if (op == 0xa1) log1s++;
            if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
        }
        assertEq(log1s, 1, "exactly the APPROVE sentinel");
    }

    function test_I7_paymaster_has_exactly_one_approve_sentinel() public view {
        bytes memory code = vm.getDeployedCode("RendererPaymaster.sol:RendererPaymaster");
        uint256 log1s;
        for (uint256 i = 0; i < code.length; i++) {
            uint8 op = uint8(code[i]);
            if (op == 0xa1) log1s++;
            if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
        }
        assertEq(log1s, 1);
    }

    function test_I7_owner_changes_only_through_rendered_batch() public {
        vm.expectRevert(VerbatimCore.NotSelf.selector);
        account.addOwner(BOB);
        vm.prank(address(account));
        vm.expectRevert(VerbatimCore.NotSelf.selector);
        account.addOwner(BOB);

        Plan memory p = plan(one(address(account), abi.encodeCall(VerbatimCore.addOwner, (BOB))), 1000);
        assertTrue(_hasRisk(p.tree, 0x0005), "TRUST_CHANGE in the sentence");
        (bool ok, ) = run(p);
        assertTrue(ok);
        assertTrue(account.isOwner(BOB));
    }

    function _hasRisk(bytes memory tree, uint16 code) private pure returns (bool) {
        // Walk the nodes after the 56-byte header.
        uint256 p = 4 + 8 + 20 + 8 + 8 + 8;
        while (p < tree.length) {
            uint8 kind = uint8(tree[p]);
            uint256 len = (uint256(uint8(tree[p + 1])) << 8) | uint8(tree[p + 2]);
            if (kind == 0x30 && ((uint16(uint8(tree[p + 3])) << 8) | uint8(tree[p + 4])) == code) return true;
            p += 3 + len;
        }
        return false;
    }

    function test_I9_validation_reads_only_own_storage() public {
        Plan memory p = plan(transferCall(BOB, 1e6), 1000);
        load(p);
        env.setCurrent(0);
        bytes memory f0 = env.frame(0).data;
        bytes memory f1 = env.frame(1).data;
        vm.record();
        vm.prank(address(0xaa));
        (bool ok, ) = address(account).call(f0);
        assertTrue(ok);
        (, bytes32[] memory writes) = vm.accesses(address(account));
        assertEq(writes.length, 0, "frame 0 writes nothing");
        (bytes32[] memory tokenReads, ) = vm.accesses(address(usdc));
        assertEq(tokenReads.length, 0, "frame 0 reads no token");

        env.setCurrent(1);
        vm.record();
        vm.prank(address(0xaa));
        (ok, ) = address(rpm).call(f1);
        assertTrue(ok);
        (, writes) = vm.accesses(address(rpm));
        assertEq(writes.length, 0, "frame 1 writes nothing");
        (tokenReads, ) = vm.accesses(address(usdc));
        assertEq(tokenReads.length, 0, "frame 1 reads no token state");
        (tokenReads, ) = vm.accesses(address(account));
        assertEq(tokenReads.length, 0, "frame 1 reads no account state");
    }

    function test_I9_unrelated_trust_refresh_leaves_pending_tree_valid() public {
        Plan memory p = plan(transferCall(BOB, 1e6), 1000);
        // A descriptor for something else: the tree must not change, so nothing pending is invalidated.
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](1);
        u.descriptors[0] = TrustStoreLayout.DescUpdate(keccak256("other"), 0x12345678, transferDesc(), ATTESTORS);
        refresh(u);
        (bytes memory tree, , ) = rpm.renderView(input(p));
        assertEq(keccak256(tree), keccak256(p.tree));
    }

    function test_I9_revocation_invalidates_only_dependents() public {
        Plan memory dep = plan(transferCall(BOB, 1e6), 1000);
        Plan memory other = plan(one(address(usdc), abi.encodeWithSelector(0x095ea7b3, BOB, uint256(1))), 1000);
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.revocations = new TrustStoreLayout.Revocation[](1);
        u.revocations[0] = TrustStoreLayout.Revocation(address(usdc).codehash, 0xa9059cbb);
        refresh(u);
        (bytes memory t1, , uint256 risk) = rpm.renderView(input(dep));
        assertTrue(keccak256(t1) != keccak256(dep.tree), "dependent changed");
        assertTrue(risk != 0, "dependent now blind");
        (bytes memory t2, , ) = rpm.renderView(input(other));
        assertEq(keccak256(t2), keccak256(other.tree), "independent unchanged");
    }

    function test_I10_refresh_cannot_lower_epoch_or_unrevoke() public {
        TrustStoreLayout.TrustUpdate memory low;
        low.epoch = 0;
        expectRefresh(low, abi.encodeWithSelector(TrustStoreLayout.EpochNotIncreasing.selector));

        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.revocations = new TrustStoreLayout.Revocation[](1);
        u.revocations[0] = TrustStoreLayout.Revocation(address(usdc).codehash, 0xa9059cbb);
        refresh(u);

        TrustStoreLayout.TrustUpdate memory back = emptyUpdate();
        back.descriptors = new TrustStoreLayout.DescUpdate[](1);
        back.descriptors[0] = TrustStoreLayout.DescUpdate(address(usdc).codehash, 0xa9059cbb, transferDesc(), ATTESTORS);
        expectRefresh(back, abi.encodeWithSelector(TrustStoreLayout.DescriptorRevoked.selector));
    }

    function test_refresh_needs_threshold_of_attestors() public {
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        bytes[] memory none = new bytes[](0);
        (bool ok, bytes memory ret) = address(rpm).call(abi.encodeCall(TrustAdmin.refreshTrust, (u, none)));
        assertFalse(ok);
        assertEq(errorName(ret), TrustStoreLayout.NotEnoughAttestors.selector);
    }

    function test_policy_default_refusals() public view {
        uint256[6] memory bits = [uint256(1), 2, 4, 64, 128, 16 | 8];
        for (uint256 i = 0; i < bits.length; i++) {
            try rpm.applyPolicyView(bits[i], 0) {
                revert("should refuse");
            } catch {}
        }
        rpm.applyPolicyView(8, 0); // NO_MIN_OUT alone is shown, not refused
        rpm.applyPolicyView(16, 0); // an attested hook with a minimum is shown, not refused
    }

    function test_isValidSignature_is_off() public view {
        assertEq(account.isValidSignature(bytes32(0), ""), bytes4(0xffffffff));
    }
}
