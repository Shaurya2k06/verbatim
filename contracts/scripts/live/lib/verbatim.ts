import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ChainTrust, PAYMASTER_ABI, PUBLIC_GATEWAY_GAS, prepare, withSignatures, type Call, type PrepareArgs, type Prepared } from "@verbatim/client";
import { key, readState } from "./env";
import { pub, send } from "./chain";

export const ERC20 = parseAbi(["function transfer(address,uint256)", "function approve(address,uint256)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function mint(address,uint256)"]);
export const ZERO: Address = "0x0000000000000000000000000000000000000000";

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

export const TICKET = 1_000_000_000_000n;

/** Tickets are per nonce. Keeps the next few funded; anyone may pay them. */
export async function ensureTickets(account: Address, paymaster: Address, count = 40n) {
  const nonce = BigInt(await pub.getTransactionCount({ address: account }));
  const [amount] = await pub.readContract({ address: paymaster, abi: PAYMASTER_ABI, functionName: "feeTicket", args: [account, nonce] });
  if (amount >= TICKET) return;
  await send(key("DEPLOYER_KEY"), paymaster, encodeFunctionData({ abi: PAYMASTER_ABI, functionName: "fundTickets", args: [account, nonce, count] }), TICKET * count, 15_000_000n);
}

export async function prepareTx(calls: Call[], opts: Partial<PrepareArgs> = {}) {
  const s = state();
  const account = opts.account ?? s.account;
  if (!opts.skipTickets) await ensureTickets(account, opts.paymaster ?? s.paymaster);
  return prepare({ client: pub as never, trust: opts.trust ?? trust(), account, paymaster: opts.paymaster ?? s.paymaster, calls, ...opts, gas: opts.gas ?? PUBLIC_GATEWAY_GAS });
}

export const transferCall = (token: Address, to: Address, amount: bigint): Call => ({ target: token, value: 0n, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, amount] }) });
