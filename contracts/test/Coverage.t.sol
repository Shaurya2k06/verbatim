// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {VerbatimCore} from "../src/account/VerbatimAccount.sol";
import {AssertionKit} from "../src/lib/AssertionKit.sol";
import {TrustStoreLayout} from "../src/trust/TrustStore.sol";
import {TestToken} from "../src/demo/TestTokens.sol";

contract MockWeth is TestToken("Wrapped", "WETH", 18) {
    uint256 public skimBps;

    function setSkim(uint256 b) external {
        skimBps = b;
    }

    function deposit() external payable {
        balanceOf[msg.sender] += (msg.value * (10_000 - skimBps)) / 10_000;
    }

    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: (amount * (10_000 - skimBps)) / 10_000}("");
        require(ok);
    }
}

/// ERC-4626 shape. `extra` is what it quietly takes beyond the sentence.
contract MockVault {
    TestToken public immutable ASSET;
    uint256 public extra;
    mapping(address => uint256) public balanceOf;

    constructor(TestToken a) {
        ASSET = a;
    }

    function setExtra(uint256 e) external {
        extra = e;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        ASSET.transferFrom(msg.sender, address(this), assets + extra);
        balanceOf[receiver] += assets;
        return assets;
    }
}

/// Aave v3 Pool shape. `shortBy` underpays a withdrawal.
contract MockPool {
    uint256 public shortBy;

    function setShort(uint256 s) external {
        shortBy = s;
    }

    function supply(address asset, uint256 amount, address, uint16) external {
        TestToken(asset).transferFrom(msg.sender, address(this), amount);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        TestToken(asset).transfer(to, amount - shortBy);
        return amount;
    }
}

/// Effects for ERC-20, WETH, a vault and a lending pool, with the compiled descriptors from `descriptors/`.
contract CoverageTest is Base {
    address constant ASSET = 0x00000000000000000000000000000000000a55E7;
    string json;
    TestToken asset;

    function setUp() public override {
        super.setUp();
        json = vm.readFile("../test/vectors/descriptors.json");
        vm.etch(ASSET, address(usdc).code);
        asset = TestToken(ASSET);
        asset.mint(address(account), 1000e6);
        asset.mint(address(0x900D), 1000e6);
    }

    function _d(string memory file, string memory sel) private view returns (bytes memory) {
        return vm.parseJsonBytes(json, string.concat(".", file, ".", sel));
    }

    function _attest(address target, bytes4 sel, bytes memory vdesc) private {
        TrustStoreLayout.TrustUpdate memory u = emptyUpdate();
        u.descriptors = new TrustStoreLayout.DescUpdate[](1);
        u.descriptors[0] = _du(target.codehash, sel, vdesc);
        u.tokens = new TrustStoreLayout.TokenUpdate[](2);
        u.tokens[0] = TrustStoreLayout.TokenUpdate(ASSET, bytes11("ASSET"), 5, 6, 0);
        u.tokens[1] = TrustStoreLayout.TokenUpdate(target, bytes11("TOK"), 3, 18, 0);
        u.spenders = new address[](1);
        u.spenders[0] = target;
        refresh(u);
    }

    function _approveAsset(address spender) private {
        vm.prank(address(account));
        asset.approve(spender, 500e6);
    }

    function test_weth_deposit_effect_holds() public {
        MockWeth w = new MockWeth();
        _attest(address(w), 0xd0e30db0, _d("weth", "0xd0e30db0"));
        VerbatimCore.Call[] memory c = one(address(w), abi.encodeWithSelector(0xd0e30db0));
        c[0].value = 1 ether;
        (bool ok, ) = run(plan(c, T0 + 100));
        assertTrue(ok);
        assertEq(w.balanceOf(address(account)), 1 ether);
    }

    function test_weth_deposit_shortfall_is_caught() public {
        MockWeth w = new MockWeth();
        w.setSkim(100);
        _attest(address(w), 0xd0e30db0, _d("weth", "0xd0e30db0"));
        VerbatimCore.Call[] memory c = one(address(w), abi.encodeWithSelector(0xd0e30db0));
        c[0].value = 1 ether;
        (bool ok, bytes memory err) = run(plan(c, T0 + 100));
        assertFalse(ok);
        assertEq(errorName(err), AssertionKit.AssertionFailed.selector);
    }

    function test_weth_withdraw_shortfall_is_caught() public {
        MockWeth w = new MockWeth();
        vm.deal(address(w), 10 ether);
        w.mint(address(account), 5 ether);
        w.setSkim(100);
        _attest(address(w), 0x2e1a7d4d, _d("weth", "0x2e1a7d4d"));
        (bool ok, bytes memory err) = run(plan(one(address(w), abi.encodeWithSelector(0x2e1a7d4d, uint256(1 ether))), T0 + 100));
        assertFalse(ok);
        assertEq(errorName(err), AssertionKit.AssertionFailed.selector);
    }

    function test_vault_deposit_effect_holds_and_overpull_is_caught() public {
        MockVault v = new MockVault(asset);
        _approveAsset(address(v));
        _attest(address(v), 0x6e553f65, _d("erc4626", "0x6e553f65"));
        bytes memory data = abi.encodeWithSelector(0x6e553f65, uint256(10e6), address(account));
        // A deposit to self is a net-zero sentence for the asset, so name another receiver.
        data = abi.encodeWithSelector(0x6e553f65, uint256(10e6), address(0x900D));
        (bool ok, ) = run(plan(one(address(v), data), T0 + 100));
        assertTrue(ok, "honest deposit");
        v.setExtra(1);
        (bool ok2, bytes memory err) = run(plan(one(address(v), data), T0 + 100));
        assertFalse(ok2, "pulling one unit more than said");
        assertEq(errorName(err), AssertionKit.AssertionFailed.selector);
    }

    function test_lending_supply_and_short_withdraw() public {
        MockPool p = new MockPool();
        _approveAsset(address(p));
        _attest(address(p), 0x617ba037, _d("aave_v3_pool", "0x617ba037"));
        (bool ok, ) = run(plan(one(address(p), abi.encodeWithSelector(0x617ba037, ASSET, uint256(10e6), address(0x900D), uint16(0))), T0 + 100));
        assertTrue(ok, "honest supply");
        _attest(address(p), 0x69328dec, _d("aave_v3_pool", "0x69328dec"));
        bytes memory w = abi.encodeWithSelector(0x69328dec, ASSET, uint256(5e6), address(account));
        (bool ok2, ) = run(plan(one(address(p), w), T0 + 100));
        assertTrue(ok2, "honest withdraw");
        p.setShort(1);
        (bool ok3, bytes memory err) = run(plan(one(address(p), w), T0 + 100));
        assertFalse(ok3, "paying one unit less than said");
        assertEq(errorName(err), AssertionKit.AssertionFailed.selector);
    }
}
