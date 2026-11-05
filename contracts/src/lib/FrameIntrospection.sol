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

    uint256 internal constant SP_SIGNER = 0x00;
    uint256 internal constant SP_SCHEME = 0x01;
    uint256 internal constant SP_MSG = 0x02;
    uint256 internal constant SP_LENGTH = 0x03;

    uint256 internal constant MODE_VERIFY = 1;
    uint256 internal constant MODE_SENDER = 2;
    uint256 internal constant SCOPE_PAYMENT = 1;
    uint256 internal constant SCOPE_EXECUTION = 2;
    uint256 internal constant SCHEME_ARBITRARY = 0;
    uint256 internal constant SCHEME_SECP256K1 = 1;

    function _txparam(uint256 param) internal view virtual returns (uint256);
    function _frameparam(uint256 frameIndex, uint256 param) internal view virtual returns (uint256);
    function _framedataload(uint256 offset, uint256 frameIndex) internal view virtual returns (uint256);
    function _framedatacopy(uint256 offset, uint256 length, uint256 frameIndex) internal view virtual returns (bytes memory);
    function _sigparam(uint256 sigIndex, uint256 param) internal view virtual returns (uint256);
    function _sigdatacopy(uint256 offset, uint256 length, uint256 sigIndex) internal view virtual returns (bytes memory);
    /// The whole frame layout in one read. With anything but 3 frames, only `frameCount` is set.
    struct Layout {
        uint256 frameCount;
        uint256 current;
        uint256 sender;
        uint256 sigCount;
        uint256 t0;
        uint256 m0;
        uint256 f0;
        uint256 v0;
        uint256 g0;
        uint256 s0;
        uint256 l0;
        uint256 t1;
        uint256 m1;
        uint256 f1;
        uint256 v1;
        uint256 g1;
        uint256 s1;
        uint256 l1;
        uint256 t2;
        uint256 m2;
        uint256 f2;
        uint256 v2;
        uint256 g2;
        uint256 s2;
        uint256 l2;
    }

    function _layout() internal view virtual returns (Layout memory);

    struct TxFields {
        uint256 nonce;
        uint256 maxPriorityFee;
        uint256 maxFee;
        uint256 blobCount;
        uint256 nonceKeyCount;
        uint256 nonceKey0;
    }

    function _txFields() internal view virtual returns (TxFields memory);
    function _nonceAndMaxCost() internal view virtual returns (uint256 nonce, uint256 maxCost);
    function _sigEntry(uint256 index) internal view virtual returns (uint256 scheme, uint256 msgHash, uint256 signer);

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
        address reader = FRAME_READER;
        bool ok;
        assembly ("memory-safe") {
            let m := mload(0x40)
            mstore(m, op)
            mstore(add(m, 0x20), a)
            mstore(add(m, 0x40), b)
            mstore(add(m, 0x60), 0)
            ok := staticcall(gas(), reader, m, 0x80, 0, 0x20)
            ok := and(ok, eq(returndatasize(), 0x20))
            v := mload(0)
        }
        if (!ok) revert FrameReadFailed();
    }

    function _bytes(uint256 op, uint256 a, uint256 b, uint256 c) private view returns (bytes memory out) {
        address reader = FRAME_READER;
        bool ok;
        assembly ("memory-safe") {
            out := mload(0x40)
            mstore(out, op)
            mstore(add(out, 0x20), a)
            mstore(add(out, 0x40), b)
            mstore(add(out, 0x60), c)
            ok := staticcall(gas(), reader, out, 0x80, add(out, 0x20), b)
            ok := and(ok, eq(returndatasize(), b))
            mstore(out, b)
            mstore(0x40, add(add(out, 0x20), and(add(b, 0x1f), not(0x1f))))
        }
        if (!ok) revert FrameReadFailed();
    }

    function _layout() internal view override returns (Layout memory l) {
        address reader = FRAME_READER;
        bool ok;
        assembly ("memory-safe") {
            mstore(0x00, 6)
            ok := staticcall(gas(), reader, 0, 0x80, l, 0x320)
            ok := and(ok, or(eq(returndatasize(), 0x320), and(eq(returndatasize(), 0x20), iszero(eq(mload(l), 3)))))
        }
        if (!ok) revert FrameReadFailed();
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

    function _txFields() internal view override returns (TxFields memory f) {
        address reader = FRAME_READER;
        bool ok;
        assembly ("memory-safe") {
            mstore(0x00, 7)
            ok := staticcall(gas(), reader, 0, 0x80, f, 0xc0)
            ok := and(ok, eq(returndatasize(), 0xc0))
        }
        if (!ok) revert FrameReadFailed();
    }

    function _sigEntry(uint256 index) internal view override returns (uint256 scheme, uint256 msgHash, uint256 signer) {
        address reader = FRAME_READER;
        bool ok;
        assembly ("memory-safe") {
            let m := mload(0x40)
            mstore(m, 9)
            mstore(add(m, 0x20), index)
            mstore(add(m, 0x40), 0)
            mstore(add(m, 0x60), 0)
            ok := staticcall(gas(), reader, m, 0x80, m, 0x60)
            ok := and(ok, eq(returndatasize(), 0x60))
            scheme := mload(m)
            msgHash := mload(add(m, 0x20))
            signer := mload(add(m, 0x40))
        }
        if (!ok) revert FrameReadFailed();
    }

    function _nonceAndMaxCost() internal view override returns (uint256 nonce, uint256 maxCost) {
        address reader = FRAME_READER;
        bool ok;
        assembly ("memory-safe") {
            mstore(0x00, 8)
            ok := staticcall(gas(), reader, 0, 0x80, 0, 0x40)
            ok := and(ok, eq(returndatasize(), 0x40))
            nonce := mload(0)
            maxCost := mload(0x20)
        }
        if (!ok) revert FrameReadFailed();
    }

    function _approve(uint256 scope) internal override {
        assembly ("memory-safe") {
            log1(0, 0, scope)
        }
    }
}
