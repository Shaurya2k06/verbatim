// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EnsTrustChecker, IPermissionedRegistryV2} from "../src/trust/EnsTrustChecker.sol";

contract MockRegistry {
    mapping(string => address) public subregistries;
    mapping(string => address) public resolvers;
    mapping(uint256 => uint256) public counts;
    uint64 public expiry;

    function setSub(string calldata l, address a) external {
        subregistries[l] = a;
    }

    function setResolver(string calldata l, address a) external {
        resolvers[l] = a;
    }

    function setCount(uint256 r, uint256 c) external {
        counts[r] = c;
    }

    function setExpiry(uint64 e) external {
        expiry = e;
    }

    function getSubregistry(string calldata l) external view returns (address) {
        return subregistries[l];
    }

    function getResolver(string calldata l) external view returns (address) {
        return resolvers[l];
    }

    function getState(uint256 id) external view returns (IPermissionedRegistryV2.State memory) {
        return IPermissionedRegistryV2.State(1, expiry, address(1), id, id);
    }

    function roleCount(uint256 r) external view returns (uint256) {
        return counts[r];
    }
}

contract MockResolver {
    string public record;
    address public addrRecord;
    mapping(uint256 => uint256) public counts;
    mapping(uint256 => mapping(address => bool)) public holders;

    function setRecord(string calldata r) external {
        record = r;
    }

    function setAddr(address a) external {
        addrRecord = a;
    }

    function setCount(uint256 r, uint256 c) external {
        counts[r] = c;
    }

    function setHolder(uint256 r, address a, bool v) external {
        holders[r][a] = v;
    }

    function resolve(bytes calldata, bytes calldata data) external view returns (bytes memory) {
        if (bytes4(data[:4]) == bytes4(keccak256("addr(bytes32)"))) return abi.encode(addrRecord);
        return abi.encode(record);
    }

    function roleCount(uint256 r) external view returns (uint256) {
        return counts[r];
    }

    function hasRoles(uint256 r, uint256, address a) external view returns (bool) {
        return holders[r][a];
    }
}

