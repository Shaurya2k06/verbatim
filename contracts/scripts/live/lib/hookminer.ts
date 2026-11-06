import { concat, encodeAbiParameters, getCreate2Address, keccak256, padHex, toHex, type Address, type Hex } from "viem";

export const CREATE2_DEPLOYER: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const ALL_HOOK_MASK = (1n << 14n) - 1n;

/** Finds a salt that lands the contract on an address whose low 14 bits are exactly `flags` (v4-core Hooks.sol). */
export function mineSalt(flags: bigint, creationCode: Hex, ctorTypes: { type: string }[], ctorArgs: unknown[]): { salt: Hex; address: Address; initCode: Hex } {
  const initCode = concat([creationCode, encodeAbiParameters(ctorTypes as never, ctorArgs as never)]);
  const bytecodeHash = keccak256(initCode);
  for (let i = 0n; i < 2_000_000n; i++) {
    const salt = padHex(toHex(i), { size: 32 });
    const address = getCreate2Address({ from: CREATE2_DEPLOYER, salt, bytecodeHash });
    if ((BigInt(address) & ALL_HOOK_MASK) === flags) return { salt, address, initCode };
  }
  throw new Error("no salt found");
}
