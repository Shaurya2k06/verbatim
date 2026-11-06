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

    uint256 internal constant SCOPE_BOTH = 3;
    uint256 internal constant MODE_VERIFY = 1;
    uint256 internal constant MODE_SENDER = 2;
    uint256 internal constant SCOPE_PAYMENT = 1;
    uint256 internal constant SCOPE_EXECUTION = 2;
    uint256 internal constant PATH_STATELESS = 1;
    uint256 internal constant PATH_PAYMASTER = 2;
    uint256 internal constant SCHEME_ARBITRARY = 0;
    uint256 internal constant SCHEME_SECP256K1 = 1;

    function _txparam(uint256 param) internal view virtual returns (uint256);
    function _frameparam(uint256 frameIndex, uint256 param) internal view virtual returns (uint256);
    function _framedataload(uint256 offset, uint256 frameIndex) internal view virtual returns (uint256);
    function _framedatacopy(uint256 offset, uint256 length, uint256 frameIndex) internal view virtual returns (bytes memory);
    function _sigparam(uint256 sigIndex, uint256 param) internal view virtual returns (uint256);
    function _sigdatacopy(uint256 offset, uint256 length, uint256 sigIndex) internal view virtual returns (bytes memory);
    /// The whole transaction in one read: see FrameReader.yul. With 3 frames, the two words after the frames (signature and
    /// blob count, which txCommit also hashes) sit where `m3` and `f3` would. With an unsupported count, the commit region
    /// is empty and `frameCount` reads as that count.
    struct Layout {
        uint256 current;
        uint256 maxCost;
        uint256 reserved;
        uint256 sigCount;
        uint256 blobCount;
        bytes32 txCommit;
        uint256 expiryWord;
        uint256 policyClaim;
        uint256 chainId;
        uint256 sender;
        uint256 nonce;
        uint256 maxPriorityFee;
        uint256 maxFee;
        uint256 frameCount;
        uint256 m0;
        uint256 f0;
        uint256 t0;
        uint256 v0;
        uint256 g0;
        uint256 s0;
        uint256 l0;
        uint256 m1;
        uint256 f1;
        uint256 t1;
        uint256 v1;
        uint256 g1;
        uint256 s1;
        uint256 l1;
        uint256 m2;
        uint256 f2;
        uint256 t2;
        uint256 v2;
        uint256 g2;
        uint256 s2;
        uint256 l2;
        uint256 m3;
        uint256 f3;
        uint256 t3;
        uint256 v3;
        uint256 g3;
        uint256 s3;
        uint256 l3;
        uint256 sig4;
        uint256 blob4;
        uint256 sig0Scheme;
        uint256 sig0Msg;
        uint256 sig0Signer;
        uint256 sig1Scheme;
        uint256 sig1Msg;
        uint256 sig1Signer;
        uint256 sig2Scheme;
        uint256 sig2Msg;
        uint256 sig2Signer;
        uint256 sig3Scheme;
        uint256 sig3Msg;
        uint256 sig3Signer;
        uint256 sig4Scheme;
        uint256 sig4Msg;
        uint256 sig4Signer;
        uint256 sig5Scheme;
        uint256 sig5Msg;
        uint256 sig5Signer;
    }

    uint256 internal constant MAX_SIGNATURES = 6;

    function _layout() internal view virtual returns (Layout memory);

    /// Signature entry `i`, i < MAX_SIGNATURES, from the layout's own words.
    function _sigAt(Layout memory l, uint256 i) internal pure returns (uint256 scheme, uint256 msgHash, uint256 signer) {
        assembly ("memory-safe") {
            let p := add(add(l, 0x580), mul(i, 0x60))
            scheme := mload(p)
            msgHash := mload(add(p, 0x20))
            signer := mload(add(p, 0x40))
        }
    }

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
            ok := staticcall(gas(), reader, 0, 0x80, l, 0x7c0)
            ok := and(ok, eq(returndatasize(), 0x7c0))
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

    function _approve(uint256 scope) internal override {
        assembly ("memory-safe") {
            log1(0, 0, scope)
        }
    }
}
