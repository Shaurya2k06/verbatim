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
                // Everything validation wants, in one call, so it costs one STATICCALL. 62 words:
                //   0 current, 1 maxCost, 2 unused, 3 sigCount, 4 blobCount, 5 txCommit, 6 frame 0 word 0,
                //   7 frame 1 word at offset 132 (the policy word).
                //   8.. chainId, sender, nonce, maxPriorityFee, maxFee, frameCount, then 7 per frame up to 4 frames (mode,
                //       flags, target, value, gas, state gas, data length).
                //   then 2 words for what follows the frames in txCommit (only meaningful with 4 frames, and with 3 they
                //       sit where frame 3's mode and flags would), 18 words: scheme, msg, signer of the first 6 entries.
                let count := verbatim_1i_1o(hex"b0", 0x09)
                mstore(0x1a0, count)
                if or(lt(count, 3), gt(count, 4)) { return(0, 0x7c0) }
                let current := verbatim_1i_1o(hex"b0", 0x0a)
                mstore(0x00, current)
                mstore(0x20, verbatim_1i_1o(hex"b0", 0x06))
                let sigs := verbatim_1i_1o(hex"b0", 0x0b)
                let blobs := verbatim_1i_1o(hex"b0", 0x07)
                mstore(0x60, sigs)
                mstore(0x80, blobs)
                mstore(0xc0, verbatim_2i_1o(hex"b1", 0, 0))
                if current { mstore(0xe0, verbatim_2i_1o(hex"b1", 132, 1)) }
                mstore(0x100, chainid())
                mstore(0x120, verbatim_1i_1o(hex"b0", 0x02))
                mstore(0x140, verbatim_1i_1o(hex"b0", 0x01))
                mstore(0x160, verbatim_1i_1o(hex"b0", 0x03))
                mstore(0x180, verbatim_1i_1o(hex"b0", 0x04))
                mstore(0x1a0, count)
                let at := 0x1c0
                for { let f := 0 } lt(f, count) { f := add(f, 1) } {
                    let len := verbatim_2i_1o(hex"b3", f, 0x04)
                    mstore(at, verbatim_2i_1o(hex"b3", f, 0x02))
                    mstore(add(at, 0x20), verbatim_2i_1o(hex"b3", f, 0x03))
                    mstore(add(at, 0x40), verbatim_2i_1o(hex"b3", f, 0x00))
                    mstore(add(at, 0x60), verbatim_2i_1o(hex"b3", f, 0x08))
                    mstore(add(at, 0x80), verbatim_2i_1o(hex"b3", f, 0x01))
                    mstore(add(at, 0xa0), verbatim_2i_1o(hex"b3", f, 0x09))
                    // The length for now; the data's hash once it is known. Frame 1 stays blank in the commit.
                    mstore(add(at, 0xc0), 0)
                    if iszero(eq(f, 1)) {
                        verbatim_4i_0o(hex"b2", 0x840, 0, len, f)
                        mstore(add(at, 0xc0), keccak256(0x840, len))
                    }
                    mstore(add(0x7c0, mul(f, 0x20)), len)
                    at := add(at, 0xe0)
                }
                mstore(at, sigs)
                mstore(add(at, 0x20), blobs)
                mstore(0xa0, keccak256(0x100, sub(add(at, 0x40), 0x100)))
                // Restore the lengths, which the frames need.
                at := 0x1c0
                for { let f := 0 } lt(f, count) { f := add(f, 1) } {
                    mstore(add(at, 0xc0), mload(add(0x7c0, mul(f, 0x20))))
                    at := add(at, 0xe0)
                }
                let n := sigs
                if gt(n, 6) { n := 6 }
                for { let i := 0 } lt(i, n) { i := add(i, 1) } {
                    let w := add(0x580, mul(i, 0x60))
                    let scheme := verbatim_2i_1o(hex"b4", i, 0x01)
                    mstore(w, scheme)
                    mstore(add(w, 0x20), verbatim_2i_1o(hex"b4", i, 0x02))
                    if scheme { mstore(add(w, 0x40), verbatim_2i_1o(hex"b4", i, 0x00)) }
                }
                return(0, 0x7c0)
            }
            default { revert(0, 0) }
        }
    }
}
