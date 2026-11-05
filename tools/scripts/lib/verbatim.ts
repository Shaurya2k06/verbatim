import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ChainTrust, prepare, withSignatures, type Call, type PrepareArgs, type Prepared } from "@verbatim/client";
import { key, readState } from "./env";
import { pub } from "./chain";

export const ERC20 = parseAbi(["function transfer(address,uint256)", "function approve(address,uint256)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function mint(address,uint256)"]);
export const ZERO: Address = "0x0000000000000000000000000000000000000000";
export const FEE_RATE = 1100n;

export const state = () => readState();
export const trust = () => new ChainTrust(pub as never, state().paymaster);

export const OWNER_KEYS = ["OWNER1_KEY", "OWNER2_KEY"];

/** Signs the EIP-712 digest with the demo's two owners and fills the signature entry. */
export async function sign(p: Prepared, ownerKeys: string[] = OWNER_KEYS) {
  const sigs = await Promise.all(
    ownerKeys.map(async (k) => {
      const a = privateKeyToAccount(key(k));
      return { signer: a.address, sig: (await a.signTypedData(p.digestTypedData as never)) as Hex };
    }),
  );
  return withSignatures(p.tx, p.digest, sigs);
}

export async function prepareTx(calls: Call[], opts: Partial<PrepareArgs> = {}) {
  const s = state();
  // A pending transaction at the current nonce must clear first; the mempool will not replace it at the same fee.
  const gas = opts.gas ?? (await import("@verbatim/client")).PUBLIC_GATEWAY_GAS;
  const total = gas.frame0 + gas.frame1 + gas.frame2 + gas.frame2State;
  return prepare({ client: pub as never, trust: trust(), account: s.account, paymaster: s.paymaster, calls, fee: { asset: ZERO, amount: total * FEE_RATE }, ...opts, gas });
}

export const transferCall = (token: Address, to: Address, amount: bigint): Call => ({ target: token, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, amount] }) });
