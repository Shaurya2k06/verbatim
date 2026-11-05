// Registers the demo protocol's name on Sepolia ENSv2 and locks it down: the on-chain facts the exclusivity proof reads.
// Usage: tsx legb-ens.ts <label> [--no-lock]    --no-lock leaves root roles in place (the A8 lookalike)
import { encodeFunctionData, hexToBigInt, keccak256, namehash, parseEther, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ENS, FACTORY_ABI, REGISTRAR_ABI, REGISTRY_ABI, RESOLVER_ABI, ROLE, USDC_ABI, admin, dnsName, me, namedKey, pub, readS, tx, writeS } from "./lib/sepolia";

const label = process.argv[2];
const lock = !process.argv.includes("--no-lock");
if (!label) throw new Error("usage: legb-ens.ts <label> [--no-lock]");
const name = `${label}.eth`;
const dns = dnsName(name);
const councilKey = namedKey("ens-council");
const council = privateKeyToAccount(councilKey).address;
const YEAR = 365n * 24n * 3600n;
const DURATION = 2n * YEAR;
const st = () => readS()[label] ?? {};
const save = (p: Record<string, unknown>) => writeS({ [label]: { ...st(), ...p } });

if ((await pub.getBalance({ address: council })) < parseEther("0.01")) {
  const w = (await import("./lib/sepolia")).wallet();
  const hash = await w.sendTransaction({ to: council, value: parseEther("0.02"), account: w.account!, chain: w.chain });
  await pub.waitForTransactionReceipt({ hash });
  console.log("funded council", council);
}

if (!st().resolver) {
  const salt = hexToBigInt(keccak256(toHex(`verbatim:${label}:${Date.now()}`)));
  const all = ROLE.SET_TEXT | admin(ROLE.SET_TEXT) | ROLE.LINK | admin(ROLE.LINK) | ROLE.UPGRADE | admin(ROLE.UPGRADE) | ROLE.SET_ADDRESS | admin(ROLE.SET_ADDRESS);
  const init = encodeFunctionData({ abi: RESOLVER_ABI, functionName: "initialize", args: [[{ account: me, roles: all }], []] });
  const { result } = await pub.simulateContract({ account: me, address: ENS.factory, abi: FACTORY_ABI, functionName: "deployProxy", args: [ENS.resolverImpl, salt, init] });
  const r = await tx({ address: ENS.factory, abi: FACTORY_ABI, functionName: "deployProxy", args: [ENS.resolverImpl, salt, init] });
  console.log("resolver", result, r.transactionHash);
  save({ resolver: result, resolverTx: r.transactionHash });
}
const resolver = st().resolver as Address;

if (!st().registered) {
  const available = await pub.readContract({ address: ENS.registrar, abi: REGISTRAR_ABI, functionName: "isAvailable", args: [label] });
  if (!available) throw new Error(`${name} is taken; pick another label`);
  const [base, premium] = await pub.readContract({ address: ENS.registrar, abi: REGISTRAR_ABI, functionName: "getRegisterPrice", args: [label, DURATION, ENS.usdc] });
  const price = base + premium;
  console.log("price", price);
  await tx({ address: ENS.usdc, abi: USDC_ABI, functionName: "mint", args: [me, price * 2n] });
  await tx({ address: ENS.usdc, abi: USDC_ABI, functionName: "approve", args: [ENS.registrar, price * 2n] });
  const secret = keccak256(toHex(`secret:${label}:${Date.now()}`));
  const referrer = `0x${"00".repeat(32)}` as Hex;
  const ZERO = "0x0000000000000000000000000000000000000000" as Address;
  const commitment = await pub.readContract({ address: ENS.registrar, abi: REGISTRAR_ABI, functionName: "makeCommitment", args: [label, me, secret, ZERO, resolver, DURATION, referrer] });
  await tx({ address: ENS.registrar, abi: REGISTRAR_ABI, functionName: "commit", args: [commitment] });
  console.log("committed; waiting out MIN_COMMITMENT_AGE");
  await new Promise((r) => setTimeout(r, 75_000));
  const r = await tx({ address: ENS.registrar, abi: REGISTRAR_ABI, functionName: "register", args: [label, me, secret, ZERO, resolver, DURATION, ENS.usdc, referrer] });
  console.log("registered", name, r.transactionHash);
  save({ registered: r.transactionHash });
}

if (!st().records) {
  const setter = encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [dns, "clear-signing", ""] });
  const a = await tx({ address: resolver, abi: RESOLVER_ABI, functionName: "grantSetterRoles", args: [setter, council] });
  const addrBytes = (process.env.NAME_ADDRESS ?? addr3()) as Hex;
  const b = await tx({ address: resolver, abi: RESOLVER_ABI, functionName: "setAddress", args: [dns, 60n, addrBytes] });
  console.log("setter granted", a.transactionHash, "address record", b.transactionHash);
  save({ records: true, nameAddress: addrBytes, namehash: namehash(name) });
}

if (lock && !st().locked) {
  const forbidden = ROLE.SET_TEXT | admin(ROLE.SET_TEXT) | ROLE.LINK | admin(ROLE.LINK) | ROLE.UPGRADE | admin(ROLE.UPGRADE);
  const a = await tx({ address: resolver, abi: RESOLVER_ABI, functionName: "revokeRootRoles", args: [forbidden, me] });
  const labelhash = hexToBigInt(keccak256(toHex(label)));
  const reg = ROLE.REG_SET_RESOLVER | admin(ROLE.REG_SET_RESOLVER) | ROLE.REG_SET_SUBREGISTRY | admin(ROLE.REG_SET_SUBREGISTRY);
  const b = await tx({ address: ENS.ethRegistry, abi: REGISTRY_ABI, functionName: "revokeRoles", args: [labelhash, reg, me] });
  console.log("locked", a.transactionHash, b.transactionHash);
  save({ locked: { resolver: a.transactionHash, registry: b.transactionHash } });
}

const labelhash = hexToBigInt(keccak256(toHex(label)));
const state = await pub.readContract({ address: ENS.ethRegistry, abi: REGISTRY_ABI, functionName: "getState", args: [labelhash] });
const rootCount = await pub.readContract({ address: resolver, abi: RESOLVER_ABI, functionName: "roleCount", args: [0n] });
const keyCount = await pub.readContract({ address: resolver, abi: RESOLVER_ABI, functionName: "roleCount", args: [hexToBigInt(keccak256(toHex("clear-signing")))] });
const nameCount = await pub.readContract({ address: ENS.ethRegistry, abi: REGISTRY_ABI, functionName: "roleCount", args: [state.resource] });
const ethRootCount = await pub.readContract({ address: ENS.ethRegistry, abi: REGISTRY_ABI, functionName: "roleCount", args: [0n] });
const rootRootCount = await pub.readContract({ address: ENS.root, abi: REGISTRY_ABI, functionName: "roleCount", args: [0n] });
console.log(JSON.stringify({ name, resolver, resolverCodehash: keccak256((await pub.getCode({ address: resolver })) as Hex), expiry: Number(state.expiry), owner: state.latestOwner, rootCount: `0x${rootCount.toString(16)}`, keyCount: `0x${keyCount.toString(16)}`, nameCount: `0x${nameCount.toString(16)}`, ethRootCount: `0x${ethRootCount.toString(16)}`, rootRootCount: `0x${rootRootCount.toString(16)}` }, null, 1));

function addr3() {
  return privateKeyToAccount(namedKey("ens-recipient")).address;
}
