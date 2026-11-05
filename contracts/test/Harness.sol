// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RendererCore} from "../src/paymaster/RendererPaymaster.sol";
import {DisplayVM} from "../src/lib/DisplayVM.sol";
import {SSTORE2} from "../src/lib/SSTORE2.sol";

/// DisplayVM over a directly writable trust store, with code hashes from a table so any address can be anything.
/// The differential fuzzer drives `render` over RPC; unit tests use it directly.
contract RenderHarness is RendererCore {
    mapping(address => bytes32) public fakeCode;
    bool public useNames;

    constructor(address permit2, address weth, bytes32 publisher) RendererCore(msg.sender, address(0), permit2, weth, publisher, new address[](0), 0) {}

    function setCode(address a, bytes32 h) external {
        fakeCode[a] = h;
    }

    function setDesc(bytes32 ch, bytes4 sel, bytes calldata vdesc, bytes32 publisher, uint64 epoch, uint8 status) external {
        _descOf[ch][sel] = DescSlot(SSTORE2.write(abi.encodePacked(publisher, vdesc)), epoch, status, false);
    }

    function setToken(address t, bytes11 symbol, uint8 symLen, uint8 decimals, uint8 flags) external {
        _tokens[t] = TokenSlot(symbol, symLen, decimals, flags, true);
    }

    function setKind(bytes32 ch, uint8 kind) external {
        _codeKind_[ch] = kind;
    }

    function setProxy(bytes32 ch, address upgrader, bytes32 logic, address impl, bytes4 getter) external {
        _codeKind_[ch] = 2;
        _proxyTemplates[ch] = ProxyTemplate(upgrader, logic, impl, getter);
    }

    function setSpender(address a, bool v) external {
        _attestedSpenders[a] = v;
    }

    function setHook(bytes32 ch, bool v) external {
        _attestedHooks[ch] = v;
    }

    function setName(address a, bytes32 n, address resolver) external {
        _names[a] = n;
        _nameResolvers[a] = resolver;
        useNames = true;
    }

    function _codehashOf(address a) internal view override returns (bytes32) {
        return fakeCode[a];
    }

    function _nameOf(address a) internal view override returns (bytes32) {
        return useNames ? _names[a] : bytes32(0);
    }

    function render(DisplayVM.In memory i) external view returns (bytes memory tree, bytes memory spec, uint256 risk) {
        DisplayVM.Out memory o = _render(i);
        return (o.tree, o.spec, o.risk);
    }

    function renderGas(DisplayVM.In memory i) external view returns (uint256 used) {
        uint256 g = gasleft();
        _render(i);
        used = g - gasleft();
    }
}
