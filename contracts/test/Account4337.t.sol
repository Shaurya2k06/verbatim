// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SnapshotFixture, SnapshotHarness} from "./Stateless.t.sol";
import {VerbatimCore} from "../src/account/VerbatimAccount.sol";
import {VerbatimAccount4337} from "../src/leg-b/VerbatimAccount4337.sol";
import {PackedUserOperation} from "../src/leg-b/PackedUserOperation.sol";
import {EnsTrustAnchor} from "../src/trust/EnsTrustAnchor.sol";
import {DisplayVM} from "../src/lib/DisplayVM.sol";
import {AssertionKit} from "../src/lib/AssertionKit.sol";

contract AnchorRegistry {
    address public sub;
    address public res;

    function set(address s, address r) external {
        (sub, res) = (s, r);
    }

    function getSubregistry(string calldata) external view returns (address) {
        return sub;
    }

    function getResolver(string calldata) external view returns (address) {
        return res;
    }

    function roleCount(uint256) external pure returns (uint256) {
        return 0;
    }
}

contract AnchorResolver {
    mapping(bytes32 => string) public records;
    mapping(uint256 => uint256) public counts;
    mapping(uint256 => mapping(address => bool)) public holders;

    function setRecord(string calldata key, string calldata v) external {
        records[keccak256(bytes(key))] = v;
    }

    function setCount(uint256 r, uint256 c) external {
        counts[r] = c;
    }

    function setHolder(uint256 r, address a) external {
        holders[r][a] = true;
    }

    function resolve(bytes calldata, bytes calldata data) external view returns (bytes memory) {
        (, string memory key) = abi.decode(data[4:], (bytes32, string));
        return abi.encode(records[keccak256(bytes(key))]);
    }

    function roleCount(uint256 r) external view returns (uint256) {
        return counts[r];
    }

    function hasRoles(uint256 r, uint256, address a) external view returns (bool) {
        return holders[r][a];
    }
}

