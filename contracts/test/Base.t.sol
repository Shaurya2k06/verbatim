// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FrameEnv, MockFrames} from "./MockFrames.sol";
import {VerbatimAccountBase, VerbatimCore} from "../src/account/VerbatimAccount.sol";
import {RendererPaymasterBase} from "../src/paymaster/RendererPaymaster.sol";
import {DisplayVM} from "../src/lib/DisplayVM.sol";
import {TrustAdmin, TrustStoreLayout} from "../src/trust/TrustStore.sol";
import {TestToken} from "../src/demo/TestTokens.sol";
import {EvilVault, GasBurner, Reenterer} from "../src/demo/EvilVault.sol";
import {SkimHook} from "../src/demo/SkimHook.sol";

contract TestAccount is VerbatimAccountBase, MockFrames {
    constructor(address r, address[] memory o, uint8 t, FrameEnv env) VerbatimAccountBase(r, o, t) MockFrames(env) {}
}

contract TestPaymaster is RendererPaymasterBase, MockFrames {
    constructor(bytes32 ch, address owner_, address admin, address p2, address weth, bytes32 pub_, address[] memory a, uint8 t, FrameEnv env) RendererPaymasterBase(ch, owner_, admin, p2, weth, pub_, a, t) MockFrames(env) {}

    function setTicketForTest(address a, uint256 nonce, uint128 amount) external {
        _feeTickets[a][nonce].amount = amount;
    }

    function renderView(DisplayVM.In memory i) external view returns (bytes memory tree, bytes memory spec, uint256 risk) {
        DisplayVM.Out memory o = _render(i);
        return (o.tree, o.spec, o.risk);
    }

    function applyPolicyView(uint256 risk, uint256 allow) external pure {
        _applyPolicy(risk, allow);
    }
}

/// A Permit2 stand-in with the real allowance layout: amount first.
contract MockPermit2 {
    mapping(address => mapping(address => mapping(address => uint160))) public amounts;

    function approve(address token, address spender, uint160 amount, uint48) external {
        amounts[msg.sender][token][spender] = amount;
    }

    function allowance(address o, address t, address s) external view returns (uint160, uint48, uint48) {
        return (amounts[o][t][s], 0, 0);
    }

    function spend(address o, address t, uint160 amount) external {
        amounts[o][t][msg.sender] -= amount;
    }
}

