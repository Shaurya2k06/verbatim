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
    uint256 public maxCost = 1;

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

    function setSig(uint256 i, Sig calldata s) external {
        sigs[i] = s;
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

    function setMaxCost(uint256 c) external {
        maxCost = c;
    }

    function setFrameGas(uint256 i, uint256 g) external {
        frames[i].gasLimit = g;
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
        // Like the real reader: with an unsupported frame count, only that count.
        l.frameCount = ENV.frameCount();
        if (l.frameCount < 3 || l.frameCount > 4) return l;
        l.current = ENV.current();
        l.maxCost = ENV.maxCost();
        l.sigCount = ENV.sigCount();
        l.blobCount = ENV.blobCount();
        l.chainId = block.chainid;
        l.sender = uint160(ENV.sender());
        l.nonce = ENV.nonce();
        l.maxPriorityFee = ENV.maxPriorityFee();
        l.maxFee = ENV.maxFee();
        FrameEnv.Frame memory f = ENV.frame(0);
        (l.m0, l.f0, l.t0, l.v0, l.g0, l.s0, l.l0) = (f.mode, f.flags, uint160(f.target), f.value, f.gasLimit, f.stateGas, f.data.length);
        uint256 w;
        bytes memory fd = f.data;
        assembly ("memory-safe") {
            w := mload(add(fd, 0x20))
        }
        // FRAMEDATALOAD pads with zeros past the end.
        l.expiryWord = fd.length >= 32 ? w : (w >> ((32 - fd.length) * 8)) << ((32 - fd.length) * 8);
        f = ENV.frame(1);
        (l.m1, l.f1, l.t1, l.v1, l.g1, l.s1, l.l1) = (f.mode, f.flags, uint160(f.target), f.value, f.gasLimit, f.stateGas, f.data.length);
        if (ENV.current() > 0 && f.data.length >= 164) {
            fd = f.data;
            assembly ("memory-safe") {
                w := mload(add(fd, 164))
            }
            l.policyClaim = w;
        }
        f = ENV.frame(2);
        (l.m2, l.f2, l.t2, l.v2, l.g2, l.s2, l.l2) = (f.mode, f.flags, uint160(f.target), f.value, f.gasLimit, f.stateGas, f.data.length);
        if (l.frameCount == 4) {
            f = ENV.frame(3);
            (l.m3, l.f3, l.t3, l.v3, l.g3, l.s3, l.l3) = (f.mode, f.flags, uint160(f.target), f.value, f.gasLimit, f.stateGas, f.data.length);
            (l.sig4, l.blob4) = (l.sigCount, l.blobCount);
        } else {
            (l.m3, l.f3) = (l.sigCount, l.blobCount);
        }
        l.txCommit = _commit();
        uint256 n = ENV.sigCount();
        if (n > 6) n = 6;
        for (uint256 i = 0; i < n; i++) {
            FrameEnv.Sig memory s = ENV.sig(i);
            uint256 scheme = s.scheme;
            bytes32 m = s.msgHash;
            address who = s.scheme == 0 ? address(0) : s.signer;
            assembly ("memory-safe") {
                let p := add(add(l, 0x580), mul(i, 0x60))
                mstore(p, scheme)
                mstore(add(p, 0x20), m)
                mstore(add(p, 0x40), who)
            }
        }
    }

    function _commit() private view returns (bytes32) {
        uint256 n = ENV.frameCount();
        bytes memory b = abi.encode(block.chainid, ENV.sender(), ENV.nonce(), ENV.maxPriorityFee(), ENV.maxFee(), n);
        for (uint256 i = 0; i < n; i++) {
            FrameEnv.Frame memory f = ENV.frame(i);
            b = bytes.concat(b, abi.encode(f.mode, f.flags, f.target, f.value, f.gasLimit, f.stateGas, i == 1 ? bytes32(0) : keccak256(f.data)));
        }
        return keccak256(bytes.concat(b, abi.encode(ENV.sigCount(), ENV.blobCount())));
    }

    /// APPROVE ends the frame.
    function _approve(uint256 scope) internal override {
        ENV.noteApprove(scope);
        assembly ("memory-safe") {
            return(0, 0)
        }
    }
}
