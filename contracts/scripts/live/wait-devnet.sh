#!/bin/sh
# Waits for the public devnet to produce blocks again, then runs everything.
cd "$(dirname "$0")"
num() { curl -s -m 8 -X POST https://altmempool.forshtat.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | sed 's/.*result":"\([^"]*\)".*/\1/'; }
first=$(num)
while :; do
  n=$(num)
  if [ -n "$n" ] && [ "$n" != "$first" ]; then break; fi
  python3 -c "import time;time.sleep(60)"
done
echo "devnet moved from $first to $n at $(date)"
./run-all-devnet.sh
