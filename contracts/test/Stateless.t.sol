// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, MockPermit2} from "./Base.t.sol";
import {FrameEnv} from "./MockFrames.sol";
import {VerbatimAccountBase, VerbatimCore} from "../src/account/VerbatimAccount.sol";
import {DisplayVM} from "../src/lib/DisplayVM.sol";
import {SnapshotVerifier} from "../src/lib/SnapshotVerifier.sol";
import {AssertionKit} from "../src/lib/AssertionKit.sol";
import {StatelessRenderer} from "../src/stateless/StatelessRenderer.sol";
import {RevocationRegistry} from "../src/stateless/RevocationRegistry.sol";
import {GasBurner, Reenterer, ReturnBomb} from "../src/demo/EvilVault.sol";
import {TestToken} from "../src/demo/TestTokens.sol";

/// Exposes the calldata-based adjacency check to a test.
contract AbsentProbe {
    function check(bytes calldata proofs, bytes32 root, uint256 key) external pure {
        uint256 start;
        assembly ("memory-safe") {
            start := proofs.offset
        }
        uint256 depth = SnapshotVerifier.depthAt(start);
        SnapshotVerifier.Item memory a = SnapshotVerifier.parse(start + 1, depth, start + proofs.length);
        SnapshotVerifier.Item memory b = SnapshotVerifier.parse(a.next, depth, start + proofs.length);
        SnapshotVerifier.verifyAbsent(a, b, depth, root, key);
    }
}

