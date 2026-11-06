# `make -C contracts proofs` regenerates docs/proofs.json from a clean Leg A deployment on the public devnet. Run from contracts/, or `make -C contracts <target>`. Needs the root .env (see .env.example).
.PHONY: install test fuzz slither vectors proofs proofs-legb report addresses bytecode demo-live demo-dry

install:
	pnpm install --frozen-lockfile

test: install
	forge test
	cd .. && pnpm -r --if-present test

fuzz:
	cd scripts/difffuzz && pnpm exec tsx src/fuzz.ts 10000

vectors:
	cd scripts/difffuzz && pnpm exec tsx src/vectors.ts

bytecode:
	forge build
	cd scripts/live && npx tsx check-bytecode.ts

slither:
	rm -rf /tmp/verbatim-slither && mkdir -p /tmp/verbatim-slither && mkdir -p /tmp/verbatim-slither/contracts && cp -R src lib foundry.toml /tmp/verbatim-slither/contracts/
	cd /tmp/verbatim-slither/contracts && find src -name '*.yul' -delete && pipx run --spec slither-analyzer slither . --filter-paths "lib/forge-std|probe/" --exclude-informational

proofs: install
	cd scripts/live && ./run-all-devnet.sh

proofs-legb: install
	cd scripts/live && npx tsx legb-deploy.ts && npx tsx legb-run.ts
	$(MAKE) report

report: addresses
	cd scripts/gas-report && pnpm report

addresses:
	cd scripts/live && npx tsx addresses.ts

# The whole demo, live on Sepolia, narrated in the terminal. demo-dry mines nothing.
demo-live: install
	cd scripts/live && npx tsx live-demo.ts

demo-dry: install
	cd scripts/live && npx tsx live-demo.ts --dry
