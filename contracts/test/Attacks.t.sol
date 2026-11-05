// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, TestAccount} from "./Base.t.sol";
import {FrameEnv} from "./MockFrames.sol";
import {VerbatimCore, VerbatimAccountBase} from "../src/account/VerbatimAccount.sol";
import {RendererCore, RendererPaymasterBase} from "../src/paymaster/RendererPaymaster.sol";
import {AssertionKit} from "../src/lib/AssertionKit.sol";
import {GasBurner, Reenterer} from "../src/demo/EvilVault.sol";
import {TrustStoreLayout} from "../src/trust/TrustStore.sol";
import {SkimHook} from "../src/demo/SkimHook.sol";

/// The attack kit (§15), under the mock protocol. docs/PROOFS.md has the same attacks on the live devnet.
contract AttacksTest is Base {
    function test_honest_transfer_lands() public {
        (bool ok, ) = run(plan(transferCall(BOB, 1e6), T0 + 100));
        assertTrue(ok);
        assertEq(usdc.balanceOf(BOB), 1e6);
    }

    function test_A1_swap_recipient_rejected() public {
        Plan memory honest = plan(transferCall(BOB, 1e6), T0 + 100);
        Plan memory lie = honest;
        lie.calls = transferCall(THIEF, 1e6);
        load(lie, keccak256(honest.tree), keccak256(honest.spec));
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.TreeMismatch.selector, keccak256(honest.tree), keccak256(_treeOf(lie))));
    }

    function _treeOf(Plan memory p) private view returns (bytes memory tree) {
        (tree, , ) = rpm.renderView(input(p));
    }

    function _swapCalls(address hook, uint128 minOut) internal view returns (VerbatimCore.Call[] memory) {
        address c0 = address(usdc) < address(weth) ? address(usdc) : address(weth);
        address c1 = c0 == address(usdc) ? address(weth) : address(usdc);
        bool zeroForOne = c0 == address(weth);
        bytes memory fixedSwap = abi.encode(SwapT(PoolKeyT(c0, c1, 3000, 60, hook), zeroForOne, uint128(1e18), minOut, uint256(0), bytes("")));
        bytes[] memory params = new bytes[](3);
        params[0] = fixedSwap;
        params[1] = abi.encode(address(weth), uint256(1e18));
        params[2] = abi.encode(address(usdc), uint256(minOut));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0f", params);
        return one(address(router), abi.encodeWithSelector(0x3593564c, hex"10", inputs, uint256(2e9)));
    }

    struct PoolKeyT {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct SwapT {
        PoolKeyT poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    /// Lands a hook whose low bits carry AFTER_SWAP_RETURNS_DELTA, unattested.
    function _skimAddr() private returns (address hook) {
        hook = address(uint160((uint256(uint160(address(0x123456789))) << 14) | 0x44));
        vm.etch(hook, hex"00");
    }

    function _withHookHint(Plan memory p, address hook) private view returns (Plan memory) {
        address[] memory h = new address[](p.hints.length + 1);
        for (uint256 i = 0; i < p.hints.length; i++) h[i] = p.hints[i];
        h[p.hints.length] = hook;
        p.hints = h;
        (p.tree, p.spec, p.risk) = rpm.renderView(input(p));
        return p;
    }

    function test_A2_minOutZero_skimHook_lying_sentence_rejected() public {
        address hook = _skimAddr();
        Plan memory honest = plan(_swapCalls(address(0), 2000e6), T0 + 100);
        Plan memory lie = honest;
        lie.calls = _swapCalls(hook, 0);
        lie = _withHookHint(lie, hook);
        bytes32 liedTree = keccak256(lie.tree);
        lie.tree = honest.tree;
        lie.spec = honest.spec;
        load(lie, keccak256(honest.tree), keccak256(honest.spec));
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.TreeMismatch.selector, keccak256(honest.tree), liedTree));
    }

    function test_A2_minOutZero_skimHook_true_sentence_policy_rejected() public {
        address hook = _skimAddr();
        Plan memory truth = _withHookHint(plan(_swapCalls(hook, 0), T0 + 100), hook);
        load(truth);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.PolicyRefused.selector, truth.risk));
    }

    function test_A3_drop_renderer_frame_rejected() public {
        load(plan(transferCall(BOB, 1e6), T0 + 100));
        env.popFrame();
        env.popFrame();
        expectFrame0(abi.encodeWithSelector(VerbatimAccountBase.BadLayout.selector, uint256(0)));
    }

    function test_A3_self_pay_layout_rejected() public {
        load(plan(transferCall(BOB, 1e6), T0 + 100));
        env.setFrameFlags(0, 3);
        expectFrame0(abi.encodeWithSelector(VerbatimAccountBase.BadLayout.selector, uint256(3)));
    }

    function test_A4_weaker_spec_signed_rejected() public {
        Plan memory p = plan(transferCall(BOB, 1e6), T0 + 100);
        bytes memory weak = hex"565300010000";
        bytes32 real = keccak256(p.spec);
        p.spec = weak;
        load(p, keccak256(p.tree), keccak256(weak));
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.SpecHashMismatch.selector, keccak256(weak), real));
    }

    function test_A4_weak_bytes_under_honest_hash_rejected() public {
        Plan memory p = plan(transferCall(BOB, 1e6), T0 + 100);
        bytes32 specHash = keccak256(p.spec);
        bytes32 tree = keccak256(p.tree);
        p.spec = hex"565300010000";
        load(p, tree, specHash);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.SpecHashMismatch.selector, specHash, keccak256(p.spec)));
    }

    function test_A5_unattested_descriptor_policy_rejected() public {
        GasBurner unattested = new GasBurner();
        Plan memory p = plan(one(address(unattested), hex"deadbeef"), T0 + 100);
        load(p);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.PolicyRefused.selector, p.risk));
    }

    function _vaultApprovals() private {
        (bool ok, ) = run(plan(one(address(usdc), abi.encodeWithSelector(0x095ea7b3, address(vault), uint256(500e6))), T0 + 100));
        assertTrue(ok);
        (ok, ) = run(plan(one(address(weth), abi.encodeWithSelector(0x095ea7b3, address(vault), uint256(50e18))), T0 + 100));
        assertTrue(ok);
    }

    function test_A6_evil_vault_assertion_reverts_fee_kept() public {
        _vaultApprovals();
        uint256 wethBefore = weth.balanceOf(address(account));
        uint256 usdcBefore = usdc.balanceOf(address(account));
        uint256 feesBefore = admin_().feesAccrued(address(0));
        Plan memory p = plan(one(address(vault), abi.encodeWithSelector(0xb6b55f25, uint256(100e6))), T0 + 100);
        (bool ok, bytes memory err) = run(p);
        assertFalse(ok);
        assertEq(errorName(err), AssertionKit.AssertionFailed.selector);
        assertEq(weth.balanceOf(address(account)), wethBefore, "pull undone");
        assertEq(usdc.balanceOf(address(account)), usdcBefore, "deposit undone");
        assertEq(weth.balanceOf(THIEF), 0);
        assertEq(admin_().feesAccrued(address(0)) - feesBefore, p.fee.amount, "fee kept");
    }

    function test_A7_stale_signature_past_validUntil_reverts() public {
        Plan memory p = plan(transferCall(BOB, 1e6), T0 + 100);
        vm.warp(T0 + 101);
        (bool ok, bytes memory err) = run(p);
        assertFalse(ok);
        assertEq(errorName(err), VerbatimCore.Expired.selector);
        assertEq(usdc.balanceOf(BOB), 0);
    }

    function test_A13_future_dated_validUntil_is_capped_by_policy() public {
        Plan memory p = plan(transferCall(BOB, 1e6), T0 + 301);
        (bool ok, bytes memory err) = run(p);
        assertFalse(ok);
        assertEq(errorName(err), VerbatimCore.TtlTooLong.selector);
        assertEq(usdc.balanceOf(BOB), 0);
    }

    function test_A14_two_transactions_cannot_share_one_ticket() public {
        // Two sentences, one prepaid fee: only nonce 50 has a ticket.
        rpm.setTicketForTest(address(account), 51, 0);
        nonceNow = 50;
        Plan memory first = plan(transferCall(BOB, 1), T0 + 100);
        load(first);
        frame0();
        frame1();
        nonceNow = 51;
        Plan memory second = plan(transferCall(BOB, 2), T0 + 100);
        load(second);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.NoTicket.selector, uint256(51), FEE));
    }

    function test_A14_a_ticket_is_spent_once() public {
        nonceNow = 60;
        Plan memory p = plan(transferCall(BOB, 1), T0 + 100);
        load(p);
        frame0();
        frame1();
        frame2();
        // Replaying the same nonce finds nothing, whatever the protocol does about the nonce itself.
        load(p);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.NoTicket.selector, uint256(60), FEE));
    }

    function test_A15_revocation_drops_only_dependents() public {
        Plan memory dep = plan(transferCall(BOB, 1), T0 + 100);
        Plan memory other = plan(one(address(usdc), abi.encodeWithSelector(0x095ea7b3, address(vault), uint256(1))), T0 + 100);
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.revocations = new TrustStoreLayout.Revocation[](1);
        u.revocations[0] = TrustStoreLayout.Revocation(address(usdc).codehash, 0xa9059cbb);
        refresh(u);
        load(dep);
        frame0();
        (, , uint256 risk) = rpm.renderView(input(dep));
        expectFrame1(abi.encodeWithSelector(RendererCore.TreeMismatch.selector, keccak256(dep.tree), keccak256(_treeOf(dep))));
        assertTrue(risk != 0);
        (bool ok, ) = run(other);
        assertTrue(ok, "the independent one still lands");
    }

    function _routerRaw(bytes memory commands, bytes memory input0) private view returns (VerbatimCore.Call[] memory) {
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = input0;
        return one(address(router), abi.encodeWithSelector(0x3593564c, commands, inputs, uint256(2e9)));
    }

    function test_A16_allow_revert_is_shown_then_refused() public {
        Plan memory p = plan(_routerRaw(hex"90", _swapInput(address(0), 2000e6)), T0 + 100);
        assertTrue(_hasRisk(p.tree, 0x0108), "UR_ALLOW_REVERT in the sentence");
        load(p);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.PolicyRefused.selector, p.risk));
    }

    function test_A17_unknown_command_is_blind_and_refused() public {
        Plan memory p = plan(_routerRaw(hex"0a", hex"1234"), T0 + 100);
        load(p);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.PolicyRefused.selector, p.risk));
    }

    function test_A17_unknown_v4_action_is_blind_and_refused() public {
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(uint256(1));
        params[1] = abi.encode(uint256(2));
        params[2] = abi.encode(uint256(3));
        Plan memory p = plan(_routerRaw(hex"10", abi.encode(hex"070c0f", params)), T0 + 100);
        load(p);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.PolicyRefused.selector, p.risk));
    }

    function test_D17_approvals_to_unattested_spenders_are_refused() public {
        address stranger = address(0xBEEF);
        bytes[3] memory data = [abi.encodeWithSelector(0x095ea7b3, stranger, uint256(5)), abi.encodeWithSelector(bytes4(keccak256("setApprovalForAll(address,bool)")), stranger, true), abi.encodeWithSelector(bytes4(keccak256("approve(address,address,uint160,uint48)")), address(usdc), stranger, uint256(5), uint256(9))];
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](2);
        u.descriptors[0] = TrustStoreLayout.DescUpdate(address(usdc).codehash, bytes4(keccak256("setApprovalForAll(address,bool)")), bytes.concat(hex"56440001", hex"03", "All", hex"02", hex"02", hex"0100", hex"01", hex"02", "Op", hex"03", hex"0101", hex"04", hex"02", "On", hex"01", hex"04", hex"00", hex"0100", hex"0101", hex"0002"), ATTESTORS);
        u.descriptors[1] = TrustStoreLayout.DescUpdate(address(usdc).codehash, bytes4(keccak256("approve(address,address,uint160,uint48)")), bytes.concat(hex"56440001", hex"03", "P2A", hex"04", hex"01", hex"0101", hex"01", hex"02", "Sp", hex"02", hex"01", hex"07", hex"01", hex"0100", hex"0101", hex"0102", hex"0000"), ATTESTORS);
        refresh(u);
        for (uint256 i = 0; i < 3; i++) {
            Plan memory p = plan(one(address(usdc), data[i]), T0 + 100);
            assertTrue(_hasRisk(p.tree, 0x0009), "SPENDER_UNATTESTED");
            load(p);
            frame0();
            expectFrame1(abi.encodeWithSelector(RendererCore.PolicyRefused.selector, p.risk));
        }
        // Revoking is always allowed: an approval down to zero grants nothing.
        (bool ok, ) = run(plan(one(address(usdc), abi.encodeWithSelector(0x095ea7b3, stranger, uint256(0))), T0 + 100));
        assertTrue(ok);
    }

    function _hasRisk(bytes memory tree, uint16 code) private pure returns (bool) {
        uint256 p = 4 + 8 + 20 + 8;
        while (p < tree.length) {
            uint8 kind = uint8(tree[p]);
            uint256 len = (uint256(uint8(tree[p + 1])) << 8) | uint8(tree[p + 2]);
            if (kind == 0x30 && ((uint16(uint8(tree[p + 3])) << 8) | uint8(tree[p + 4])) == code) return true;
            p += 3 + len;
        }
        return false;
    }

    function _swapInput(address hook, uint128 minOut) private view returns (bytes memory) {
        (, , bytes memory data) = (address(0), uint256(0), _swapCalls(hook, minOut)[0].data);
        bytes memory payload = new bytes(data.length - 4);
        for (uint256 i = 0; i < payload.length; i++) payload[i] = data[i + 4];
        (, bytes[] memory inputs, ) = abi.decode(payload, (bytes, bytes[], uint256));
        return inputs[0];
    }

    function test_A9_no_ticket_rejected() public {
        nonceNow = 1000;
        Plan memory p = plan(transferCall(BOB, 1e6), T0 + 100);
        load(p);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.NoTicket.selector, uint256(1000), FEE));
    }

    function test_A9_fee_must_cover_max_cost() public {
        Plan memory p = plan(transferCall(BOB, 1e6), T0 + 100);
        load(p);
        env.setMaxCost(FEE + 1);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.FeeTooLow.selector, FEE + 1, FEE));
    }

    function test_A9_reclaim_cannot_mature_inside_a_signature_lifetime() public {
        Plan memory p = plan(transferCall(BOB, 1e6), T0 + 100);
        load(p);
        frame0();
        frame1();
        vm.prank(address(account));
        admin_().requestReclaim(1);
        // The max lifetime of a signature is 300 s; reclaiming takes an hour.
        assertGt(admin_().WITHDRAW_DELAY(), 300);
        vm.prank(address(account));
        vm.expectRevert();
        admin_().reclaim(1);
        // The pending transaction still pays.
        (bool ok, ) = frame2();
        assertTrue(ok);
        // A new one on a ticket under reclaim does not validate.
        vm.prank(address(account));
        admin_().requestReclaim(2);
        nonceNow = 2;
        Plan memory q = plan(transferCall(BOB, 1), T0 + 100);
        load(q);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.NoTicket.selector, uint256(2), FEE));
    }

    function test_A10_7702_delegated_sender_rejected() public {
        address eoa = vm.addr(0xE0A);
        vm.etch(eoa, bytes.concat(hex"ef0100", abi.encodePacked(address(account))));
        Plan memory p = plan(transferCall(BOB, 1e6), T0 + 100);
        load(p);
        env.setTx(eoa, 1, 1, 100);
        expectFrame1(abi.encodeWithSelector(RendererPaymasterBase.NotCanonicalSender.selector, eoa.codehash));
    }

    function test_A10_empty_storage_delegator_cannot_approve() public {
        // Running the account's code with threshold zero must not approve without signatures.
        TestAccount delegate = account;
        vm.store(address(delegate), bytes32(uint256(2)), bytes32(0));
        load(plan(transferCall(BOB, 1e6), T0 + 100));
        (bool ok, ) = callFrame(0, address(delegate), address(0xaa));
        assertFalse(ok);
    }

    function test_A11_reentrancy_reverts() public {
        Reenterer r = new Reenterer();
        bytes memory inner = abi.encodeCall(VerbatimAccountBase.executeVerified, (VerbatimCore.Fee(address(0), 0), transferCall(THIEF, 1e6), ""));
        // Direct, from outside.
        vm.expectRevert(VerbatimCore.NotSelf.selector);
        account.protectedBatch(transferCall(THIEF, 1), "", bytes32(0), 0);
        vm.prank(address(0xBAD));
        vm.expectRevert(VerbatimCore.NotSelf.selector);
        VerbatimAccountBase(payable(address(account))).executeVerified(VerbatimCore.Fee(address(0), 0), transferCall(THIEF, 1e6), "");
        // From inside a batch, via a called contract.
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](1);
        u.descriptors[0] = TrustStoreLayout.DescUpdate(address(r).codehash, Reenterer.attack.selector, bytes.concat(hex"56440001", hex"06", "Attack", hex"ff", hex"00", hex"00", hex"0000"), ATTESTORS);
        refresh(u);
        (bool ok, bytes memory err) = run(plan(one(address(r), abi.encodeCall(Reenterer.attack, (address(account), inner))), T0 + 100));
        assertFalse(ok);
        assertEq(errorName(err), VerbatimCore.CallFailed.selector);
        assertEq(usdc.balanceOf(THIEF), 0);
    }

    function test_A11_self_batch_cannot_reenter_protected() public {
        // Unattested selector on the account's own code renders blind: the batch cannot even be validated.
        Plan memory p = plan(one(address(account), abi.encodeCall(VerbatimCore.protectedBatch, (transferCall(THIEF, 1), "", bytes32(0), 0))), T0 + 100);
        load(p);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.PolicyRefused.selector, p.risk));
    }

    function test_A12_gas_griefing_is_safe() public {
        GasBurner g = new GasBurner();
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](1);
        u.descriptors[0] = TrustStoreLayout.DescUpdate(address(g).codehash, GasBurner.burn.selector, bytes.concat(hex"56440001", hex"04", "Burn", hex"00", hex"00", hex"00", hex"0000"), ATTESTORS);
        refresh(u);
        Plan memory p = plan(one(address(g), abi.encodeCall(GasBurner.burn, ())), T0 + 100);
        load(p);
        frame0();
        frame1();
        env.setCurrent(2);
        bytes memory f2 = env.frame(2).data;
        vm.prank(address(account));
        (bool ok, ) = address(account).call{gas: 3_000_000}(f2);
        assertTrue(ok, "frame 2 survives");
        assertEq(usdc.balanceOf(BOB), 0);
    }
}
