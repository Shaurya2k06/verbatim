// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FrameIntrospection} from "../src/lib/FrameIntrospection.sol";

/// One frame transaction's worth of introspection, set by the test. Stands in for the protocol.
contract FrameEnv {
    struct Frame {
        uint8 mode;
        uint8 flags;
        address target;
        uint256 gasLimit;
        uint256 stateGas;
        uint256 value;
        bytes data;
    }

    struct Sig {
        uint8 scheme;
        address signer;
        bytes32 msgHash;
    }

    Frame[] public frames;
    Sig[] public sigs;
    uint256 public current;
    address public sender;
    uint256 public nonce;
    uint256 public maxPriorityFee;
    uint256 public maxFee;
    uint256 public blobCount;
    uint256 public nonceKeyCount = 1;
    uint256 public nonceKey0;
    uint256 public lastApproved;

    function reset() external {
        delete frames;
        delete sigs;
        current = 0;
        lastApproved = 0;
    }

    function pushFrame(Frame calldata f) external {
        frames.push(f);
    }

    function pushSig(Sig calldata s) external {
        sigs.push(s);
    }

    function setCurrent(uint256 c) external {
        current = c;
    }

    function setTx(address s, uint256 n, uint256 p, uint256 m) external {
        sender = s;
        nonce = n;
        maxPriorityFee = p;
        maxFee = m;
    }

    function setBlobs(uint256 b) external {
        blobCount = b;
    }

    function setKeys(uint256 count, uint256 key0) external {
        nonceKeyCount = count;
        nonceKey0 = key0;
    }

    function setFrameValue(uint256 i, uint256 v) external {
        frames[i].value = v;
    }

    function setFrameFlags(uint256 i, uint8 v) external {
        frames[i].flags = v;
    }

    function setFrameTarget(uint256 i, address v) external {
        frames[i].target = v;
    }

    function setFrameData(uint256 i, bytes calldata d) external {
        frames[i].data = d;
    }

    function setFrameMode(uint256 i, uint8 v) external {
        frames[i].mode = v;
    }

    function popFrame() external {
        frames.pop();
    }

    function frameCount() external view returns (uint256) {
        return frames.length;
    }

    function sigCount() external view returns (uint256) {
        return sigs.length;
    }

    function frame(uint256 i) external view returns (Frame memory) {
        return frames[i];
    }

    function sig(uint256 i) external view returns (Sig memory) {
        return sigs[i];
    }

    function noteApprove(uint256 scope) external {
        lastApproved = scope;
    }
}

abstract contract MockFrames is FrameIntrospection {
    FrameEnv public immutable ENV;

    constructor(FrameEnv env) {
        ENV = env;
    }

    function _txparam(uint256 p) internal view override returns (uint256) {
        if (p == TX_SENDER) return uint160(ENV.sender());
        if (p == TX_FRAME_COUNT) return ENV.frameCount();
        if (p == TX_CURRENT_FRAME) return ENV.current();
        if (p == TX_SIG_COUNT) return ENV.sigCount();
        revert("mock: txparam");
    }

    function _frameparam(uint256 i, uint256 p) internal view override returns (uint256) {
        FrameEnv.Frame memory f = ENV.frame(i);
        if (p == FP_TARGET) return uint160(f.target);
        if (p == FP_MODE) return f.mode;
        if (p == FP_FLAGS) return f.flags;
        if (p == FP_GAS) return f.gasLimit;
        if (p == FP_STATE_GAS) return f.stateGas;
        if (p == FP_VALUE) return f.value;
        if (p == FP_DATA_LENGTH) return f.data.length;
        revert("mock: frameparam");
    }

    function _framedataload(uint256 offset, uint256 i) internal view override returns (uint256 v) {
        bytes memory d = ENV.frame(i).data;
        assembly ("memory-safe") {
            if lt(offset, mload(d)) { v := mload(add(add(d, 0x20), offset)) }
        }
    }

    function _framedatacopy(uint256 offset, uint256 length, uint256 i) internal view override returns (bytes memory out) {
        bytes memory d = ENV.frame(i).data;
        out = new bytes(length);
        for (uint256 k = 0; k < length && offset + k < d.length; k++) out[k] = d[offset + k];
    }

    function _sigparam(uint256 i, uint256 p) internal view override returns (uint256) {
        FrameEnv.Sig memory s = ENV.sig(i);
        if (p == SP_SIGNER) return uint160(s.signer);
        if (p == SP_SCHEME) return s.scheme;
        if (p == SP_MSG) return uint256(s.msgHash);
        revert("mock: sigparam");
    }

    function _sigdatacopy(uint256, uint256, uint256) internal pure override returns (bytes memory) {
        revert("mock: sigdata unused");
    }

    function _layout() internal view override returns (Layout memory l) {
        // The real reader halts unless there are exactly 3 frames.
        if (ENV.frameCount() != 3) revert("mock: not 3 frames");
        l.frameCount = 3;
        l.current = ENV.current();
        l.sender = uint160(ENV.sender());
        l.sigCount = ENV.sigCount();
        FrameEnv.Frame memory f = ENV.frame(0);
        (l.t0, l.m0, l.f0, l.v0, l.g0, l.s0, l.l0) = (uint160(f.target), f.mode, f.flags, f.value, f.gasLimit, f.stateGas, f.data.length);
        f = ENV.frame(1);
        (l.t1, l.m1, l.f1, l.v1, l.g1, l.s1, l.l1) = (uint160(f.target), f.mode, f.flags, f.value, f.gasLimit, f.stateGas, f.data.length);
        f = ENV.frame(2);
        (l.t2, l.m2, l.f2, l.v2, l.g2, l.s2, l.l2) = (uint160(f.target), f.mode, f.flags, f.value, f.gasLimit, f.stateGas, f.data.length);
    }

    function _txFields() internal view override returns (TxFields memory t) {
        t = TxFields(ENV.nonce(), ENV.maxPriorityFee(), ENV.maxFee(), ENV.blobCount(), ENV.nonceKeyCount(), ENV.nonceKey0());
    }

    /// APPROVE ends the frame.
    function _approve(uint256 scope) internal override {
        ENV.noteApprove(scope);
        assembly ("memory-safe") {
            return(0, 0)
        }
    }
}
