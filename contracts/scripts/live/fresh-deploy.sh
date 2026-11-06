#!/bin/sh
# Redeploys everything from a clean slate: contracts, attestation, pools.
set -e
cd "$(dirname "$0")"
(cd ../.. && forge build >/dev/null)
python3 - <<'P'
import json,os
p='../../.state/devnet.json'
d=json.load(open(p)) if os.path.exists(p) else {}
json.dump({k:d[k] for k in d if k.startswith('probe') or k.startswith('old')},open(p,'w'),indent=2)
P
npx tsx deploy-devnet.ts | grep -E "RendererPaymaster |refreshTrust|faucet"
npx tsx seed-uniswap.ts | grep -E "pools ready"
npx tsx export-deployment.ts