/// §11: the production leg, with this test standing in for EntryPoint v0.7. B13 and the anchor are here too.
contract Account4337Test is SnapshotFixture {
    VerbatimAccount4337 internal acct;
    AnchorResolver internal resolver;
    AnchorRegistry internal reg2;
    EnsTrustAnchor internal anchor;
    address internal constant GOV = address(0x6060);
    uint64 internal constant EXP = T0 + 100;

    function setUp() public override {
        super.setUp();
        resolver = new AnchorResolver();
        reg2 = new AnchorRegistry();
        reg2.set(address(reg2), address(resolver));
        anchor = new EnsTrustAnchor(address(reg2), address(reg2), address(resolver).codehash, GOV, "verbatim-demo");
        for (uint256 i = 0; i < 2; i++) {
            uint256 res = uint256(keccak256(bytes(i == 0 ? "attestors" : "revoked")));
            resolver.setCount(res, 1 << 4);
            resolver.setHolder(res, GOV);
        }
        resolver.setRecord("attestors", _attestorRecord());
        acct = _deploy(address(anchor));
        usdc.mint(address(acct), 100e6);
        vm.deal(address(acct), 1 ether);
    }

    function _deploy(address a) private returns (VerbatimAccount4337) {
        address[] memory owners = new address[](3);
        (owners[0], owners[1], owners[2]) = (vm.addr(O1), vm.addr(O2), vm.addr(O3));
        return new VerbatimAccount4337(address(this), address(renderer()), address(registry()), a, address(p2), owners, 2, attestorList, 2);
    }

    receive() external payable {}

    function _lower(address a) private pure returns (string memory) {
        bytes memory out = new bytes(42);
        bytes16 t = "0123456789abcdef";
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(uint160(a) >> (8 * (19 - i)));
            out[2 + 2 * i] = t[b >> 4];
            out[3 + 2 * i] = t[b & 0xf];
        }
        return string(out);
    }

    function _attestorRecord() private view returns (string memory) {
        return string.concat(_lower(vm.addr(AT1)), ",", _lower(vm.addr(AT2)), ",", _lower(vm.addr(AT3)));
    }

    uint256 internal constant VG = 900_000;
    uint256 internal constant CG = 1_500_000;
    uint256 internal constant PVG = 100_000;
    uint256 internal constant MF = 1000;

    function _hints(VerbatimCore.Call[] memory calls) private view returns (address[] memory h) {
        h = new address[](calls.length + 2);
        for (uint256 i = 0; i < calls.length; i++) h[i] = calls[i].target;
        h[calls.length] = address(p2);
        h[calls.length + 1] = address(vault);
    }

    function _render(VerbatimCore.Call[] memory calls, bytes memory proofs, uint64 expiry) private view returns (bytes memory tree, bytes memory spec, uint256 risk) {
        DisplayVM.In memory i;
        i.chainId = uint64(block.chainid);
        i.account = address(acct);
        i.expiry = expiry;
        i.snapshotRoot = root;
        i.policyVersion = acct.policyVersion();
        i.path = 3;
        i.maxFee = (VG + CG + PVG) * MF;
        i.body = abi.encode(calls, bytes(""));
        i.hints = _hints(calls);
        return renderer().renderView(root, proofs, i);
    }

    function _sigs2(uint256 a, uint256 b, bytes32 d) private pure returns (bytes memory) {
        if (vm.addr(a) > vm.addr(b)) (a, b) = (b, a);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(a, d);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(b, d);
        return abi.encodePacked(r1, s1, v1, r2, s2, v2);
    }

    function _op(VerbatimCore.Call[] memory calls, bytes memory spec) private view returns (PackedUserOperation memory op) {
        op.sender = address(acct);
        op.nonce = 7;
        op.callData = bytes.concat(acct.executeUserOp.selector, abi.encode(calls, spec));
        op.accountGasLimits = bytes32((VG << 128) | CG);
        op.preVerificationGas = PVG;
        op.gasFees = bytes32((uint256(1) << 128) | MF);
    }

    function _sign(PackedUserOperation memory op, bytes32 h, bytes32 treeHash, bytes32 specHash, uint64 expiry, bytes memory proofs, VerbatimCore.Call[] memory calls) private view {
        bytes32 d = acct.digestOf(treeHash, specHash, expiry, root, 3, h);
        bytes32 ds = SnapshotHarness.digest(root, issuedAt, snapExpiry);
        op.signature = abi.encode(VerbatimAccount4337.Sig(treeHash, specHash, expiry, root, issuedAt, snapExpiry, _sigs2(O1, O2, d), _sigs2(AT1, AT2, ds), attestorList, _hints(calls), proofs));
    }

    function _honest(uint256 n) private view returns (PackedUserOperation memory op, bytes32 h, VerbatimCore.Call[] memory calls, bytes memory proofs, bytes memory tree, bytes memory spec) {
        proofs = _transferProofs();
        calls = transferCall(BOB, n);
        (tree, spec, ) = _render(calls, proofs, EXP);
        op = _op(calls, spec);
        h = keccak256(abi.encode("user op", op.callData));
        _sign(op, h, keccak256(tree), keccak256(spec), EXP, proofs, calls);
    }

    function test_honest_transfer_validates_and_executes() public {
        (PackedUserOperation memory op, bytes32 h, , , , ) = _honest(5e6);
        uint256 v = acct.validateUserOp(op, h, 0);
        assertEq(v >> 160, EXP, "validUntil is the expiry");
        assertEq(uint160(v), 0, "no aggregator, no signature failure");
        acct.executeUserOp(op, h);
        assertEq(usdc.balanceOf(BOB), 5e6);
    }

    function test_pays_its_own_prefund() public {
        (PackedUserOperation memory op, bytes32 h, , , , ) = _honest(1);
        uint256 before = address(this).balance;
        acct.validateUserOp(op, h, 123);
        assertEq(address(this).balance - before, 123);
    }

    function test_only_entry_point() public {
        (PackedUserOperation memory op, bytes32 h, , , , ) = _honest(1);
        vm.prank(address(0xBAD));
        vm.expectRevert(VerbatimAccount4337.NotEntryPoint.selector);
        acct.validateUserOp(op, h, 0);
        vm.prank(address(0xBAD));
        vm.expectRevert(VerbatimAccount4337.NotEntryPoint.selector);
        acct.executeUserOp(op, h);
    }

    function test_someone_else_paying_is_refused() public {
        (PackedUserOperation memory op, bytes32 h, , , , ) = _honest(1);
        op.paymasterAndData = hex"1234";
        vm.expectRevert(VerbatimAccount4337.BadCallData.selector);
        acct.validateUserOp(op, h, 0);
    }

    function test_lying_recipient_is_a_tree_mismatch() public {
        (PackedUserOperation memory op, bytes32 h, , bytes memory proofs, bytes memory tree, bytes memory spec) = _honest(1);
        VerbatimCore.Call[] memory lie = transferCall(THIEF, 1);
        (bytes memory actual, , ) = _render(lie, proofs, EXP);
        op.callData = bytes.concat(acct.executeUserOp.selector, abi.encode(lie, spec));
        _sign(op, h, keccak256(tree), keccak256(spec), EXP, proofs, lie);
        vm.expectRevert(abi.encodeWithSelector(VerbatimAccount4337.TreeMismatch.selector, keccak256(tree), keccak256(actual)));
        acct.validateUserOp(op, h, 0);
    }

    function test_a_stranger_cannot_sign() public {
        (PackedUserOperation memory op, bytes32 h, VerbatimCore.Call[] memory calls, bytes memory proofs, bytes memory tree, bytes memory spec) = _honest(1);
        bytes32 d = acct.digestOf(keccak256(tree), keccak256(spec), EXP, root, 3, h);
        bytes32 ds = SnapshotHarness.digest(root, issuedAt, snapExpiry);
        op.signature = abi.encode(VerbatimAccount4337.Sig(keccak256(tree), keccak256(spec), EXP, root, issuedAt, snapExpiry, _sigs2(O1, 0xDEAD, d), _sigs2(AT1, AT2, ds), attestorList, _hints(calls), proofs));
        vm.expectRevert(VerbatimCore.SignersNotSortedOrUnknown.selector);
        acct.validateUserOp(op, h, 0);
    }

    function test_a_stranger_cannot_attest() public {
        (PackedUserOperation memory op, bytes32 h, VerbatimCore.Call[] memory calls, bytes memory proofs, bytes memory tree, bytes memory spec) = _honest(1);
        bytes32 d = acct.digestOf(keccak256(tree), keccak256(spec), EXP, root, 3, h);
        bytes32 ds = SnapshotHarness.digest(root, issuedAt, snapExpiry);
        op.signature = abi.encode(VerbatimAccount4337.Sig(keccak256(tree), keccak256(spec), EXP, root, issuedAt, snapExpiry, _sigs2(O1, O2, d), _sigs2(AT1, 0xDEAD, ds), attestorList, _hints(calls), proofs));
        vm.expectRevert(VerbatimCore.SignersNotSortedOrUnknown.selector);
        acct.validateUserOp(op, h, 0);
    }

    function test_I13_digest_runs_once() public {
        (PackedUserOperation memory op, bytes32 h, , , , ) = _honest(1);
        acct.validateUserOp(op, h, 0);
        acct.executeUserOp(op, h);
        vm.expectRevert();
        acct.validateUserOp(op, h, 0);
    }

    function test_assertion_failure_still_reverts_the_batch() public {
        // A standing approval: B14 on this leg.
        bytes memory proofs = _withDepth(bytes.concat(_proofDesc(address(usdc), 0x095ea7b3), _proofToken(address(usdc)), _proofSpender(address(vault))));
        VerbatimCore.Call[] memory c = one(address(usdc), abi.encodeWithSelector(0x095ea7b3, address(vault), uint256(5)));
        (bytes memory tree, bytes memory spec, ) = _render(c, proofs, EXP);
        PackedUserOperation memory op = _op(c, spec);
        bytes32 h = keccak256("op");
        _sign(op, h, keccak256(tree), keccak256(spec), EXP, proofs, c);
        acct.validateUserOp(op, h, 0);
        acct.executeUserOp(op, h);
        assertEq(usdc.allowance(address(acct), address(vault)), 0);
    }

    /// B13: an attestor whose signature was used is no longer listed in ENS.
    function test_B13_attestor_not_in_ens_reverts_at_execution() public {
        (PackedUserOperation memory op, bytes32 h, , , , ) = _honest(1);
        acct.validateUserOp(op, h, 0);
        resolver.setRecord("attestors", _lower(address(0x9999)));
        (address a, ) = _attestorPair();
        vm.expectRevert(abi.encodeWithSelector(EnsTrustAnchor.AttestorNotListed.selector, a));
        acct.executeUserOp(op, h);
        assertEq(usdc.balanceOf(BOB), 0);
    }

    function test_ens_revocation_record_stops_a_leaf() public {
        (PackedUserOperation memory op, bytes32 h, , , , ) = _honest(1);
        acct.validateUserOp(op, h, 0);
        uint256 idx;
        for (uint256 i = 0; i < sorted.length; i++) if (sorted[i].kind == 1 && sorted[i].key[2] == bytes32(bytes4(0xa9059cbb))) idx = i;
        bytes32 leaf = keccak256(abi.encodePacked(bytes1(0), sorted[idx].kind, sorted[idx].key, sorted[idx].value));
        resolver.setRecord("revoked", vm.toString(leaf));
        vm.expectRevert(abi.encodeWithSelector(EnsTrustAnchor.LeafRevokedInEns.selector, leaf));
        acct.executeUserOp(op, h);
    }

    function test_registry_revocation_stops_a_leaf() public {
        (PackedUserOperation memory op, bytes32 h, , , , ) = _honest(1);
        acct.validateUserOp(op, h, 0);
        uint256 idx;
        for (uint256 i = 0; i < sorted.length; i++) if (sorted[i].kind == 1 && sorted[i].key[2] == bytes32(bytes4(0xa9059cbb))) idx = i;
        bytes32 leaf = keccak256(abi.encodePacked(bytes1(0), sorted[idx].kind, sorted[idx].key, sorted[idx].value));
        bytes32[] memory list = new bytes32[](1);
        list[0] = leaf;
        registry().revoke(list, _quorumSigs(registry().digest(list)));
        vm.expectRevert(abi.encodeWithSelector(VerbatimAccount4337.LeafRevoked.selector, leaf));
        acct.executeUserOp(op, h);
    }

    function _quorumSigs(bytes32 d) private pure returns (bytes[] memory s) {
        (uint256 k1, uint256 k2) = vm.addr(AT1) < vm.addr(AT2) ? (AT1, AT2) : (AT2, AT1);
        s = new bytes[](2);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(k1, d);
        s[0] = abi.encodePacked(r, ss, v);
        (v, r, ss) = vm.sign(k2, d);
        s[1] = abi.encodePacked(r, ss, v);
    }

    function test_anchor_refuses_a_record_more_than_governance_can_write() public {
        (PackedUserOperation memory op, bytes32 h, , , , ) = _honest(1);
        acct.validateUserOp(op, h, 0);
        uint256 res = uint256(keccak256(bytes("attestors")));
        resolver.setCount(res, (1 << 4) * 2);
        vm.expectRevert();
        acct.executeUserOp(op, h);
    }

    function test_no_anchor_on_chains_without_ens() public {
        acct = _deploy(address(0));
        usdc.mint(address(acct), 1e6);
        (PackedUserOperation memory op, bytes32 h, , , , ) = _honest(1);
        acct.validateUserOp(op, h, 0);
        acct.executeUserOp(op, h);
        assertEq(usdc.balanceOf(BOB), 1);
    }

    function test_validation_reads_only_this_accounts_storage() public {
        (PackedUserOperation memory op, bytes32 h, , , , ) = _honest(1);
        vm.record();
        acct.validateUserOp(op, h, 0);
        address[3] memory others = [address(usdc), address(renderer()), address(registry())];
        for (uint256 i = 0; i < 3; i++) {
            (bytes32[] memory r, bytes32[] memory w) = vm.accesses(others[i]);
            assertEq(r.length + w.length, 0);
        }
    }
}