/// Every step of the exclusivity proof (§12.2) fails closed on its own. A8 lives here and on Sepolia (docs/PROOFS.md).
contract EnsCheckerTest is Test {
    uint256 constant KEY = uint256(keccak256("clear-signing"));
    uint256 constant SET_TEXT = 1 << 4;
    uint256 constant LINK = 1 << 28;
    uint256 constant UPGRADE = 1 << 124;
    uint256 constant SET_RESOLVER = 1 << 24;
    uint256 constant SET_SUBREGISTRY = 1 << 20;
    address constant COUNCIL = address(0xC0);
    bytes32 constant DESC = keccak256("descriptor");
    string constant LABEL = "vault";
    bytes32 name_;

    MockRegistry root;
    MockRegistry eth;
    MockResolver res;
    EnsTrustChecker checker;

    function setUp() public {
        vm.warp(1_800_000_000);
        // "vault.eth" packed: text left-aligned, length in the last byte.
        name_ = bytes32(bytes.concat(bytes("vault.eth"), new bytes(22), bytes1(uint8(9))));
        root = new MockRegistry();
        eth = new MockRegistry();
        res = new MockResolver();
        checker = new EnsTrustChecker(address(root), address(eth), address(res).codehash, COUNCIL, 365 days);
        root.setSub("eth", address(eth));
        eth.setResolver(LABEL, address(res));
        eth.setExpiry(uint64(block.timestamp + 2 * 365 days));
        res.setRecord(_listing(DESC));
        res.setCount(KEY, SET_TEXT);
        res.setHolder(KEY, COUNCIL, true);
    }

    function _listing(bytes32 h) private pure returns (string memory) {
        return string.concat("0xaaaa,", vm.toString(h), ",0xbbbb");
    }

    function test_clean_name_passes() public view {
        checker.check(name_, DESC);
    }

    function test_A8_lookalike_with_root_roles_fails() public {
        res.setCount(0, SET_TEXT);
        vm.expectRevert(abi.encodeWithSelector(EnsTrustChecker.RootRolesHeld.selector, SET_TEXT));
        checker.check(name_, DESC);
    }

    function test_A8_lookalike_with_other_resolver_code_fails() public {
        MockRegistry other = new MockRegistry();
        eth.setResolver(LABEL, address(other));
        vm.expectRevert(abi.encodeWithSelector(EnsTrustChecker.WrongResolverCode.selector, address(other).codehash));
        checker.check(name_, DESC);
    }

    function test_root_link_or_upgrade_or_their_admins_fail() public {
        uint256[6] memory bad = [LINK, UPGRADE, SET_TEXT << 128, LINK << 128, UPGRADE << 128, SET_TEXT * 2];
        for (uint256 i = 0; i < bad.length; i++) {
            res.setCount(0, bad[i]);
            vm.expectRevert(abi.encodeWithSelector(EnsTrustChecker.RootRolesHeld.selector, bad[i]));
            checker.check(name_, DESC);
        }
    }

    function test_unrelated_root_role_is_allowed() public {
        res.setCount(0, 1); // ROLE_SET_ADDRESS: the record we check is text
        checker.check(name_, DESC);
    }

    function test_record_must_list_this_hash() public {
        res.setRecord(_listing(keccak256("other")));
        vm.expectRevert(abi.encodeWithSelector(EnsTrustChecker.RecordMissing.selector, DESC));
        checker.check(name_, DESC);
    }

    function test_setter_must_be_the_council_alone() public {
        res.setCount(KEY, SET_TEXT * 2);
        vm.expectRevert(abi.encodeWithSelector(EnsTrustChecker.SetterNotExclusive.selector, SET_TEXT * 2));
        checker.check(name_, DESC);

        res.setCount(KEY, SET_TEXT | (SET_TEXT << 128));
        vm.expectRevert(abi.encodeWithSelector(EnsTrustChecker.SetterNotExclusive.selector, SET_TEXT | (SET_TEXT << 128)));
        checker.check(name_, DESC);

        res.setCount(KEY, SET_TEXT);
        res.setHolder(KEY, COUNCIL, false);
        vm.expectRevert(abi.encodeWithSelector(EnsTrustChecker.SetterNotExclusive.selector, SET_TEXT));
        checker.check(name_, DESC);
    }

    function test_name_must_be_locked_to_its_resolver() public {
        uint256 id = uint256(keccak256(bytes(LABEL)));
        eth.setCount(id, SET_RESOLVER);
        vm.expectRevert(abi.encodeWithSelector(EnsTrustChecker.RegistryRolesHeld.selector, SET_RESOLVER));
        checker.check(name_, DESC);
    }

    function test_parents_must_not_hold_direct_rights() public {
        eth.setCount(0, SET_SUBREGISTRY);
        vm.expectRevert(abi.encodeWithSelector(EnsTrustChecker.RegistryRolesHeld.selector, SET_SUBREGISTRY));
        checker.check(name_, DESC);
    }

    function test_expiry_horizon() public {
        uint64 soon = uint64(block.timestamp + 30 days);
        eth.setExpiry(soon);
        vm.expectRevert(abi.encodeWithSelector(EnsTrustChecker.ExpiresTooSoon.selector, soon));
        checker.check(name_, DESC);
    }

    function test_wrong_eth_registry_and_missing_resolver() public {
        eth.setResolver(LABEL, address(0));
        vm.expectRevert(EnsTrustChecker.NoResolver.selector);
        checker.check(name_, DESC);
        root.setSub("eth", address(0xdead));
        vm.expectRevert(abi.encodeWithSelector(EnsTrustChecker.WrongEthRegistry.selector, address(0xdead)));
        checker.check(name_, DESC);
    }

    function test_only_second_level_eth_names() public {
        bytes32 sub = bytes32(bytes.concat(bytes("a.vault.eth"), new bytes(20), bytes1(uint8(11))));
        vm.expectRevert(EnsTrustChecker.BadName.selector);
        checker.check(sub, DESC);
        bytes32 dns = bytes32(bytes.concat(bytes("vault.xyz"), new bytes(22), bytes1(uint8(9))));
        vm.expectRevert(EnsTrustChecker.BadName.selector);
        checker.check(dns, DESC);
    }

    function test_forward_check_for_cached_names() public {
        res.setAddr(address(0xBEEF));
        checker.checkName(address(0xBEEF), name_, address(res));
        vm.expectRevert(abi.encodeWithSelector(EnsTrustChecker.ForwardMismatch.selector, address(0xBEEF)));
        checker.checkName(address(0xBAD), name_, address(res));
    }
}
