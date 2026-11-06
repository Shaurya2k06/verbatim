# `make proofs` regenerates docs/proofs.json from a clean Leg A deployment on the public devnet. Needs .env (see .env.example).
.PHONY: install test fuzz slither vectors proofs proofs-legb report addresses bytecode

install:
	pnpm install --frozen-lockfile

test: install
	cd contracts && forge test
	pnpm -r --if-present test

fuzz:
	cd tools/difffuzz && pnpm exec tsx src/fuzz.ts 10000

vectors:
	cd tools/difffuzz && pnpm exec tsx src/vectors.ts

bytecode:
	cd contracts && forge build
	cd tools/scripts && npx tsx check-bytecode.ts

slither:
	rm -rf /tmp/verbatim-slither && mkdir -p /tmp/verbatim-slither && cp -R contracts /tmp/verbatim-slither/contracts
	cd /tmp/verbatim-slither/contracts && rm -rf out cache test script && find src -name '*.yul' -delete && pipx run --spec slither-analyzer slither . --filter-paths "lib/forge-std|probe/" --exclude-informational

proofs: install
	cd tools/scripts && ./run-all-devnet.sh

proofs-legb: install
	cd tools/scripts && npx tsx legb-deploy.ts && npx tsx legb-run.ts
	$(MAKE) report

report: addresses
	cd tools/gas-report && pnpm report

addresses:
	cd tools/scripts && npx tsx addresses.ts