/// A real snapshot tree, built here the same way packages/snapshot-cli does it.
abstract contract SnapshotFixture is Base {
    struct Leaf {
        uint8 kind;
        bytes32[] key;
        bytes32[] value;
        bytes vdesc;
    }

    Leaf[] internal leaves;
    bytes32[][] internal levels;
    uint256 internal depth;
    bytes32 internal root;
    uint64 internal issuedAt;
    uint64 internal snapExpiry;

    address[] internal attestorList;
    address[] internal hintsNow;
    bytes internal proofsNow;

    function setUp() public virtual override {
        super.setUp();
        attestorList.push(vm.addr(AT1));
        attestorList.push(vm.addr(AT2));
        attestorList.push(vm.addr(AT3));
        issuedAt = uint64(block.timestamp);
        snapExpiry = uint64(block.timestamp + 6 hours);
        _addDesc(address(usdc).codehash, 0xa9059cbb, transferDesc());
        _addDesc(address(usdc).codehash, 0x095ea7b3, approveDesc());
        _addToken(address(usdc), "dUSDC", 6, 0);
        _addToken(address(weth), "dWETH", 18, 0);
        _addSpender(address(p2));
        _addSpender(address(vault));
        _addRouter(address(router).codehash);
        _build();
    }

    // --------------------------------------------------------------------------------- the tree ---

    function _two(uint256 a, uint256 b) internal pure returns (bytes32[] memory k) {
        k = new bytes32[](2);
        (k[0], k[1]) = (bytes32(a), bytes32(b));
    }

    function _addDesc(bytes32 ch, bytes4 sel, bytes memory vdesc) internal {
        bytes32[] memory k = new bytes32[](3);
        (k[0], k[1], k[2]) = (bytes32(block.chainid), ch, bytes32(sel));
        bytes32[] memory v = new bytes32[](3);
        (v[0], v[1], v[2]) = (keccak256(vdesc), ATTESTORS, bytes32(uint256(2)));
        leaves.push(Leaf(1, k, v, vdesc));
    }

    function _addToken(address t, string memory symbol, uint8 decimals, uint256 flags) internal {
        bytes32[] memory v = new bytes32[](3);
        bytes memory s = bytes(symbol);
        v[0] = bytes32(uint256(bytes32(s)) | s.length);
        (v[1], v[2]) = (bytes32(uint256(decimals)), bytes32(flags));
        leaves.push(Leaf(2, _two(block.chainid, uint160(t)), v, ""));
    }

    function _addSpender(address a) internal {
        bytes32[] memory v = new bytes32[](1);
        v[0] = bytes32(uint256(1));
        leaves.push(Leaf(7, _two(block.chainid, uint160(a)), v, ""));
    }

    function _addRouter(bytes32 ch) internal {
        bytes32[] memory v = new bytes32[](1);
        v[0] = bytes32(uint256(1));
        leaves.push(Leaf(6, _two(block.chainid, uint256(ch)), v, ""));
    }

    function _addProxy(bytes32 ch, address upgrader, bytes32 logic, address impl, bytes4 getter) internal {
        bytes32[] memory v = new bytes32[](4);
        (v[0], v[1], v[2], v[3]) = (bytes32(uint256(uint160(upgrader))), logic, bytes32(uint256(uint160(impl))), bytes32(getter));
        leaves.push(Leaf(5, _two(block.chainid, uint256(ch)), v, ""));
    }

    function _keyOf(Leaf memory l) internal pure returns (uint256) {
        if (l.kind == 0) return 0;
        if (l.kind == 255) return type(uint256).max;
        return uint256(keccak256(abi.encodePacked(l.kind, l.key)));
    }

    function _hashOf(Leaf memory l) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes1(0), l.kind, l.key, l.value));
    }

    Leaf[] internal sorted;

    function _build() internal {
        delete sorted;
        bytes32[] memory z = new bytes32[](1);
        sorted.push(Leaf(0, z, new bytes32[](0), ""));
        z[0] = bytes32(type(uint256).max);
        for (uint256 i = 0; i < leaves.length; i++) sorted.push(leaves[i]);
        sorted.push(Leaf(255, z, new bytes32[](0), ""));
        for (uint256 i = 1; i < sorted.length; i++) {
            Leaf memory x = sorted[i];
            uint256 j = i;
            while (j > 0 && _keyOf(sorted[j - 1]) > _keyOf(x)) {
                sorted[j] = sorted[j - 1];
                j--;
            }
            sorted[j] = x;
        }
        depth = 0;
        while ((1 << depth) < sorted.length) depth++;
        delete levels;
        bytes32[] memory first = new bytes32[](1 << depth);
        for (uint256 i = 0; i < sorted.length; i++) first[i] = _hashOf(sorted[i]);
        levels.push(first);
        for (uint256 d = 0; d < depth; d++) {
            bytes32[] memory next = new bytes32[](levels[d].length / 2);
            for (uint256 i = 0; i < next.length; i++) next[i] = keccak256(abi.encodePacked(bytes1(0x01), levels[d][2 * i], levels[d][2 * i + 1]));
            levels.push(next);
        }
        root = levels[depth][0];
    }

    function _item(uint256 sortedIndex) internal view returns (bytes memory b) {
        Leaf memory l = sorted[sortedIndex];
        b = abi.encodePacked(l.kind, uint16(sortedIndex), uint8(l.key.length), uint8(l.value.length), uint16(l.vdesc.length), l.key, l.value);
        uint256 i = sortedIndex;
        for (uint256 d = 0; d < depth; d++) {
            b = bytes.concat(b, levels[d][i ^ 1]);
            i >>= 1;
        }
        b = bytes.concat(b, l.vdesc);
    }

    function _indexOf(uint8 kind, bytes32 k0, bytes32 k1) internal view returns (uint256) {
        for (uint256 i = 0; i < sorted.length; i++) {
            if (sorted[i].kind == kind && sorted[i].key[0] == k0 && sorted[i].key[1] == k1) return i;
        }
        revert("no such leaf");
    }

    function _proofDesc(address target, bytes4 sel) internal view returns (bytes memory) {
        for (uint256 i = 0; i < sorted.length; i++) {
            if (sorted[i].kind == 1 && sorted[i].key[1] == target.codehash && sorted[i].key[2] == bytes32(sel)) return _item(i);
        }
        revert("no desc");
    }

    function _proofToken(address t) internal view returns (bytes memory) {
        return _item(_indexOf(2, bytes32(block.chainid), bytes32(uint256(uint160(t)))));
    }

    function _proofSpender(address a) internal view returns (bytes memory) {
        return _item(_indexOf(7, bytes32(block.chainid), bytes32(uint256(uint160(a)))));
    }

    function _withDepth(bytes memory items) internal view returns (bytes memory) {
        return bytes.concat(bytes1(uint8(depth)), items);
    }

    function _attestorPair() internal view returns (address a, address b) {
        (a, b) = (vm.addr(AT1), vm.addr(AT2));
        if (a > b) (a, b) = (b, a);
    }

    /// The honest proofs for a dUSDC transfer: the descriptor and the token.
    function _transferProofs() internal view returns (bytes memory) {
        return _withDepth(bytes.concat(_proofDesc(address(usdc), 0xa9059cbb), _proofToken(address(usdc))));
    }
}

