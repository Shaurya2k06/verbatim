#!/bin/sh
# Everything on Leg A, from a clean deployment. `make -C contracts proofs` runs this.
set -x
cd "$(dirname "$0")"
# A failed deployment stops here: otherwise every proof below is overwritten with "not run".
./fresh-deploy.sh || exit 1
npx tsx probe-g0.ts
npx tsx measure.ts
npx tsx stateless.ts measure
npx tsx attacks.ts
npx tsx invalidation.ts
npx tsx swap.ts
npx tsx stateless.ts
(cd ../gas-report && pnpm report)
npx tsx addresses.ts
(cd ../e2e && pnpm record)
