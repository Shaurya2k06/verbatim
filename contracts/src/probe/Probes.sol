// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DevnetFrames} from "../lib/FrameIntrospection.sol";

interface IStakingRegistry {
    function addStake(uint32 unstakeDelaySec) external payable;
}

/// F1 probe: reads other frames from VERIFY and SENDER frames.
contract ProbeAccount is DevnetFrames {
    event Probe(uint256 indexed tag, address indexed caller, uint256 frameCount, uint256 currentFrame, uint256 sigHash, uint256 frame0word, uint256 frame2len, uint256 sigLen, uint256 sigFirstWord, uint256 frame1mode);

    constructor(address reader) payable DevnetFrames(reader) {}

    receive() external payable {}

    function verifyFrame(uint256 expectedFrameCount, uint256 expectedSigWord) external {
        require(_txparam(TX_FRAME_COUNT) == expectedFrameCount, "frame count");
        require(_frameparam(1, FP_MODE) == MODE_VERIFY, "frame1 mode");
        require(_frameparam(2, FP_MODE) == MODE_SENDER, "frame2 mode");
        require(_frameparam(2, FP_DATA_LENGTH) > 0, "frame2 data");
        require(_framedataload(4, 0) == expectedFrameCount, "frame0 read");
        require(_sigparam(0, SP_SCHEME) == SCHEME_ARBITRARY, "scheme");
        require(uint256(bytes32(_sigdatacopy(0, 32, 0))) == expectedSigWord, "sigdata");
        _approve(SCOPE_EXECUTION);
    }

    function report(uint256 tag) external {
        require(msg.sender == address(this), "F1b: SENDER caller is not sender");
        emit Probe(tag, msg.sender, _txparam(TX_FRAME_COUNT), _txparam(TX_CURRENT_FRAME), _txparam(TX_SIG_HASH), _framedataload(4, 0), _frameparam(2, FP_DATA_LENGTH), _sigparam(0, SP_LENGTH), uint256(bytes32(_sigdatacopy(0, 32, 0))), _frameparam(1, FP_MODE));
    }
}

/// F2 probe: staked paymaster that burns gas, reads its own storage and the sender's EXTCODEHASH.
contract ProbePaymaster is DevnetFrames {
    mapping(uint256 => uint256) public slots;
    address public immutable OWNER;

    constructor(address reader) payable DevnetFrames(reader) {
        OWNER = msg.sender;
    }

    receive() external payable {}

    function stake(address registry, uint32 delay) external payable {
        IStakingRegistry(registry).addStake{value: msg.value}(delay);
    }

    /// Burns `rounds` keccaks over own storage, then pays.
    function pay(uint256 rounds) external {
        address sender = address(uint160(_txparam(TX_SENDER)));
        require(sender.codehash != bytes32(0), "codehash");
        uint256 acc = slots[0];
        for (uint256 i; i < rounds; i++) {
            acc = uint256(keccak256(abi.encode(acc, i)));
        }
        require(acc != 1, "unreachable");
        _approve(SCOPE_PAYMENT);
    }
}

/// G0 probes: explicit-msg entries read in a SIGPARAM loop, EXTCODEHASH of a contract that is no entity, and both
/// prefixes with a leading expiry frame.
contract ProbeG0Account is DevnetFrames {
    event Ping(uint256 indexed frameCount);

    constructor(address reader) payable DevnetFrames(reader) {}

    receive() external payable {}

    /// `nA` entries must carry msgA, the rest msgB. Each must be SECP256K1 with a resolved signer.
    function verifyFrame(bytes32 msgA, bytes32 msgB, uint256 nA, uint256 total, address other, bytes32 otherHash, uint256 scope) external {
        require(_txparam(TX_SIG_COUNT) == total, "sig count");
        for (uint256 i = 0; i < total; i++) {
            require(_sigparam(i, SP_SCHEME) == SCHEME_SECP256K1, "scheme");
            require(bytes32(_sigparam(i, SP_MSG)) == (i < nA ? msgA : msgB), "msg");
            require(_sigparam(i, SP_SIGNER) != 0, "signer");
        }
        if (other != address(0)) require(other.codehash == otherHash, "codehash");
        _approve(scope);
    }

    function ping() external {
        require(msg.sender == address(this), "caller");
        emit Ping(_txparam(TX_FRAME_COUNT));
    }
}
