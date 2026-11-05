// Read-only access to the EIP-8141 introspection opcodes, reached by STATICCALL.
// Solidity cannot emit them, so the opcodes live here. Outside a frame transaction they halt, and so does the caller.
// calldata: op, a, b, c (four words)
object "FrameReader" {
    code {
        datacopy(0, dataoffset("runtime"), datasize("runtime"))
        return(0, datasize("runtime"))
    }
    object "runtime" {
        code {
            let a := calldataload(32)
            let b := calldataload(64)
            let c := calldataload(96)
            switch calldataload(0)
            case 0 { mstore(0, verbatim_1i_1o(hex"b0", a)) return(0, 32) }                  // TXPARAM(param)
            case 1 { mstore(0, verbatim_2i_1o(hex"b3", a, b)) return(0, 32) }               // FRAMEPARAM(frame, param)
            case 2 { mstore(0, verbatim_2i_1o(hex"b1", a, b)) return(0, 32) }               // FRAMEDATALOAD(offset, frame)
            case 3 { verbatim_4i_0o(hex"b2", 0, a, b, c) return(0, b) }                     // FRAMEDATACOPY(offset, length, frame)
            case 4 { mstore(0, verbatim_2i_1o(hex"b4", a, b)) return(0, 32) }               // SIGPARAM(sig, param)
            case 5 { verbatim_4i_0o(hex"b5", 0, a, b, c) return(0, b) }                     // SIGDATACOPY(offset, length, sig)
            case 6 {
                // Everything validation wants about the transaction, in one call: 3 frames or nothing.
                // txCount, current, sender, sigCount, then for frames 0-2: target, mode, flags, value, gas, stateGas, dataLen
                let count := verbatim_1i_1o(hex"b0", 0x09)
                if iszero(eq(count, 3)) { revert(0, 0) }
                mstore(0x00, count)
                mstore(0x20, verbatim_1i_1o(hex"b0", 0x0a))
                mstore(0x40, verbatim_1i_1o(hex"b0", 0x02))
                mstore(0x60, verbatim_1i_1o(hex"b0", 0x0b))
                for { let f := 0 } lt(f, 3) { f := add(f, 1) } {
                    let at := add(0x80, mul(f, 0xe0))
                    mstore(at, verbatim_2i_1o(hex"b3", f, 0x00))
                    mstore(add(at, 0x20), verbatim_2i_1o(hex"b3", f, 0x02))
                    mstore(add(at, 0x40), verbatim_2i_1o(hex"b3", f, 0x03))
                    mstore(add(at, 0x60), verbatim_2i_1o(hex"b3", f, 0x08))
                    mstore(add(at, 0x80), verbatim_2i_1o(hex"b3", f, 0x01))
                    mstore(add(at, 0xa0), verbatim_2i_1o(hex"b3", f, 0x09))
                    mstore(add(at, 0xc0), verbatim_2i_1o(hex"b3", f, 0x04))
                }
                return(0, 0x320)
            }
            case 7 {
                // nonce, maxPriorityFee, maxFee, blobCount, nonceKeyCount, nonceKey0
                mstore(0x00, verbatim_1i_1o(hex"b0", 0x01))
                mstore(0x20, verbatim_1i_1o(hex"b0", 0x03))
                mstore(0x40, verbatim_1i_1o(hex"b0", 0x04))
                mstore(0x60, verbatim_1i_1o(hex"b0", 0x07))
                mstore(0x80, verbatim_1i_1o(hex"b0", 0x0e))
                mstore(0xa0, verbatim_1i_1o(hex"b0", 0x10))
                return(0, 0xc0)
            }
            default { revert(0, 0) }
        }
    }
}
