// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, TestAccount} from "./Base.t.sol";
import {FrameEnv} from "./MockFrames.sol";
import {VerbatimCore, VerbatimAccountBase} from "../src/account/VerbatimAccount.sol";
import {RendererCore, RendererPaymasterBase} from "../src/paymaster/RendererPaymaster.sol";
import {AssertionKit} from "../src/lib/AssertionKit.sol";
import {VSpec} from "../src/lib/VTree.sol";
import {GasBurner, Reenterer, ReturnBomb} from "../src/demo/EvilVault.sol";
import {TrustStoreLayout} from "../src/trust/TrustStore.sol";
import {SkimHook} from "../src/demo/SkimHook.sol";
import {TestToken} from "../src/demo/TestTokens.sol";
import {MockPermit2} from "./Base.t.sol";

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
        env.setFrameFlags(1, 3);
        expectFrame0(abi.encodeWithSelector(VerbatimAccountBase.BadLayout.selector, uint256(3)));
    }

    function test_A4_weaker_spec_signed_rejected() public {
        Plan memory p = plan(transferCall(BOB, 1e6), T0 + 100);
        bytes memory weak = hex"565300020000";
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
        p.spec = hex"565300020000";
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

    /// No batch can leave these behind any more (D9, B14). This models an allowance granted before the account's rules
    /// could see it, to show TRACKED_NO_DECREASE still holds if one ever exists.
    function _vaultApprovals() private {
        account.watchForTest(address(weth));
        vm.startPrank(address(account));
        usdc.approve(address(vault), 500e6);
        weth.approve(address(vault), 50e18);
        vm.stopPrank();
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
        assertEq(admin_().feesAccrued(address(0)) - feesBefore, FEE, "fee kept");
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
        // The same content is refused outright (I13). A new sentence on the same nonce finds the ticket spent.
        load(plan(transferCall(BOB, 2), T0 + 100));
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.NoTicket.selector, uint256(60), FEE));
    }

    function test_A15_revocation_drops_only_dependents() public {
        Plan memory dep = plan(transferCall(BOB, 1), T0 + 100);
        Plan memory other = plan(one(address(usdc), abi.encodeWithSelector(0x095ea7b3, address(p2), uint256(1))), T0 + 100);
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
        Plan memory p = plan(_routerRaw(hex"10", abi.encode(hex"090c0f", params)), T0 + 100);
        load(p);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.PolicyRefused.selector, p.risk));
    }

    function test_D17_approvals_to_unattested_spenders_are_refused() public {
        address stranger = address(0xBEEF);
        bytes[3] memory data = [abi.encodeWithSelector(0x095ea7b3, stranger, uint256(5)), abi.encodeWithSelector(bytes4(keccak256("setApprovalForAll(address,bool)")), stranger, true), abi.encodeWithSelector(bytes4(keccak256("approve(address,address,uint160,uint48)")), address(usdc), stranger, uint256(5), uint256(9))];
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](2);
        u.descriptors[0] = _du(address(usdc).codehash, bytes4(keccak256("setApprovalForAll(address,bool)")), bytes.concat(hex"56440001", hex"03", "All", hex"02", hex"02", hex"0100", hex"01", hex"02", "Op", hex"03", hex"0101", hex"04", hex"02", "On", hex"01", hex"04", hex"00", hex"0100", hex"0101", hex"0002"));
        u.descriptors[1] = _du(address(usdc).codehash, bytes4(keccak256("approve(address,address,uint160,uint48)")), bytes.concat(hex"56440001", hex"03", "P2A", hex"04", hex"01", hex"0101", hex"01", hex"02", "Sp", hex"02", hex"01", hex"07", hex"01", hex"0100", hex"0101", hex"0102", hex"0000"));
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
        uint256 p = 4 + 8 + 20 + 8 + 32 + 4 + 1;
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

    function test_A9_ticket_must_cover_max_cost() public {
        rpm.setTicketForTest(address(account), nonceNow, uint128(FEE - 1));
        Plan memory p = plan(transferCall(BOB, 1e6), T0 + 100);
        load(p);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.NoTicket.selector, nonceNow, FEE));
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
        (bool ok, ) = callFrame(1, address(delegate), address(0xaa));
        assertFalse(ok);
    }

    function test_A11_reentrancy_reverts() public {
        Reenterer r = new Reenterer();
        bytes memory inner = abi.encodeCall(VerbatimAccountBase.executeVerified, (transferCall(THIEF, 1e6), ""));
        // Direct, from outside.
        vm.expectRevert(VerbatimCore.NotSelf.selector);
        account.protectedBatch(transferCall(THIEF, 1), "", bytes32(0), 0);
        vm.prank(address(0xBAD));
        vm.expectRevert(VerbatimCore.NotSelf.selector);
        VerbatimAccountBase(payable(address(account))).executeVerified(transferCall(THIEF, 1e6), "");
        // From inside a batch, via a called contract.
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](1);
        u.descriptors[0] = _du(address(r).codehash, Reenterer.attack.selector, bytes.concat(hex"56440001", hex"06", "Attack", hex"ff", hex"00", hex"00", hex"0000"));
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
        u.descriptors[0] = _du(address(g).codehash, GasBurner.burn.selector, bytes.concat(hex"56440001", hex"04", "Burn", hex"00", hex"00", hex"00", hex"0000"));
        refresh(u);
        Plan memory p = plan(one(address(g), abi.encodeCall(GasBurner.burn, ())), T0 + 100);
        load(p);
        frame0();
        frame1();
        env.setCurrent(3);
        bytes memory f2 = env.frame(3).data;
        vm.prank(address(account));
        (bool ok, ) = address(account).call{gas: 3_000_000}(f2);
        assertTrue(ok, "frame 2 survives");
        assertEq(usdc.balanceOf(BOB), 0);
    }

    /// A18: a call that reverts with megabytes must not cost the account more than its reserves, or the fee goes with it.
    function test_A18_return_bomb_does_not_undo_the_fee() public {
        ReturnBomb b = new ReturnBomb();
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](1);
        u.descriptors[0] = _du(address(b).codehash, ReturnBomb.detonate.selector, bytes.concat(hex"56440001", hex"08", "Detonate", hex"01", hex"00", hex"00", hex"0000"));
        refresh(u);
        uint256[5] memory sizes = [uint256(10_000), 100_000, 300_000, 500_000, 700_000];
        uint256 reached;
        for (uint256 i = 0; i < sizes.length; i++) {
            uint256 feesBefore = admin_().feesAccrued(address(0));
            Plan memory p = plan(one(address(b), abi.encodeCall(ReturnBomb.detonate, (sizes[i]))), T0 + 100);
            load(p);
            frame0();
            frame1();
            env.setCurrent(3);
            bytes memory f2 = env.frame(3).data;
            vm.prank(address(account));
            // The execution gas the client gives frame 2.
            (bool ok, ) = address(account).call{gas: 1_200_000}(f2);
            assertTrue(ok, "frame 2 survives the bomb");
            assertGt(admin_().feesAccrued(address(0)), feesBefore, "the fee stayed paid");
            nonceNow++;
            reached++;
        }
        assertEq(reached, sizes.length);
    }

    /// The deposit an account can really make under D9: ETH in, shares promised, nothing credited.
    function test_A6_evil_vault_keeps_eth_credits_no_shares() public {
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](1);
        u.descriptors[0] = _du(address(vault).codehash, vault.depositEth.selector, depositEthDesc());
        refresh(u);
        uint256 ethBefore = address(account).balance;
        uint256 feesBefore = admin_().feesAccrued(address(0));
        VerbatimCore.Call[] memory c = one(address(vault), abi.encodeCall(vault.depositEth, (1e18)));
        c[0].value = 1e17;
        (bool ok, bytes memory err) = run(plan(c, T0 + 100));
        assertFalse(ok);
        assertEq(errorName(err), AssertionKit.AssertionFailed.selector);
        assertEq(address(account).balance, ethBefore, "the ETH came back");
        assertEq(THIEF.balance, 0);
        assertEq(admin_().feesAccrued(address(0)) - feesBefore, FEE, "fee kept");
    }

    /// A7b: an expiry frame starved of gas has status 0 and the deployed node still includes the transaction, so the limit is checked.
    function test_A7b_failed_expiry_frame_is_refused() public {
        load(plan(transferCall(BOB, 1e6), T0 + 100));
        env.setFrameGas(0, 2_000);
        expectFrame0(abi.encodeWithSelector(VerbatimAccountBase.BadLayout.selector, uint256(8)));
    }

    function test_A7c_expiry_frame_must_be_the_real_verifier() public {
        Plan memory p = plan(transferCall(BOB, 1e6), T0 + 100);
        load(p);
        env.setFrameTarget(0, address(0x1234));
        expectFrame0(abi.encodeWithSelector(VerbatimAccountBase.BadLayout.selector, uint256(8)));
        load(p);
        env.setFrameData(0, abi.encodePacked(uint256(1)));
        expectFrame0(abi.encodeWithSelector(VerbatimAccountBase.BadLayout.selector, uint256(8)));
    }

    /// B12 and I13: the same signed content cannot run twice, whatever carries it.
    function test_B12_I13_same_digest_cannot_execute_twice() public {
        Plan memory p = plan(transferCall(BOB, 1e6), T0 + 100);
        (bool ok, ) = run(p);
        assertTrue(ok);
        assertEq(usdc.balanceOf(BOB), 1e6);
        nonceNow--; // same nonce sequence again, so the digest is the same; only a different key could carry it
        load(p);
        (, uint256 d) = (0, uint256(account.digestOf(keccak256(p.tree), keccak256(p.spec), p.expiry, ROOT, 2, txCommit())));
        expectFrame0(abi.encodeWithSelector(VerbatimCore.Replayed.selector, bytes32(d)));
        assertTrue(account.consumed(bytes32(d)));
    }

    /// A failed batch still consumes the digest: the signature does not stay live for a retry at a worse moment.
    function test_I13_reverted_batch_also_consumes() public {
        Plan memory p = plan(transferCall(BOB, 2000e6), T0 + 100); // more than it holds
        load(p);
        bytes32 d = account.digestOf(keccak256(p.tree), keccak256(p.spec), p.expiry, ROOT, 2, txCommit());
        frame0();
        frame1();
        (bool ok, ) = frame2();
        assertFalse(ok);
        assertTrue(account.consumed(d));
    }

    /// B14 and I12: an approval still standing after the batch fails APPROVALS_CLEARED.
    function test_B14_I12_erc20_approval_left_standing_reverts() public {
        Plan memory p = plan(one(address(usdc), abi.encodeWithSelector(0x095ea7b3, address(vault), uint256(5))), T0 + 100);
        (bool ok, bytes memory err) = run(p);
        assertFalse(ok);
        assertEq(errorName(err), AssertionKit.AssertionFailed.selector);
        assertEq(usdc.allowance(address(account), address(vault)), 0);
    }

    function test_B14_I12_permit2_sub_allowance_left_standing_reverts() public {
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](1);
        u.descriptors[0] = _du(address(p2).codehash, MockPermit2.approve.selector, p2ApproveDesc());
        u.spenders = new address[](1);
        u.spenders[0] = address(router);
        refresh(u);
        Plan memory p = plan(one(address(p2), abi.encodeCall(MockPermit2.approve, (address(usdc), address(router), 5, uint48(T0 + 100)))), T0 + 100);
        (bool ok, bytes memory err) = run(p);
        assertFalse(ok);
        assertEq(errorName(err), AssertionKit.AssertionFailed.selector);
        assertEq(p2.amounts(address(account), address(usdc), address(router)), 0);
    }

    function test_I12_base_allowance_to_permit2_is_the_one_exception_and_enters_the_ledger() public {
        (bool ok, ) = run(plan(one(address(usdc), abi.encodeWithSelector(0x095ea7b3, address(p2), uint256(5))), T0 + 100));
        assertTrue(ok);
        assertEq(account.ledger().length, 1);
        assertEq(account.ledger()[0], address(usdc));
        // Back to zero, and the ledger prunes it.
        (ok, ) = run(plan(one(address(usdc), abi.encodeWithSelector(0x095ea7b3, address(p2), uint256(0))), T0 + 100));
        assertTrue(ok);
        assertEq(account.ledger().length, 0);
    }

    function test_ledger_cap_is_enforced() public {
        assertEq(account.MAX_LEDGER(), 16);
        for (uint256 i = 0; i < 17; i++) {
            TestToken t = new TestToken("T", "T", 6);
            TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
            u.tokens = new TrustStoreLayout.TokenUpdate[](1);
            u.tokens[0] = TrustStoreLayout.TokenUpdate(address(t), bytes11("T"), 1, 6, 0);
            refresh(u);
            (bool ok, bytes memory err) = run(plan(one(address(t), abi.encodeWithSelector(0x095ea7b3, address(p2), uint256(5))), T0 + 100));
            if (i < 16) assertTrue(ok);
            else {
                assertFalse(ok);
                assertEq(errorName(err), VerbatimCore.LedgerFull.selector);
            }
        }
        assertEq(account.ledger().length, 16);
    }

    /// D2: the paymaster refuses entries signed over anything but its own render, even if the account's frame agreed.
    function test_D2_paymaster_rebuilds_the_digest() public {
        Plan memory p = plan(transferCall(BOB, 1e6), T0 + 100);
        load(p);
        frame0();
        // Same claimed hashes in frame 1, different signed content: only the digest rebuild can see this.
        bytes32 d = account.digestOf(keccak256(p.tree), keccak256(p.spec), p.expiry, keccak256("another root"), 2, txCommit());
        (FrameEnv.Sig memory a, FrameEnv.Sig memory b) = (env.sig(0), env.sig(1));
        a.msgHash = d;
        b.msgHash = d;
        env.setSig(0, a);
        env.setSig(1, b);
        bytes32 expected = account.digestOf(keccak256(p.tree), keccak256(p.spec), p.expiry, ROOT, 2, txCommit());
        expectFrame1(abi.encodeWithSelector(RendererCore.DigestMismatch.selector, expected, d));
    }

    function test_policy_lives_in_the_account_and_a_snapshot_cannot_outlive_the_cap() public {
        // A snapshot with too long a life is refused on the paymaster path.
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.expiry = uint64(block.timestamp + 7 hours);
        refresh(u);
        Plan memory p = plan(transferCall(BOB, 1), T0 + 100);
        load(p);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.SnapshotTtlTooLong.selector, uint256(7 hours), uint256(6 hours)));
    }

    function test_expiry_past_the_snapshot_is_refused() public {
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.expiry = uint64(block.timestamp + 50);
        refresh(u);
        Plan memory p = plan(transferCall(BOB, 1), T0 + 100);
        load(p);
        frame0();
        expectFrame1(abi.encodeWithSelector(RendererCore.SnapshotExpiresTooSoon.selector, uint64(T0 + 100), uint64(block.timestamp + 50)));
    }

    /// The table in VSpec.itemSize, item by item.
    function test_item_sizes_are_the_documented_ones() public pure {
        uint256[15] memory want = [uint256(0), 72, 72, 72, 80, 41, 72, 52, 20, 0, 0, 1, 0, 44, 72];
        for (uint8 op = 1; op <= 14; op++) assertEq(VSpec.itemSize(op), want[op]);
    }
}
