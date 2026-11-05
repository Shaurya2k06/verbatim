// Sets the demo recipient's primary name, so its cached name can be checked in both directions.
import { getAddress, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ENS, namedKey, pub, tx, wallet } from "./lib/sepolia";

const key = namedKey("ens-recipient");
const who = privateKeyToAccount(key).address;
const NAME = process.argv[2] ?? "verbatim-demo.eth";
const ADAPTER = "0x56bce5e727faa9d237341bb5b9e8a03d5919779d" as const;
const rr = await pub.readContract({ address: ADAPTER, abi: parseAbi(["function REVERSE_REGISTRAR() view returns (address)"]), functionName: "REVERSE_REGISTRAR" });
console.log("recipient", who, "reverse registrar", rr);
if ((await pub.getBalance({ address: who })) < parseEther("0.005")) {
  const w = wallet();
  const hash = await w.sendTransaction({ to: who, value: parseEther("0.01"), account: w.account!, chain: w.chain });
  await pub.waitForTransactionReceipt({ hash });
}
const r = await tx({ address: rr, abi: parseAbi(["function setName(string name) returns (bytes32)"]), functionName: "setName", args: [NAME] }, key);
console.log("setName", r.transactionHash);
const UR = parseAbi(["function reverse(bytes lookupAddress, uint256 coinType) view returns (string, address, address)"]);
const out = await pub.readContract({ address: ENS.universalResolver, abi: UR, functionName: "reverse", args: [who, 60n] }).catch((e) => String(e.message).slice(0, 300));
console.log("universal resolver reverse:", out);
void getAddress;
