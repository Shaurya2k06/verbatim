// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Frame introspection and APPROVE behind virtual functions. Foundry tests mix in a mock; the devnet uses DevnetFrames.
abstract contract FrameIntrospection {
    uint256 internal constant TX_SENDER = 0x02;
    uint256 internal constant TX_SIG_HASH = 0x08;
    uint256 internal constant TX_FRAME_COUNT = 0x09;
    uint256 internal constant TX_CURRENT_FRAME = 0x0a;
    uint256 internal constant TX_SIG_COUNT = 0x0b;

    uint256 internal constant FP_TARGET = 0x00;
    uint256 internal constant FP_GAS = 0x01;
    uint256 internal constant FP_MODE = 0x02;
    uint256 internal constant FP_FLAGS = 0x03;
    uint256 internal constant FP_DATA_LENGTH = 0x04;
    uint256 internal constant FP_VALUE = 0x08;
    uint256 internal constant FP_STATE_GAS = 0x09;

    uint256 internal constant SP_SCHEME = 0x01;
    uint256 internal constant SP_MSG = 0x02;
    uint256 internal constant SP_LENGTH = 0x03;

    uint256 internal constant MODE_VERIFY = 1;
    uint256 internal constant MODE_SENDER = 2;
    uint256 internal constant SCOPE_PAYMENT = 1;
    uint256 internal constant SCOPE_EXECUTION = 2;
    uint256 internal constant SCHEME_ARBITRARY = 0;

    function _txparam(uint256 param) internal view virtual returns (uint256);
    function _frameparam(uint256 frameIndex, uint256 param) internal view virtual returns (uint256);
    function _framedataload(uint256 offset, uint256 frameIndex) internal view virtual returns (uint256);
    function _framedatacopy(uint256 offset, uint256 length, uint256 frameIndex) internal view virtual returns (bytes memory);
    function _sigparam(uint256 sigIndex, uint256 param) internal view virtual returns (uint256);
    function _sigdatacopy(uint256 offset, uint256 length, uint256 sigIndex) internal view virtual returns (bytes memory);
    /// Ends the frame on success, like RETURN.
    function _approve(uint256 scope) internal virtual;
}

/// The real thing. Reads go to the shared FrameReader by STATICCALL.
///
/// APPROVE must execute in the frame target's own code (`ADDRESS == resolved_target`), and Solidity cannot emit it.
/// The usual helper is a DELEGATECALL, which the account forbids (D10). `log1(0, 0, scope)` has the same stack shape
/// as APPROVE (offset, length, scope), so the deploy tool flips that single byte from LOG1 (0xa1) to APPROVE (0xaa),
/// after checking that the runtime holds exactly one LOG1 (see tools/scripts/lib/patch.ts). No contract using this
/// mixin may emit a one-topic log.
abstract contract DevnetFrames is FrameIntrospection {
    address internal immutable FRAME_READER;

    error FrameReadFailed();

    constructor(address frameReader) {
        FRAME_READER = frameReader;
    }

    function _word(uint256 op, uint256 a, uint256 b) private view returns (uint256 v) {
        (bool ok, bytes memory out) = FRAME_READER.staticcall(abi.encode(op, a, b, uint256(0)));
        if (!ok || out.length != 32) revert FrameReadFailed();
        v = abi.decode(out, (uint256));
    }

    function _bytes(uint256 op, uint256 a, uint256 b, uint256 c) private view returns (bytes memory out) {
        bool ok;
        (ok, out) = FRAME_READER.staticcall(abi.encode(op, a, b, c));
        if (!ok || out.length != b) revert FrameReadFailed();
    }

    function _txparam(uint256 param) internal view override returns (uint256) {
        return _word(0, param, 0);
    }

    function _frameparam(uint256 frameIndex, uint256 param) internal view override returns (uint256) {
        return _word(1, frameIndex, param);
    }

    function _framedataload(uint256 offset, uint256 frameIndex) internal view override returns (uint256) {
        return _word(2, offset, frameIndex);
    }

    function _framedatacopy(uint256 offset, uint256 length, uint256 frameIndex) internal view override returns (bytes memory) {
        return _bytes(3, offset, length, frameIndex);
    }

    function _sigparam(uint256 sigIndex, uint256 param) internal view override returns (uint256) {
        return _word(4, sigIndex, param);
    }

    function _sigdatacopy(uint256 offset, uint256 length, uint256 sigIndex) internal view override returns (bytes memory) {
        return _bytes(5, offset, length, sigIndex);
    }

    function _approve(uint256 scope) internal override {
        assembly ("memory-safe") {
            log1(0, 0, scope)
        }
    }
}
