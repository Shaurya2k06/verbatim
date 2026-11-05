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
