#!/bin/sh
# Redeploys everything from a clean slate: contracts, attestation, pools.
set -e
cd "$(dirname "$0")"
(cd ../.. && forge build >/dev/null 2>&1)
python3 - <<'P'
import json,os
p='../../.state/devnet.json'
d=json.load(open(p)) if os.path.exists(p) else {}
json.dump({k:d[k] for k in d if k.startswith('probe') or k.startswith('old')},open(p,'w'),indent=2)
P
# Through a file, not a pipe: sh has no pipefail, and a crash behind grep would pass as success.
log=$(mktemp)
npx tsx deploy-devnet.ts >"$log" 2>&1 || { cat "$log"; exit 1; }
grep -E "RendererPaymaster |refreshTrust|faucet" "$log"
npx tsx seed-uniswap.ts >"$log" 2>&1 || { cat "$log"; exit 1; }
grep -E "pools ready" "$log"
rm -f "$log"
npx tsx export-deployment.ts