/// Keeps pulling the input and paying the output, like the router; `outBps` lets a test underdeliver.
contract MockRouter {
    MockPermit2 public immutable P2;
    uint256 public outBps = 10_000;

    constructor(MockPermit2 p2) {
        P2 = p2;
    }

    function setOutBps(uint256 b) external {
        outBps = b;
    }

    function execute(bytes calldata, bytes[] calldata inputs, uint256) external payable {
        (, bytes[] memory params) = abi.decode(inputs[0], (bytes, bytes[]));
        (address tokenIn, uint256 amountIn) = abi.decode(params[1], (address, uint256));
        (address tokenOut, uint256 min) = abi.decode(params[2], (address, uint256));
        P2.spend(msg.sender, tokenIn, uint160(amountIn));
        TestToken(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        TestToken(tokenOut).mint(msg.sender, (min * outBps) / 10_000);
    }
}

abstract contract Base is Test {
    uint256 internal constant O1 = 0xA1;
    uint256 internal constant O2 = 0xA2;
    uint256 internal constant O3 = 0xA3;
    uint256 internal constant AT1 = 0xB1;
    uint256 internal constant AT2 = 0xB2;
    uint256 internal constant AT3 = 0xB3;
    address internal constant BOB = address(0xB0B);
    address internal constant THIEF = address(0xBAD);
    bytes32 internal constant PUBLISHER = 0x556e697377617000000000000000000000000000000000000000000000000007;
    bytes32 internal constant ATTESTORS = 0x56657262617469616d0000000000000000000000000000000000000000000009;

    FrameEnv internal env;
    TestAccount internal account;
    TestPaymaster internal rpm;
    TrustAdmin internal admin;
    TestToken internal usdc;
    TestToken internal weth;
    EvilVault internal vault;
    MockPermit2 internal p2;
    MockRouter internal router;
    uint64 internal epoch;

    struct Plan {
        VerbatimCore.Fee fee;
        VerbatimCore.Call[] calls;
        bytes spec;
        bytes tree;
        address[] hints;
        uint64 validUntil;
        uint256 risk;
    }

    function setUp() public virtual {
        vm.warp(T0);
        env = new FrameEnv();
        admin = new TrustAdmin();
        address[] memory owners = new address[](3);
        owners[0] = vm.addr(O1);
        owners[1] = vm.addr(O2);
        owners[2] = vm.addr(O3);
        address[] memory attestors = new address[](3);
        attestors[0] = vm.addr(AT1);
        attestors[1] = vm.addr(AT2);
        attestors[2] = vm.addr(AT3);

        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        account = new TestAccount(predicted, owners, 2, env);
        p2 = new MockPermit2();
        predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        // The account was built against the first prediction, so redeploy it against the paymaster's real address.
        account = new TestAccount(vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1), owners, 2, env);
        rpm = new TestPaymaster(address(account).codehash, address(this), address(admin), address(p2), address(0x9090), PUBLISHER, attestors, 2, env);
        assertEq(account.RENDERER_PAYMASTER(), address(rpm));
        vm.deal(address(this), 100 ether);
        admin_().fundTickets{value: 1 ether}(address(account), 1, 100);
        vm.deal(address(account), 1 ether);

        usdc = new TestToken("Demo USD", "dUSDC", 6);
        weth = new TestToken("Demo Wrapped Ether", "dWETH", 18);
        usdc.mint(address(account), 1000e6);
        weth.mint(address(account), 100e18);
        vault = new EvilVault(address(usdc), address(weth), THIEF);
        router = new MockRouter(p2);

        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](4);
        u.descriptors[0] = TrustStoreLayout.DescUpdate(address(usdc).codehash, 0xa9059cbb, transferDesc(), ATTESTORS);
        u.descriptors[1] = TrustStoreLayout.DescUpdate(address(usdc).codehash, 0x095ea7b3, approveDesc(), ATTESTORS);
        u.descriptors[2] = TrustStoreLayout.DescUpdate(address(vault).codehash, 0xb6b55f25, depositDesc(address(usdc)), ATTESTORS);
        u.descriptors[3] = TrustStoreLayout.DescUpdate(address(account).codehash, 0x7065cb48, addOwnerDesc(), ATTESTORS);
        u.tokens = new TrustStoreLayout.TokenUpdate[](2);
        u.tokens[0] = TrustStoreLayout.TokenUpdate(address(usdc), bytes11("dUSDC"), 5, 6, 0);
        u.tokens[1] = TrustStoreLayout.TokenUpdate(address(weth), bytes11("dWETH"), 5, 18, 0);
        u.spenders = new address[](2);
        u.spenders[0] = address(vault);
        u.spenders[1] = address(p2);
        u.routers = new TrustStoreLayout.RouterUpdate[](1);
        u.routers[0] = TrustStoreLayout.RouterUpdate(address(router).codehash, false);
        refresh(u);
    }

    /// The paymaster seen through its admin module's ABI.
    function admin_() internal view returns (TrustAdmin) {
        return TrustAdmin(payable(address(rpm)));
    }

    function emptyUpdate() internal returns (TrustStoreLayout.TrustUpdate memory u) {
        u.epoch = ++epoch;
    }

    function refresh(TrustStoreLayout.TrustUpdate memory u) internal {
        (bool ok, bytes memory ret) = address(rpm).call(abi.encodeCall(TrustAdmin.trustUpdateHash, (u)));
        require(ok, "hash");
        bytes32 h = abi.decode(ret, (bytes32));
        (bool ok2, bytes memory ret2) = address(rpm).call(abi.encodeCall(TrustAdmin.refreshTrust, (u, attestorSigs(h))));
        if (!ok2) {
            assembly ("memory-safe") {
                revert(add(ret2, 0x20), mload(ret2))
            }
        }
    }

    function attestorSigs(bytes32 h) internal pure returns (bytes[] memory sigs) {
        uint256[2] memory keys = [AT1, AT2];
        if (vm.addr(AT1) > vm.addr(AT2)) keys = [AT2, AT1];
        sigs = new bytes[](2);
        for (uint256 i = 0; i < 2; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[i], h);
            sigs[i] = abi.encodePacked(r, s, v);
        }
    }

    // -------------------------------------------------------------------- descriptors ------------

    function _h(string memory s) private pure returns (bytes memory) {
        return bytes(s);
    }

    function transferDesc() internal pure returns (bytes memory) {
        return bytes.concat(hex"56440001", hex"0b", "Send tokens", hex"02", hex"02", hex"0100", hex"01", hex"02", "To", hex"01", hex"0101", hex"02", hex"06", "Amount", hex"00", hex"01", hex"01", hex"00", hex"0101", hex"0100", hex"0000");
    }

    function approveDesc() internal pure returns (bytes memory) {
        return bytes.concat(hex"56440001", hex"10", "Approve spending", hex"02", hex"02", hex"0100", hex"01", hex"07", "Spender", hex"02", hex"0101", hex"02", hex"06", "Amount", hex"00", hex"01", hex"03", hex"00", hex"0100", hex"0101", hex"0001");
    }

    function depositDesc(address token) internal pure returns (bytes memory) {
        return bytes.concat(hex"56440001", hex"12", "Deposit into vault", hex"01", hex"01", hex"0100", hex"02", hex"06", "Amount", hex"02", abi.encodePacked(token), hex"01", hex"01", hex"02", abi.encodePacked(token), hex"0100", hex"0100", hex"0000");
    }

    function addOwnerDesc() internal pure returns (bytes memory) {
        return bytes.concat(hex"56440001", hex"0c", "Add an owner", hex"01", hex"01", hex"0100", hex"01", hex"09", "New owner", hex"00", hex"00", hex"0004");
    }

    // ----------------------------------------------------------------------- planning -----------

    function allHints(VerbatimCore.Call[] memory calls) internal view returns (address[] memory h) {
        h = new address[](calls.length + 2);
        for (uint256 i = 0; i < calls.length; i++) h[i] = calls[i].target;
        h[calls.length] = address(router);
        h[calls.length + 1] = address(vault);
    }

    function policyHash() internal view returns (bytes32) {
        return rpm.policyHashOf(address(account));
    }

    function body(VerbatimCore.Fee memory fee, VerbatimCore.Call[] memory calls, bytes memory spec) internal pure returns (bytes memory) {
        return abi.encode(fee, calls, spec);
    }

    uint256 internal constant GAS_F0 = 100_000;
    uint256 internal constant GAS_F1 = 1_000_000;
    uint256 internal constant GAS_F2 = 5_000_000;
    uint256 internal constant GAS_TOTAL = GAS_F0 + GAS_F1 + GAS_F2;
    uint256 internal constant FEE = 1000;
    uint256 internal nonceNow = 1;
    uint64 internal constant T0 = 1_800_000_000;

    function plan(VerbatimCore.Call[] memory calls, uint64 validUntil) internal view returns (Plan memory p) {
        p.fee = VerbatimCore.Fee(address(0), FEE);
        p.calls = calls;
        p.validUntil = validUntil;
        p.hints = allHints(calls);
        DisplayVM.In memory i = input(p);
        (p.tree, p.spec, p.risk) = rpm.renderView(i);
    }

    function input(Plan memory p) internal view returns (DisplayVM.In memory i) {
        i.chainId = uint64(block.chainid);
        i.account = address(account);
        i.validUntil = p.validUntil;
        i.feeAsset = p.fee.asset;
        i.feeAmount = p.fee.amount;
        i.gasLimitTotal = uint64(GAS_TOTAL);
        i.policyHash = policyHash();
        i.body = body(p.fee, p.calls, "");
        i.hints = p.hints;
    }

    function one(address target, bytes memory data) internal pure returns (VerbatimCore.Call[] memory c) {
        c = new VerbatimCore.Call[](1);
        c[0] = VerbatimCore.Call(target, 0, data);
    }

    function transferCall(address to, uint256 amount) internal view returns (VerbatimCore.Call[] memory) {
        return one(address(usdc), abi.encodeWithSelector(0xa9059cbb, to, amount));
    }

    function txCommit() internal view returns (bytes32) {
        FrameEnv.Frame memory f0 = env.frame(0);
        FrameEnv.Frame memory f1 = env.frame(1);
        FrameEnv.Frame memory f2 = env.frame(2);
        return keccak256(abi.encode(env.nonce(), env.maxPriorityFee(), env.maxFee(), f0.gasLimit, f0.stateGas, f1.gasLimit, f1.stateGas, f2.gasLimit, f2.stateGas, keccak256(f1.data), keccak256(f2.data)));
    }

    /// Loads the transaction into the mock protocol, with owners O1 and O2 signing what `treeHash` and `specHash` say.
    function load(Plan memory p, bytes32 treeHash, bytes32 specHash) internal {
        env.reset();
        env.setTx(address(account), nonceNow, 1, 100);
        env.setMaxCost(FEE);
        bytes memory f0 = abi.encodeCall(VerbatimAccountBase.verifyFrame, (treeHash, specHash, p.validUntil));
        bytes memory f1 = abi.encodeCall(RendererPaymasterBase.verifyFrame, (p.hints));
        bytes memory f2 = abi.encodeCall(VerbatimAccountBase.executeVerified, (p.fee, p.calls, p.spec));
        env.pushFrame(FrameEnv.Frame(1, 2, address(account), GAS_F0, 0, 0, f0));
        env.pushFrame(FrameEnv.Frame(1, 1, address(rpm), GAS_F1, 0, 0, f1));
        env.pushFrame(FrameEnv.Frame(2, 0, address(account), GAS_F2, 0, 0, f2));
        signWith(p, treeHash, specHash, O1, O2);
    }

    function load(Plan memory p) internal {
        load(p, keccak256(p.tree), keccak256(p.spec));
    }

    function signWith(Plan memory p, bytes32 treeHash, bytes32 specHash, uint256 k1, uint256 k2) internal {
        bytes32 d = account.digestOf(txCommit(), treeHash, specHash, p.validUntil);
        address a1 = vm.addr(k1);
        address a2 = vm.addr(k2);
        if (a1 > a2) (a1, a2) = (a2, a1);
        env.pushSig(FrameEnv.Sig(1, a1, d));
        env.pushSig(FrameEnv.Sig(1, a2, d));
    }

    /// The next frame call as the protocol would make it: data read first, so the prank lands on the frame itself.
    function callFrame(uint256 i, address target, address caller) internal returns (bool ok, bytes memory ret) {
        env.setCurrent(i);
        bytes memory data = env.frame(i).data;
        vm.prank(caller);
        (ok, ret) = target.call(data);
    }

    function expectFrame0(bytes memory err) internal {
        env.setCurrent(0);
        bytes memory data = env.frame(0).data;
        vm.prank(address(0xaa));
        vm.expectRevert(err);
        (bool ok, ) = address(account).call(data);
        ok;
    }

    function expectFrame1(bytes memory err) internal {
        env.setCurrent(1);
        bytes memory data = env.frame(1).data;
        vm.prank(address(0xaa));
        vm.expectRevert(err);
        (bool ok, ) = address(rpm).call(data);
        ok;
    }

    function expectRefresh(TrustStoreLayout.TrustUpdate memory u, bytes memory err) internal {
        (bool ok, bytes memory ret) = address(rpm).call(abi.encodeCall(TrustAdmin.trustUpdateHash, (u)));
        require(ok, "hash");
        bytes[] memory sigs = attestorSigs(abi.decode(ret, (bytes32)));
        vm.expectRevert(err);
        (bool ok2, ) = address(rpm).call(abi.encodeCall(TrustAdmin.refreshTrust, (u, sigs)));
        ok2;
    }

    function frame0() internal {
        env.setCurrent(0);
        FrameEnv.Frame memory f = env.frame(0);
        vm.prank(address(0xaa));
        (bool ok, bytes memory ret) = address(account).call(f.data);
        _bubble(ok, ret);
        assertEq(env.lastApproved(), 2, "frame 0 approves execution");
    }

    function frame1() internal {
        env.setCurrent(1);
        FrameEnv.Frame memory f = env.frame(1);
        vm.prank(address(0xaa));
        (bool ok, bytes memory ret) = address(rpm).call(f.data);
        _bubble(ok, ret);
        assertEq(env.lastApproved(), 1, "frame 1 approves payment");
    }

    function frame2() internal returns (bool batchOk, bytes memory err) {
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

    function run(Plan memory p) internal returns (bool, bytes memory) {
        load(p);
        frame0();
        frame1();
        (bool ok, bytes memory err) = frame2();
        nonceNow++;
        return (ok, err);
    }

    function _bubble(bool ok, bytes memory ret) internal pure {
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }

    function errorName(bytes memory err) internal pure returns (bytes4 s) {
        assembly ("memory-safe") {
            s := mload(add(err, 0x20))
        }
    }

    /// An error wrapped in CallFailed(index, reason).
    function innerError(bytes memory err) internal pure returns (bytes4) {
        bytes memory payload = new bytes(err.length - 4);
        for (uint256 i = 0; i < payload.length; i++) payload[i] = err[i + 4];
        (, bytes memory reason) = abi.decode(payload, (uint256, bytes));
        return reason.length >= 4 ? errorName(reason) : bytes4(0);
    }
}

import {Vm} from "forge-std/Vm.sol";
