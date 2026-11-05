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
            default { revert(0, 0) }
        }
    }
}
