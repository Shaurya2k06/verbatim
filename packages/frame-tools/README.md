# frame-tools

Use [EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)'s opcodes from Solidity before compilers support them. MIT.

- **[`yul/FrameReader.yul`](yul/FrameReader.yul)** serves TXPARAM, FRAMEPARAM, FRAMEDATALOAD, FRAMEDATACOPY and SIGPARAM over STATICCALL, with batched reads that keep validation cheap. Compile it with `solc --strict-assembly`, deploy once, share it. Outside a frame transaction the opcodes halt, so the call fails.
- **`patchApprove`** gets APPROVE into a contract's own code with no DELEGATECALL. Write `log1(0, 0, scope)` where you want it, which has APPROVE's stack shape. The tool flips that one byte from LOG1 to APPROVE in the creation code.

```sh
npx tsx src/cli.ts out/MyAccount.sol/MyAccount.json
```

It fails closed. The runtime must hold exactly one LOG1, walking opcodes so PUSH data is never mistaken for one, and the runtime must appear once in the creation code. So a patched contract can't emit any other one-topic log. Record the printed hash, and compare it to the deployed code.

The mempool budget matters: these reads add up against a prefix cap. Verbatim's `contracts/docs/ALTMEMPOOL.md` has the measurements.
