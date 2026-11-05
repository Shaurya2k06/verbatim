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
        (bool ok, ) = run(plan(transferCall(BOB, 1e6), 1000));
        assertTrue(ok);
        assertEq(usdc.balanceOf(BOB), 1e6);
    }

    function test_A1_swap_recipient_rejected() public {
        Plan memory honest = plan(transferCall(BOB, 1e6), 1000);
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
        Plan memory honest = plan(_swapCalls(address(0), 2000e6), 1000);
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
        Plan memory truth = _withHookHint(plan(_swapCalls(hook, 0), 1000), hook);
        load(truth);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.PolicyRefused.selector, truth.risk));
    }

    function test_A3_drop_renderer_frame_rejected() public {
        load(plan(transferCall(BOB, 1e6), 1000));
        env.popFrame();
        env.popFrame();
        (bool ok, ) = callFrame(0, address(account), address(0xaa));
        assertFalse(ok);
    }

    function test_A3_self_pay_layout_rejected() public {
        load(plan(transferCall(BOB, 1e6), 1000));
        env.setFrameFlags(0, 3);
        env.setFrameTarget(1, address(0x1234));
        expectFrame0(abi.encodeWithSelector(VerbatimAccountBase.BadLayout.selector, uint256(3)));
    }

    function test_A4_weaker_spec_signed_rejected() public {
        Plan memory p = plan(transferCall(BOB, 1e6), 1000);
        bytes memory weak = hex"565300010000";
        bytes32 real = keccak256(p.spec);
        p.spec = weak;
        load(p, keccak256(p.tree), keccak256(weak));
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.SpecHashMismatch.selector, keccak256(weak), real));
    }

    function test_A4_weak_bytes_under_honest_hash_rejected() public {
        Plan memory p = plan(transferCall(BOB, 1e6), 1000);
        bytes32 specHash = keccak256(p.spec);
        bytes32 tree = keccak256(p.tree);
        p.spec = hex"565300010000";
        load(p, tree, specHash);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.SpecHashMismatch.selector, specHash, keccak256(p.spec)));
    }

    function test_A5_unattested_descriptor_policy_rejected() public {
        GasBurner unattested = new GasBurner();
        Plan memory p = plan(one(address(unattested), hex"deadbeef"), 1000);
        load(p);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.PolicyRefused.selector, p.risk));
    }

    function _vaultApprovals() private {
        (bool ok, ) = run(plan(one(address(usdc), abi.encodeWithSelector(0x095ea7b3, address(vault), uint256(500e6))), uint64(block.number)));
        assertTrue(ok);
        (ok, ) = run(plan(one(address(weth), abi.encodeWithSelector(0x095ea7b3, address(vault), uint256(50e18))), uint64(block.number)));
        assertTrue(ok);
    }

    function test_A6_evil_vault_assertion_reverts_fee_kept() public {
        _vaultApprovals();
        uint256 wethBefore = weth.balanceOf(address(account));
        uint256 usdcBefore = usdc.balanceOf(address(account));
        (uint128 depBefore, ) = rpm.deposits(address(account), address(0));
        Plan memory p = plan(one(address(vault), abi.encodeWithSelector(0xb6b55f25, uint256(100e6))), uint64(block.number));
        (bool ok, bytes memory err) = run(p);
        assertFalse(ok);
        assertEq(errorName(err), AssertionKit.AssertionFailed.selector);
        assertEq(weth.balanceOf(address(account)), wethBefore, "pull undone");
        assertEq(usdc.balanceOf(address(account)), usdcBefore, "deposit undone");
        assertEq(weth.balanceOf(THIEF), 0);
        (uint128 depAfter, ) = rpm.deposits(address(account), address(0));
        assertEq(depBefore - depAfter, p.fee.amount, "fee kept");
    }

    function test_A7_stale_signature_past_ttl_reverts() public {
        Plan memory p = plan(transferCall(BOB, 1e6), 1000);
        vm.roll(1000 + 26);
        (bool ok, bytes memory err) = run(p);
        assertFalse(ok);
        assertEq(errorName(err), VerbatimCore.Expired.selector);
        assertEq(usdc.balanceOf(BOB), 0);
    }

    function test_A9_empty_deposit_rejected() public {
        // Drain the deposit through the account's own delayed withdrawal, then try again.
        vm.prank(address(account));
        rpm.requestWithdraw(address(0), 1 ether);
        Plan memory p = plan(transferCall(BOB, 1e6), 1000);
        load(p);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.InsufficientDeposit.selector, uint256(0), p.fee.amount * 4));
    }

    function test_A9_withdrawal_cannot_mature_inside_ttl() public {
        Plan memory p = plan(transferCall(BOB, 1e6), 1000);
        vm.prank(address(account));
        rpm.requestWithdraw(address(0), 0.5 ether);
        // The transaction's whole lifetime is 25 blocks of 6 s; the delay is an hour.
        assertGt(rpm.WITHDRAW_DELAY(), rpm.ttlOf(address(account)) * 12);
        vm.warp(block.timestamp + 25 * 12);
        vm.prank(address(account));
        vm.expectRevert();
        rpm.withdraw(address(0));
        (bool ok, ) = run(p);
        assertTrue(ok, "the pending transaction's fee is still there");
    }

    function test_A10_7702_delegated_sender_rejected() public {
        address eoa = vm.addr(0xE0A);
        vm.etch(eoa, bytes.concat(hex"ef0100", abi.encodePacked(address(account))));
        Plan memory p = plan(transferCall(BOB, 1e6), 1000);
        load(p);
        env.setTx(eoa, 1, 1, 100);
        expectFrame1(abi.encodeWithSelector(RendererPaymasterBase.NotCanonicalSender.selector, eoa.codehash));
    }

    function test_A10_empty_storage_delegator_cannot_approve() public {
        // Running the account's code with threshold zero must not approve without signatures.
        TestAccount delegate = account;
        vm.store(address(delegate), bytes32(uint256(2)), bytes32(0));
        load(plan(transferCall(BOB, 1e6), 1000));
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
        (bool ok, bytes memory err) = run(plan(one(address(r), abi.encodeCall(Reenterer.attack, (address(account), inner))), 1000));
        assertFalse(ok);
        assertEq(errorName(err), VerbatimCore.CallFailed.selector);
        assertEq(usdc.balanceOf(THIEF), 0);
    }

    function test_A11_self_batch_cannot_reenter_protected() public {
        // Unattested selector on the account's own code renders blind: the batch cannot even be validated.
        Plan memory p = plan(one(address(account), abi.encodeCall(VerbatimCore.protectedBatch, (transferCall(THIEF, 1), "", bytes32(0), 0))), 1000);
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
        Plan memory p = plan(one(address(g), abi.encodeCall(GasBurner.burn, ())), 1000);
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
