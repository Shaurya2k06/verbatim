// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {VerbatimCore} from "../src/account/VerbatimAccount.sol";
import {AssertionKit} from "../src/lib/AssertionKit.sol";
import {TrustStoreLayout} from "../src/trust/TrustStore.sol";

/// Grants more than it was asked to.
contract OverApprover {
    uint256 public extra;
    mapping(address => mapping(address => uint256)) public allowance;

    function setExtra(uint256 e) external {
        extra = e;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount + extra;
        return true;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

/// `lie` makes each call report success and do something else.
contract LyingNft {
    bool public lie;
    mapping(uint256 => address) public ownerOf;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    function setLie(bool l) external {
        lie = l;
    }

    function mint(address to, uint256 id) external {
        ownerOf[id] = to;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = lie ? !approved : approved;
    }

    function transferFrom(address, address to, uint256 id) external {
        ownerOf[id] = lie ? msg.sender : to;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

/// A token whose `transfer` also raises its holder's base allowance to Permit2.
contract CreepingToken {
    address public immutable PERMIT2;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(address permit2) {
        PERMIT2 = permit2;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        allowance[msg.sender][PERMIT2] += 1;
        return true;
    }
}

/// Records more than it was asked to.
contract OverPermit2 {
    uint160 public extra;
    mapping(address => mapping(address => mapping(address => uint160))) public amounts;

    function setExtra(uint160 e) external {
        extra = e;
    }

    function approve(address token, address spender, uint160 amount, uint48) external {
        amounts[msg.sender][token][spender] = amount + extra;
    }

    function allowance(address o, address t, address s) external view returns (uint160, uint48, uint48) {
        return (amounts[o][t][s], 0, 0);
    }
}

/// Each effect a sentence can promise, broken the way a real attacker would break it. The checks that read live state fire when
/// the world changes between validation and execution, the others when the call itself does something other than promised.
contract EffectsTest is Base {
    address constant FRIEND = address(0xF00D);
    address constant OPERATOR = address(0x0FE2);
    bytes4 constant SET_FOR_ALL = 0xa22cb465;
    bytes4 constant TRANSFER_FROM = 0x23b872dd;
    bytes4 constant APPROVE = 0x095ea7b3;

    function _attest(address target, bytes4 sel, bytes memory vdesc) private {
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](1);
        u.descriptors[0] = _du(target.codehash, sel, vdesc);
        u.tokens = new TrustStoreLayout.TokenUpdate[](1);
        u.tokens[0] = TrustStoreLayout.TokenUpdate(target, bytes11("TOK"), 3, 18, 0);
        u.spenders = new address[](1);
        u.spenders[0] = OPERATOR;
        refresh(u);
    }

    function _operatorDesc() private pure returns (bytes memory) {
        return bytes.concat(hex"56440001", hex"06", "Grant ", hex"02", hex"02", hex"0100", hex"01", hex"08", "Operator", hex"03", hex"0101", hex"04", hex"08", "Approved", hex"01", hex"04", hex"00", hex"0100", hex"0101", hex"0002");
    }

    function _nftDesc() private pure returns (bytes memory) {
        return bytes.concat(hex"56440001", hex"08", "Send NFT", hex"03", hex"03", hex"0100", hex"01", hex"04", "From", hex"00", hex"0101", hex"01", hex"02", "To", hex"01", hex"0102", hex"03", hex"02", "Id", hex"00", hex"01", hex"06", hex"00", hex"0102", hex"0101", hex"0000");
    }

    function _validated(VerbatimCore.Call[] memory calls) private {
        load(plan(calls, T0 + 100));
        frame0();
        frame1();
    }

    function _refused(bytes4 expected) private {
        (bool ok, bytes memory err) = frame2();
        assertFalse(ok);
        assertEq(errorName(err), expected);
    }

    /// Which check fired, by what it expected and saw: every AssertionFailed has the same selector.
    function _assertBroke(bytes memory err, uint256 expected, uint256 actual) private pure {
        assertEq(errorName(err), AssertionKit.AssertionFailed.selector);
        (, uint256 e, uint256 a) = abi.decode(_args(err), (uint256, uint256, uint256));
        assertEq(e, expected);
        assertEq(a, actual);
    }

    function _args(bytes memory err) private pure returns (bytes memory out) {
        out = new bytes(err.length - 4);
        for (uint256 i = 0; i < out.length; i++) out[i] = err[i + 4];
    }

    function test_target_code_swapped_after_validation_reverts() public {
        _validated(transferCall(FRIEND, 1e6));
        vm.etch(address(usdc), hex"5f5ff3");
        _refused(VerbatimCore.CodeChanged.selector);
    }

    function test_recipient_gains_code_after_validation_reverts() public {
        _validated(transferCall(FRIEND, 1e6));
        vm.etch(FRIEND, hex"5f5ff3");
        _refused(VerbatimCore.CodeAppeared.selector);
        assertEq(usdc.balanceOf(FRIEND), 0);
    }

    function test_token_grants_more_than_the_sentence_reverts() public {
        OverApprover t = new OverApprover();
        _attest(address(t), APPROVE, approveDesc());
        t.setExtra(1);
        (bool ok, bytes memory err) = run(plan(one(address(t), abi.encodeWithSelector(APPROVE, OPERATOR, 5)), T0 + 100));
        assertFalse(ok);
        _assertBroke(err, 5, 6);
        assertEq(t.allowance(address(account), OPERATOR), 0);
    }

    /// Asked for, and granted, but no approval outlives the transaction (D9).
    function test_standing_approval_as_promised_still_reverts() public {
        OverApprover t = new OverApprover();
        _attest(address(t), APPROVE, approveDesc());
        (bool ok, bytes memory err) = run(plan(one(address(t), abi.encodeWithSelector(APPROVE, OPERATOR, 5)), T0 + 100));
        assertFalse(ok);
        _assertBroke(err, 0, 5);
    }

    function test_clearing_an_approval_lands() public {
        OverApprover t = new OverApprover();
        _attest(address(t), APPROVE, approveDesc());
        (bool ok, ) = run(plan(one(address(t), abi.encodeWithSelector(APPROVE, OPERATOR, 0)), T0 + 100));
        assertTrue(ok);
    }

    /// Promised on, stays off: only OPERATOR_EQ can see this. APPROVALS_CLEARED would be happy.
    function test_operator_not_what_the_sentence_says_reverts() public {
        LyingNft n = new LyingNft();
        n.setLie(true);
        _attest(address(n), SET_FOR_ALL, _operatorDesc());
        (bool ok, bytes memory err) = run(plan(one(address(n), abi.encodeWithSelector(SET_FOR_ALL, OPERATOR, true)), T0 + 100));
        assertFalse(ok);
        _assertBroke(err, 1, 0);
    }

    function test_standing_operator_as_promised_still_reverts() public {
        LyingNft n = new LyingNft();
        _attest(address(n), SET_FOR_ALL, _operatorDesc());
        (bool ok, bytes memory err) = run(plan(one(address(n), abi.encodeWithSelector(SET_FOR_ALL, OPERATOR, true)), T0 + 100));
        assertFalse(ok);
        _assertBroke(err, 0, 1);
        assertFalse(n.isApprovedForAll(address(account), OPERATOR));
    }

    function test_revoking_an_operator_lands() public {
        LyingNft n = new LyingNft();
        _attest(address(n), SET_FOR_ALL, _operatorDesc());
        (bool ok, ) = run(plan(one(address(n), abi.encodeWithSelector(SET_FOR_ALL, OPERATOR, false)), T0 + 100));
        assertTrue(ok);
    }

    function test_nft_reaches_the_shown_recipient_lands() public {
        LyingNft n = new LyingNft();
        n.mint(address(account), 7);
        _attest(address(n), TRANSFER_FROM, _nftDesc());
        (bool ok, ) = run(plan(one(address(n), abi.encodeWithSelector(TRANSFER_FROM, address(account), FRIEND, 7)), T0 + 100));
        assertTrue(ok);
        assertEq(n.ownerOf(7), FRIEND);
    }

    function test_nft_not_at_the_shown_recipient_reverts() public {
        LyingNft n = new LyingNft();
        n.mint(address(account), 7);
        n.setLie(true);
        _attest(address(n), TRANSFER_FROM, _nftDesc());
        (bool ok, bytes memory err) = run(plan(one(address(n), abi.encodeWithSelector(TRANSFER_FROM, address(account), FRIEND, 7)), T0 + 100));
        assertFalse(ok);
        _assertBroke(err, uint160(FRIEND), uint160(address(account)));
        assertEq(n.ownerOf(7), address(account));
    }

    function test_permit2_records_more_than_the_sentence_reverts() public {
        OverPermit2 o = new OverPermit2();
        o.setExtra(1);
        _attest(address(o), OverPermit2.approve.selector, p2ApproveDesc());
        (bool ok, bytes memory err) = run(plan(one(address(o), abi.encodeCall(OverPermit2.approve, (address(usdc), OPERATOR, 5, uint48(T0 + 50)))), T0 + 100));
        assertFalse(ok);
        _assertBroke(err, 5, 6);
    }

    /// The sentence promises no other Permit2 allowance grows, for every token the account has ever granted Permit2.
    function test_hidden_permit2_allowance_growth_reverts() public {
        CreepingToken t = new CreepingToken(address(p2));
        t.mint(address(account), 100);
        _attest(address(t), APPROVE, approveDesc());
        _attest(address(t), 0xa9059cbb, transferDesc());
        (bool granted, ) = run(plan(one(address(t), abi.encodeWithSelector(APPROVE, address(p2), 5)), T0 + 100));
        assertTrue(granted);
        assertEq(t.allowance(address(account), address(p2)), 5);
        (bool ok, bytes memory err) = run(plan(one(address(t), abi.encodeWithSelector(0xa9059cbb, FRIEND, 1)), T0 + 100));
        assertFalse(ok);
        _assertBroke(err, 5, 6);
        assertEq(t.balanceOf(FRIEND), 0);
    }

    /// A descriptor that hides an admin call, as a compromised attestor quorum might sign one: the sentence says nothing, the invariant still holds.
    function _hiddenAdmin(uint8 words) private pure returns (bytes memory) {
        return bytes.concat(hex"56440001", hex"04", "Ping", bytes1(words), hex"00", hex"00", hex"0000");
    }

    function test_policy_change_the_sentence_hides_reverts() public {
        _attest(address(account), VerbatimCore.setPolicy.selector, _hiddenAdmin(3));
        (bool ok, bytes memory err) = run(plan(one(address(account), abi.encodeCall(VerbatimCore.setPolicy, (1 days, 6 hours, 0xffffffff))), T0 + 100));
        assertFalse(ok);
        _assertBroke(err, 0, 3);
    }

    function test_owner_change_the_sentence_hides_reverts() public {
        _attest(address(account), VerbatimCore.removeOwner.selector, _hiddenAdmin(1));
        (bool ok, bytes memory err) = run(plan(one(address(account), abi.encodeCall(VerbatimCore.removeOwner, (vm.addr(O3)))), T0 + 100));
        assertFalse(ok);
        _assertBroke(err, 0, 1);
        assertTrue(account.isOwner(vm.addr(O3)));
    }
}
