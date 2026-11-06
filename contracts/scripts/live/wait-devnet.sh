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
# After a reset the operator replays the predeploys, and the staking registry is the last of them. Our account needs it.
reg() { curl -s -m 8 -X POST https://altmempool.forshtat.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f","latest"]}' | grep -c '"result":"0x[0-9a-f]'; }
until [ "$(reg)" = "1" ]; do python3 -c "import time;time.sleep(30)"; done
echo "staking registry is up at $(date)"
./run-all-devnet.sh