/// B1-B11, I10-I13 on the stateless path.
contract StatelessTest is SnapshotFixture {
    // --------------------------------------------------------------------------------- the path ---

    function _in(VerbatimCore.Call[] memory calls, uint64 expiry) internal view returns (DisplayVM.In memory i) {
        i.chainId = uint64(block.chainid);
        i.account = address(account);
        i.expiry = expiry;
        i.snapshotRoot = root;
        i.policyVersion = account.policyVersion();
        i.path = 1;
        i.maxFee = 100 * (GAS_EXPIRY + GAS_F0 + GAS_F2);
        i.body = abi.encode(calls, bytes(""));
        i.hints = allHints(calls);
    }

    struct S {
        VerbatimCore.Call[] calls;
        uint64 expiry;
        bytes tree;
        bytes spec;
        uint256 risk;
    }

    function _plan(VerbatimCore.Call[] memory calls, uint64 expiry, bytes memory proofs) internal view returns (S memory s) {
        (s.tree, s.spec, s.risk) = renderer().renderView(root, proofs, _in(calls, expiry));
        s.calls = calls;
        s.expiry = expiry;
    }

    /// Loads [expiry, VERIFY self, SENDER self]. Owners sign the digest; attestors sign the snapshot; entries in that order.
    function _load(S memory s, bytes memory proofs, bytes32 treeHash, bytes32 specHash) internal {
        env.reset();
        env.setTx(address(account), nonceNow, 1, 100);
        env.setMaxCost(FEE);
        bytes memory f1 = abi.encodeCall(VerbatimAccountBase.verifyFrame, (treeHash, specHash, root, uint8(1), account.policyWord(), account.owners(), abi.encode(attestorList, issuedAt, snapExpiry, allHints(s.calls), proofs)));
        env.pushFrame(FrameEnv.Frame(1, 0, account.EXPIRY_VERIFIER(), GAS_EXPIRY, 0, 0, abi.encodePacked(s.expiry)));
        env.pushFrame(FrameEnv.Frame(1, 3, address(account), GAS_F0, 0, 0, f1));
        env.pushFrame(FrameEnv.Frame(2, 0, address(account), GAS_F2, 0, 0, abi.encodeCall(VerbatimAccountBase.executeVerified, (s.calls, s.spec))));
        (address a1, address a2) = _ownerPair();
        (address t1, address t2) = _attestorPair();
        env.pushSig(FrameEnv.Sig(1, a1, bytes32(0)));
        env.pushSig(FrameEnv.Sig(1, a2, bytes32(0)));
        env.pushSig(FrameEnv.Sig(1, t1, bytes32(0)));
        env.pushSig(FrameEnv.Sig(1, t2, bytes32(0)));
        bytes32 d = account.digestOf(treeHash, specHash, s.expiry, root, 1, txCommit());
        bytes32 ds = SnapshotHarness.digest(root, issuedAt, snapExpiry);
        env.setSig(0, FrameEnv.Sig(1, a1, d));
        env.setSig(1, FrameEnv.Sig(1, a2, d));
        env.setSig(2, FrameEnv.Sig(1, t1, ds));
        env.setSig(3, FrameEnv.Sig(1, t2, ds));
    }

    function _ownerPair() internal view returns (address a, address b) {
        (a, b) = (vm.addr(O1), vm.addr(O2));
        if (a > b) (a, b) = (b, a);
    }

    function _verify() internal returns (bool ok, bytes memory ret) {
        env.setCurrent(1);
        bytes memory data = env.frame(1).data;
        vm.prank(address(0xaa));
        (ok, ret) = address(account).call(data);
    }

    function _expectVerify(bytes memory err) internal {
        env.setCurrent(1);
        bytes memory data = env.frame(1).data;
        vm.prank(address(0xaa));
        vm.expectRevert(err);
        (bool ok, ) = address(account).call(data);
        ok;
    }

    function _execute() internal returns (bool batchOk, bytes memory err) {
        env.setCurrent(2);
        FrameEnv.Frame memory f = env.frame(2);
        vm.recordLogs();
        vm.prank(address(account));
        (bool ok, bytes memory ret) = address(account).call(f.data);
        _bubble(ok, ret);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("VerbatimResult(bool,bytes)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == sig) return (uint256(logs[i].topics[1]) == 1, abi.decode(logs[i].data, (bytes)));
        }
        revert("no VerbatimResult");
    }

    function _run(S memory s, bytes memory proofs) internal returns (bool, bytes memory) {
        _load(s, proofs, keccak256(s.tree), keccak256(s.spec));
        (bool ok, bytes memory ret) = _verify();
        _bubble(ok, ret);
        assertEq(env.lastApproved(), 3, "self-verify approves both scopes");
        (bool b, bytes memory e) = _execute();
        nonceNow++;
        return (b, e);
    }

    function _transfer(uint256 n) internal view returns (VerbatimCore.Call[] memory) {
        return transferCall(BOB, n);
    }

    // -------------------------------------------------------------------------------- the tests ---

    function test_honest_transfer_lands_with_no_paymaster_and_no_stake() public {
        bytes memory p = _transferProofs();
        uint256 feesBefore = admin_().feesAccrued(address(0));
        (bool ok, ) = _run(_plan(_transfer(5e6), T0 + 100, p), p);
        assertTrue(ok);
        assertEq(usdc.balanceOf(BOB), 5e6);
        assertEq(admin_().feesAccrued(address(0)), feesBefore, "self-paid: the paymaster took nothing");
    }

    function test_validation_touches_only_the_senders_storage() public {
        bytes memory p = _transferProofs();
        _load(_plan(_transfer(1), T0 + 100, p), p, keccak256(_plan(_transfer(1), T0 + 100, p).tree), keccak256(_plan(_transfer(1), T0 + 100, p).spec));
        env.setCurrent(1);
        bytes memory data = env.frame(1).data;
        vm.record();
        vm.prank(address(0xaa));
        (bool ok, ) = address(account).call(data);
        assertTrue(ok);
        for (uint256 i = 0; i < 3; i++) {
            address a = [address(rpm), address(usdc), address(renderer())][i];
            (bytes32[] memory r, bytes32[] memory w) = vm.accesses(a);
            assertEq(r.length + w.length, 0, "no storage but the sender's");
        }
    }

    function test_paymaster_path_tree_and_stateless_tree_differ_by_path() public {
        bytes memory p = _transferProofs();
        (bytes memory t, , ) = renderer().renderView(root, p, _in(_transfer(1), T0 + 100));
        assertEq(uint8(t[4 + 8 + 20 + 8 + 32 + 4]), 1);
    }

    /// B1: an NFT drainer through a collection nobody attested. With no descriptor proof it renders blind, and policy refuses.
    function test_B1_unattested_collection_refused() public {
        address collection = address(new GasBurner());
        bytes memory drain = abi.encodeWithSelector(0xa22cb465, THIEF, true);
        VerbatimCore.Call[] memory c = one(collection, drain);
        S memory s = _plan(c, T0 + 100, _withDepth(""));
        assertTrue(s.risk != 0);
        _load(s, _withDepth(""), keccak256(s.tree), keccak256(s.spec));
        _expectVerify(abi.encodeWithSelector(VerbatimAccountBase.PolicyRefused.selector, s.risk));
    }

    /// B2: `to` is the attacker in the calldata, the owners signed themselves.
    function test_B2_withdraw_to_attacker_is_a_tree_mismatch() public {
        bytes memory p = _transferProofs();
        S memory honest = _plan(_transfer(5e6), T0 + 100, p);
        S memory lie = honest;
        lie.calls = transferCall(THIEF, 5e6);
        S memory actual = _plan(lie.calls, T0 + 100, p);
        _load(lie, p, keccak256(honest.tree), keccak256(honest.spec));
        _expectVerify(abi.encodeWithSelector(VerbatimAccountBase.TreeMismatch.selector, keccak256(honest.tree), keccak256(actual.tree)));
    }

    /// B3: attestors signed for another chain. Same root, wrong domain.
    function test_B3_cross_chain_snapshot_refused() public {
        bytes memory p = _transferProofs();
        S memory s = _plan(_transfer(1), T0 + 100, p);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        uint256 here = block.chainid;
        vm.chainId(here + 1);
        bytes32 foreign = SnapshotHarness.digest(root, issuedAt, snapExpiry);
        vm.chainId(here);
        (address t1, address t2) = _attestorPair();
        env.setSig(2, FrameEnv.Sig(1, t1, foreign));
        env.setSig(3, FrameEnv.Sig(1, t2, foreign));
        _expectVerify(abi.encodeWithSelector(VerbatimAccountBase.BadSignatureEntry.selector));
    }

    /// B3b: a leaf for another chain cannot be used here: chain id is in the key, so it is simply not found.
    function test_B3b_leaf_for_another_chain_is_not_found() public {
        bytes memory p = _transferProofs();
        uint256 here = block.chainid;
        vm.chainId(here + 1);
        S memory s = _plan(_transfer(1), T0 + 100, p);
        vm.chainId(here);
        assertTrue(s.risk != 0, "no descriptor or token on that chain");
    }

    /// B4 and B10: a valid, signed snapshot; the leaf revoked after signing. Validation still passes, execution refuses.
    function test_B4_B10_I11_revoked_leaf_never_executes() public {
        bytes memory p = _transferProofs();
        S memory s = _plan(_transfer(5e6), T0 + 100, p);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        (bool ok, ) = _verify();
        assertTrue(ok, "validation does not read the registry");
        uint256 idx;
        for (uint256 i = 0; i < sorted.length; i++) if (sorted[i].kind == 1 && sorted[i].key[2] == bytes32(bytes4(0xa9059cbb))) idx = i;
        bytes32 h = _hashOf(sorted[idx]);
        _revoke(h);
        (bool b, bytes memory err) = _execute();
        assertFalse(b);
        assertEq(errorName(err), VerbatimAccountBase.LeafRevoked.selector);
        assertEq(usdc.balanceOf(BOB), 0);
    }

    function _revoke(bytes32 h) internal {
        bytes32[] memory list = new bytes32[](1);
        list[0] = h;
        bytes32 d = registry().digest(list);
        (uint256 k1, uint256 k2) = vm.addr(AT1) < vm.addr(AT2) ? (AT1, AT2) : (AT2, AT1);
        bytes[] memory sigs = new bytes[](2);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(k1, d);
        sigs[0] = abi.encodePacked(r, ss, v);
        (v, r, ss) = vm.sign(k2, d);
        sigs[1] = abi.encodePacked(r, ss, v);
        registry().revoke(list, sigs);
    }

    function test_registry_needs_a_quorum() public {
        bytes32[] memory list = new bytes32[](1);
        list[0] = keccak256("x");
        bytes[] memory sigs = new bytes[](1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AT1, registry().digest(list));
        sigs[0] = abi.encodePacked(r, s, v);
        vm.expectRevert(RevocationRegistry.NotEnoughAttestors.selector);
        registry().revoke(list, sigs);
    }

    /// B5: a TOKEN leaf's words presented as a DESC. Type is hashed in, so the path does not reach the root.
    function test_B5_leaf_type_confusion_fails_the_proof() public {
        bytes memory tokenItem = _proofToken(address(usdc));
        tokenItem[0] = 0x01;
        bytes memory forged = _withDepth(tokenItem);
        // Asked for that token as a descriptor: the key words do not match any lookup, so it is ignored, and the honest token
        // lookup finds no TOKEN item. Refused, not believed.
        S memory s = _plan(_transfer(1), T0 + 100, forged);
        assertTrue(s.risk != 0);
    }

    function test_B5b_tampered_value_fails_the_proof() public {
        bytes memory item = _proofToken(address(usdc));
        // The decimals word: 7 head bytes, two key words, then symbol, then decimals.
        item[7 + 64 + 32 + 31] = 0x12;
        bytes memory forged = _withDepth(bytes.concat(_proofDesc(address(usdc), 0xa9059cbb), item));
        DisplayVM.In memory i = _in(_transfer(1), T0 + 100);
        StatelessRenderer r = renderer();
        vm.expectRevert(SnapshotVerifier.BadProof.selector);
        r.renderView(root, forged, i);
    }

    /// B6: padding the signature list.
    function test_B6_signature_padding_refused() public {
        bytes memory p = _transferProofs();
        S memory s = _plan(_transfer(1), T0 + 100, p);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        (address t1, ) = _attestorPair();
        env.pushSig(FrameEnv.Sig(1, t1, bytes32(uint256(1))));
        _expectVerify(abi.encodeWithSelector(VerbatimAccountBase.BadSignatureEntry.selector));
    }

    /// B7: leaving a token's proof out.
    function test_B7_omitted_token_leaf_refused() public {
        bytes memory noToken = _withDepth(_proofDesc(address(usdc), 0xa9059cbb));
        S memory s = _plan(_transfer(1), T0 + 100, noToken);
        _load(s, noToken, keccak256(s.tree), keccak256(s.spec));
        _expectVerify(abi.encodeWithSelector(VerbatimAccountBase.PolicyRefused.selector, s.risk));
    }

    /// B7b: any risk flag refuses the token, whatever else is true.
    function test_B7b_any_risk_flag_refuses_the_token() public {
        TestToken bad = new TestToken("Bad", "BAD", 6);
        bad.mint(address(account), 10);
        _addToken(address(bad), "BAD", 6, 1 << 5);
        _build();
        bytes memory p = _withDepth(bytes.concat(_proofDesc(address(usdc), 0xa9059cbb), _proofToken(address(bad))));
        S memory s = _plan(one(address(bad), abi.encodeWithSelector(0xa9059cbb, BOB, uint256(1))), T0 + 100, p);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        _expectVerify(abi.encodeWithSelector(VerbatimAccountBase.PolicyRefused.selector, s.risk));
    }

    /// B8: a proxy's implementation swapped after signing. IMPL_EQ is read live.
    function test_B8_proxy_implementation_swap_reverts() public {
        ProxyLike proxy = new ProxyLike(address(0x1111));
        LogicLike logic = new LogicLike();
        proxy.setImpl(address(logic));
        bytes4 sel = LogicLike.ping.selector;
        delete leaves;
        _addDesc(address(logic).codehash, sel, bytes.concat(hex"56440001", hex"04", "Ping", hex"00", hex"00", hex"00", hex"0000"));
        _addProxy(address(proxy).codehash, address(this), address(logic).codehash, address(logic), bytes4(keccak256("implementation()")));
        _build();
        bytes memory p = _withDepth(bytes.concat(_item(_indexOf(5, bytes32(block.chainid), address(proxy).codehash)), _proofDesc(address(logic), sel)));
        VerbatimCore.Call[] memory c = one(address(proxy), abi.encodeWithSelector(sel));
        S memory s = _plan(c, T0 + 100, p);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        (bool ok, ) = _verify();
        assertTrue(ok);
        proxy.setImpl(address(0xBEEF));
        (bool b, bytes memory err) = _execute();
        assertFalse(b);
        assertEq(errorName(err), VerbatimCore.ImplChanged.selector);
    }

    /// B9: a snapshot that claims to live far longer than the policy allows.
    function test_B9_far_future_snapshot_expiry_refused() public {
        snapExpiry = uint64(block.timestamp + 7 hours);
        bytes memory p = _transferProofs();
        S memory s = _plan(_transfer(1), T0 + 100, p);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        _expectVerify(abi.encodeWithSelector(VerbatimAccountBase.SnapshotTtlTooLong.selector, uint256(7 hours), uint256(6 hours)));
    }

    /// I10: a transaction that outlives its snapshot.
    function test_I10_expiry_past_snapshot_refused() public {
        snapExpiry = uint64(block.timestamp + 50);
        bytes memory p = _transferProofs();
        S memory s = _plan(_transfer(1), T0 + 100, p);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        _expectVerify(abi.encodeWithSelector(VerbatimAccountBase.SnapshotExpiresTooSoon.selector, uint64(T0 + 100), snapExpiry));
    }

    function test_stranger_attestor_refused() public {
        bytes memory p = _transferProofs();
        S memory s = _plan(_transfer(1), T0 + 100, p);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        bytes32 ds = SnapshotHarness.digest(root, issuedAt, snapExpiry);
        (address t1, ) = _attestorPair();
        env.setSig(3, FrameEnv.Sig(1, address(type(uint160).max), ds));
        env.setSig(2, FrameEnv.Sig(1, t1, ds));
        _expectVerify(abi.encodeWithSelector(VerbatimCore.SignersNotSortedOrUnknown.selector));
    }

    function test_wrong_attestor_list_refused() public {
        bytes memory p = _transferProofs();
        S memory s = _plan(_transfer(1), T0 + 100, p);
        attestorList[2] = address(0xFEED);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        _expectVerify(abi.encodeWithSelector(VerbatimAccountBase.BadLayout.selector, uint256(10)));
    }

    function test_a_root_nobody_attested_is_refused() public {
        bytes memory p = _transferProofs();
        S memory s = _plan(_transfer(1), T0 + 100, p);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        (address t1, address t2) = _attestorPair();
        env.setSig(2, FrameEnv.Sig(1, t1, bytes32(uint256(1))));
        env.setSig(3, FrameEnv.Sig(1, t2, bytes32(uint256(1))));
        _expectVerify(abi.encodeWithSelector(VerbatimAccountBase.BadSignatureEntry.selector));
    }

    // ---- B11: the attack kit again, on this path ---

    function test_B11_A3_paymaster_layout_refused_here() public {
        bytes memory p = _transferProofs();
        S memory s = _plan(_transfer(1), T0 + 100, p);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        env.setFrameFlags(1, 2);
        _expectVerify(abi.encodeWithSelector(VerbatimAccountBase.BadLayout.selector, uint256(3)));
    }

    function test_B11_A4_weaker_spec_refused() public {
        bytes memory p = _transferProofs();
        S memory s = _plan(_transfer(1), T0 + 100, p);
        s.spec = hex"565300020000";
        // The owners even signed the weak hash; the render disagrees.
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        (bool ok, bytes memory ret) = _verify();
        assertFalse(ok);
        assertEq(errorName(ret), StatelessRenderer.SpecArgMismatch.selector);
    }

    function test_B11_A7b_starved_expiry_frame_refused() public {
        bytes memory p = _transferProofs();
        S memory s = _plan(_transfer(1), T0 + 100, p);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        env.setFrameGas(0, 2_000);
        _expectVerify(abi.encodeWithSelector(VerbatimAccountBase.BadLayout.selector, uint256(8)));
    }

    function test_B11_A7_stale_at_execution_reverts() public {
        bytes memory p = _transferProofs();
        S memory s = _plan(_transfer(1e6), T0 + 100, p);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        (bool ok, ) = _verify();
        assertTrue(ok);
        vm.warp(T0 + 101);
        (bool b, bytes memory err) = _execute();
        assertFalse(b);
        assertEq(errorName(err), VerbatimCore.Expired.selector);
    }

    function test_B11_A11_reentrancy_reverts() public {
        Reenterer r = new Reenterer();
        bytes memory desc = bytes.concat(hex"56440001", hex"06", "Attack", hex"ff", hex"00", hex"00", hex"0000");
        _addDesc(address(r).codehash, Reenterer.attack.selector, desc);
        _build();
        bytes memory inner = abi.encodeCall(VerbatimAccountBase.executeVerified, (transferCall(THIEF, 1e6), ""));
        bytes memory p = _withDepth(_proofDesc(address(r), Reenterer.attack.selector));
        (bool ok, bytes memory err) = _run(_plan(one(address(r), abi.encodeCall(Reenterer.attack, (address(account), inner))), T0 + 100, p), p);
        assertFalse(ok);
        assertEq(errorName(err), VerbatimCore.CallFailed.selector);
        assertEq(usdc.balanceOf(THIEF), 0);
    }

    function test_B11_A18_return_bomb_contained() public {
        ReturnBomb b = new ReturnBomb();
        _addDesc(address(b).codehash, ReturnBomb.detonate.selector, bytes.concat(hex"56440001", hex"08", "Detonate", hex"01", hex"00", hex"00", hex"0000"));
        _build();
        bytes memory p = _withDepth(_proofDesc(address(b), ReturnBomb.detonate.selector));
        S memory s = _plan(one(address(b), abi.encodeCall(ReturnBomb.detonate, (500_000))), T0 + 100, p);
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        (bool ok, ) = _verify();
        assertTrue(ok);
        env.setCurrent(2);
        bytes memory f = env.frame(2).data;
        vm.prank(address(account));
        (bool survived, ) = address(account).call{gas: 1_200_000}(f);
        assertTrue(survived, "the frame outlives the bomb");
    }

    function test_B12_I13_stateless_replay_refused() public {
        bytes memory p = _transferProofs();
        S memory s = _plan(_transfer(1e6), T0 + 100, p);
        (bool ok, ) = _run(s, p);
        assertTrue(ok);
        nonceNow--;
        _load(s, p, keccak256(s.tree), keccak256(s.spec));
        bytes32 d = account.digestOf(keccak256(s.tree), keccak256(s.spec), s.expiry, root, 1, txCommit());
        _expectVerify(abi.encodeWithSelector(VerbatimCore.Replayed.selector, d));
    }

    function test_B14_I12_standing_approval_reverts() public {
        bytes memory p = _withDepth(bytes.concat(_proofDesc(address(usdc), 0x095ea7b3), _proofToken(address(usdc)), _proofSpender(address(vault))));
        (bool ok, bytes memory err) = _run(_plan(one(address(usdc), abi.encodeWithSelector(0x095ea7b3, address(vault), uint256(5))), T0 + 100, p), p);
        assertFalse(ok);
        assertEq(errorName(err), AssertionKit.AssertionFailed.selector);
    }

    function test_nonmembership_proof() public {
        AbsentProbe probe = new AbsentProbe();
        uint256 k = uint256(keccak256(abi.encodePacked(uint8(7), bytes32(block.chainid), bytes32(uint256(uint160(address(0xABCD)))))));
        uint256 lo;
        for (uint256 i = 0; i + 1 < sorted.length; i++) if (_keyOf(sorted[i]) < k && k < _keyOf(sorted[i + 1])) lo = i;
        bytes memory good = bytes.concat(bytes1(uint8(depth)), _item(lo), _item(lo + 1));
        probe.check(good, root, k);
        // A present key cannot be proven absent.
        uint256 present = _keyOf(sorted[lo + 1]);
        vm.expectRevert(SnapshotVerifier.NotAdjacent.selector);
        probe.check(good, root, present);
        if (lo + 2 < sorted.length) {
            bytes memory gap = bytes.concat(bytes1(uint8(depth)), _item(lo), _item(lo + 2));
            vm.expectRevert(SnapshotVerifier.NotAdjacent.selector);
            probe.check(gap, root, k);
        }
    }

    /// Two ways to the same answer: this file's tree and the CLI's, on one fixed input (test/vectors/snapshot.json).
    function test_vector_matches_the_cli() public view {
        string memory json = vm.readFile("../test/vectors/snapshot.json");
        bytes32 want = vm.parseJsonBytes32(json, ".root");
        bytes32 leaf = vm.parseJsonBytes32(json, ".leafHash");
        bytes32 t = keccak256(abi.encodePacked(bytes1(0), uint8(7), bytes32(uint256(1337)), bytes32(uint256(uint160(0x00000000000000000000000000000000000000A1))), bytes32(uint256(1))));
        assertEq(t, leaf);
        bytes32 low = keccak256(abi.encodePacked(bytes1(0), uint8(0), bytes32(0)));
        bytes32 high = keccak256(abi.encodePacked(bytes1(0), uint8(255), bytes32(type(uint256).max)));
        // Three leaves, padded to four, sorted low, leaf, high.
        bytes32 n0 = keccak256(abi.encodePacked(bytes1(0x01), low, leaf));
        bytes32 n1 = keccak256(abi.encodePacked(bytes1(0x01), high, bytes32(0)));
        assertEq(keccak256(abi.encodePacked(bytes1(0x01), n0, n1)), want);
        assertEq(uint256(vm.parseJsonUint(json, ".depth")), 2);
    }
}

library SnapshotHarness {
    function digest(bytes32 root, uint64 issuedAt, uint64 expiry) internal view returns (bytes32) {
        return SnapshotVerifier.digest(root, issuedAt, expiry, 1);
    }
}

contract LogicLike {
    function ping() external {}
}

contract ProxyLike {
    address public implementation;

    constructor(address impl) {
        implementation = impl;
    }

    function setImpl(address impl) external {
        implementation = impl;
    }

    fallback() external {
        (bool ok, ) = implementation.delegatecall(msg.data);
        require(ok);
    }
}

import {Vm} from "forge-std/Vm.sol";
