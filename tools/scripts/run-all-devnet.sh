#!/bin/sh
# Everything on Leg A, from a clean deployment. `make proofs` runs this.
set -x
cd "$(dirname "$0")"
./fresh-deploy.sh
npx tsx measure.ts
npx tsx stateless.ts measure
npx tsx attacks.ts
npx tsx invalidation.ts
npx tsx swap.ts
npx tsx stateless.ts
(cd ../gas-report && pnpm report)
npx tsx addresses.ts
(cd ../e2e && pnpm record)
