#!/usr/bin/env bash
# Verbatim: run everything we claim, from the terminal, and show it working.
#
#   ./demo.sh                 all stages: every attack and swap type on Sepolia, the frames devnet, and the hosted site in a real browser
#                             (every page, the ENS checks, all 13 live cases and the full demo, through the page's own buttons).
#                             Mines about 10 transactions (roughly 0.004 Sepolia ETH plus gas); takes 15-20 minutes
#   ./demo.sh --no-mine       same, but nothing is mined: only what is refused before the mempool
#   ./demo.sh --quick         skip the slow parts (fuzz drops to 500 cases, one hosted case, no browser)
#   ./demo.sh --record        also record the 3-minute video with real browsers (adds about 6 minutes)
#   ./demo.sh --destructive   also run the devnet case that burns a descriptor (B10); afterwards the devnet needs contracts/scripts/live/fresh-deploy.sh
#   ./demo.sh --only=tests,live,hosted      just those stages (env tests fuzz bytecode live hosted site devnet phone record)
#   ./demo.sh --fuzz=2000     fuzz case count
#
# Needs: the root .env (git-ignored; only its variable names are checked here, values are never printed), node, pnpm, forge, anvil.
# Exit code: 0 if every stage passed, 1 if any failed. Stages that cannot run here (no phone, no .env) are skipped, and say so.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

MINE=1; QUICK=0; RECORD=0; FUZZ=10000; ONLY=""; DESTRUCTIVE=0
for a in "$@"; do
  case "$a" in
    --no-mine) MINE=0 ;;
    --quick) QUICK=1; FUZZ=500 ;;
    --record) RECORD=1 ;;
    --destructive) DESTRUCTIVE=1 ;;
    --fuzz=*) FUZZ="${a#--fuzz=}" ;;
    --only=*) ONLY="${a#--only=}" ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $a (see --help)"; exit 2 ;;
  esac
done
want() { [ -z "$ONLY" ] && return 0; case ",$ONLY," in *",$1,"*) return 0 ;; esac; return 1; }

SITE="${SITE_URL:-https://verbatim-wallet.vercel.app}"
API="${API_URL:-https://verbatim-server.onrender.com}"

if [ -t 1 ]; then B=$'\e[1m'; D=$'\e[2m'; R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; C=$'\e[36m'; Z=$'\e[0m'; else B=; D=; R=; G=; Y=; C=; Z=; fi
RESULTS=(); FAILS=0; T0=$(date +%s)
hr()   { printf '%s\n' "${D}────────────────────────────────────────────────────────────────────────${Z}"; }
stage(){ echo; hr; echo "${B}▌ $1${Z}"; echo "${D}  $2${Z}"; hr; }
pass() { RESULTS+=("${G}✓${Z} $1|$2"); echo "  ${G}✓${Z} $1${2:+ ${D}($2)${Z}}"; }
fail() { RESULTS+=("${R}✗${Z} $1|$2"); FAILS=$((FAILS+1)); echo "  ${R}✗ $1${Z}${2:+ ${D}($2)${Z}}"; }
skip() { RESULTS+=("${Y}–${Z} $1|$2"); echo "  ${Y}– $1${Z} ${D}($2)${Z}"; }
# run NAME CMD...: shows the command's output live, records pass/fail by exit code.
run()  { local n="$1"; shift; echo "  ${D}\$ $*${Z}"; local s=$(date +%s); if "$@"; then pass "$n" "$(( $(date +%s) - s )) s"; else fail "$n" "exit $?"; fi; }
tailof() { local n="$1" pat="$2"; shift 2; echo "  ${D}\$ $*${Z}"; local s=$(date +%s) out rc; out=$("$@" 2>&1); rc=$?; echo "$out" | grep -E "$pat" | sed 's/^/    /'; if [ $rc -eq 0 ]; then pass "$n" "$(( $(date +%s) - s )) s"; else echo "$out" | tail -15 | sed 's/^/    /'; fail "$n" "exit $rc"; fi; }
http() { curl -s -o /dev/null -w '%{http_code}' -m 90 "$1" 2>/dev/null; }
js()   { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log($1)}catch(e){console.log('')}})"; }
envname() { grep -qE "^$1=.+" "$ROOT/.env" 2>/dev/null; }

echo "${B}Verbatim: the chain is your wallet's screen${Z}"
echo "${D}$(date '+%Y-%m-%d %H:%M:%S')  ·  commit $(git rev-parse --short HEAD 2>/dev/null)$(git diff --quiet 2>/dev/null || echo '+local changes')  ·  mine=$MINE fuzz=$FUZZ${Z}"

# ── 1 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
if want env; then
  stage "1 · Environment" "tools on PATH, secrets present in .env (names only), Sepolia reachable"
  for t in node pnpm forge anvil curl; do command -v "$t" >/dev/null && pass "$t found" "$("$t" --version 2>/dev/null | head -1)" || fail "$t missing" "install it first"; done
  if [ -f .env ]; then
    for k in OWNER1_KEY OWNER2_KEY OWNER3_KEY ATTESTOR1_KEY ATTESTOR2_KEY SEPOLIA_RPC_URL BUNDLER_URL; do envname "$k" && pass ".env has $k" "" || fail ".env is missing $k" ""; done
  else
    fail ".env missing" "copy .env.example and fill it in"
  fi
  [ -d node_modules ] && pass "dependencies installed" "" || { echo "  ${D}\$ pnpm install --frozen-lockfile${Z}"; pnpm install --frozen-lockfile >/dev/null 2>&1 && pass "dependencies installed" "" || fail "pnpm install failed" ""; }
fi

# ── 2 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
if want tests; then
  stage "2 · Tests" "Solidity (the account, paymaster, renderer, invariants) and every TypeScript package"
  tailof "forge test" "tests passed|FAIL" bash -c 'cd contracts && forge test'
  tailof "TypeScript packages" "Tests +[0-9]+ passed|FAIL|failed" pnpm -r --if-present test
fi

# ── 3 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
if want fuzz; then
  stage "3 · The two renderers agree" "Solidity and TypeScript render $FUZZ random transactions; the bytes must be identical, or both must refuse"
  (cd contracts && forge build >/dev/null 2>&1)
  tailof "differential fuzz ($FUZZ cases)" "cases=" bash -c "cd contracts/scripts/difffuzz && pnpm exec tsx src/fuzz.ts $FUZZ"
fi

# ── 4 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
if want bytecode; then
  stage "4 · Deployed code shape" "exactly one LOG1 in the account and paymaster, no DELEGATECALL in the account"
  tailof "bytecode invariants" "^ok|FAIL|mismatch" bash -c 'cd contracts/scripts/live && npx tsx check-bytecode.ts'
fi

# ── 5 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
if want live; then
  if [ -f .env ]; then
    if [ "$MINE" = 1 ]; then
      stage "5 · Live on Sepolia, the whole demo" "an ordinary wallet is skimmed; Verbatim refuses the same swap; the honest swap lands; every attack dies; ENS is the trust root"
      ARGS=""
    else
      stage "5 · Live on Sepolia, refusals only (--no-mine)" "every lie about the sentence, refused before the mempool; nothing is mined and nothing is paid"
      ARGS="--dry"
    fi
    echo "  ${D}\$ npx tsx live-demo.ts $ARGS${Z}"
    LOG="$(mktemp -t verbatim-live.XXXXXX)"
    S=$(date +%s)
    (cd contracts/scripts/live && npx tsx live-demo.ts $ARGS) 2>&1 | tee "$LOG" | sed 's/^/  /'
    SUM=$(sed 's/\x1b\[[0-9;]*m//g' "$LOG" | sed -n '/── Summary/,$p'); N=$(echo "$SUM" | grep -c "^   ✓ "); BAD=$(echo "$SUM" | grep -c "^   ✗ ")
    if [ "$BAD" = 0 ] && [ "$N" -gt 0 ]; then pass "live demo: all $N cases behaved as expected, \$0 stolen" "$(( $(date +%s) - S )) s"; else fail "live demo: $BAD case(s) did not go as expected" "see the ✗ lines above"; fi
    grep -oE "https://sepolia.etherscan.io/tx/0x[0-9a-f]{64}" "$LOG" | sort -u | sed "s/^/    ${C}tx${Z} /"
    rm -f "$LOG"
  else
    skip "5 · live on Sepolia" "no .env here"
  fi
fi

# ── 6 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
if want hosted; then
  stage "6 · The hosted site and server" "$SITE and $API: pages load, the new build is live, and the server is ready to sign"
  for p in / /demo /uniswap /ens /proofs "/proofs?id=B-A1" "/proofs?view=history"; do
    c=$(http "$SITE$p"); [ "$c" = 200 ] && pass "GET $p" "HTTP $c" || fail "GET $p" "HTTP $c"
  done
  JS=$(curl -s -m 30 "$SITE/" | grep -oE '/assets/index-[^"]+\.js' | head -1)
  if [ -n "$JS" ]; then
    curl -s -m 60 "$SITE$JS" -o /tmp/verbatim-bundle.js
    for k in "History & proofs" "See the demo"; do grep -q "$k" /tmp/verbatim-bundle.js && pass "site bundle has \"$k\"" "the current build" || fail "site bundle lacks \"$k\"" "Vercel is serving an old build"; done
  else fail "site bundle not found" ""; fi
  echo "  ${D}waking the server (the first request after idle can take up to a minute)${Z}"
  INFO=$(curl -s -m 120 "$API/api/suites")
  READY=$(echo "$INFO" | js 'j.ready'); NS=$(echo "$INFO" | js 'Array.isArray(j.suites)?j.suites.length:j.suites')
  if [ "$READY" = true ]; then pass "server is ready to sign" "$NS suites listed"; else fail "server not ready" "$(echo "$INFO" | js 'j.why')"; fi
fi

# ── 6b ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
if want site; then
  stage "6b · The site in a real browser" "every page, the ENS checks, and every live case and the full demo run through the page's own buttons on Sepolia"
  if [ "$MINE" = 1 ] && [ "$QUICK" = 0 ]; then SARGS=""; else SARGS="--no-runs"; fi
  echo "  ${D}\$ SITE=$SITE tsx site-check.ts $SARGS${Z}"
  SLOG="$(mktemp -t verbatim-site.XXXXXX)"
  (cd contracts/scripts/e2e && SITE="$SITE" pnpm exec tsx site-check.ts $SARGS) 2>&1 | tee "$SLOG" | sed 's/^/  /'
  SN=$(sed 's/\x1b\[[0-9;]*m//g' "$SLOG" | grep -c "^  ✓ "); SB=$(sed 's/\x1b\[[0-9;]*m//g' "$SLOG" | grep -c "^  ✗ ")
  [ "$SB" = 0 ] && [ "$SN" -gt 0 ] && pass "site: all $SN browser checks passed" "" || fail "site: $SB browser check(s) failed" "$SN passed"
  rm -f "$SLOG"
fi

# ── 7 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
if want devnet; then
  stage "7 · The frames devnet (ERC-8421 alt mempool)" "the attack kit, swaps, and the stateless path (no paymaster, no stake), as frame transactions through the public alt mempool"
  OUT=$(cd contracts/scripts/live && npx tsx health.ts 2>&1 | head -3); echo "$OUT" | sed 's/^/    /'
  if echo "$OUT" | grep -q STALLED || ! echo "$OUT" | grep -q "devnet block"; then
    skip "devnet stages" "the public devnet is not producing blocks: use contracts/docs/demo/OFFLINE.md and the recorded video"
  elif [ ! -f .env ]; then skip "devnet stages" "no .env here"
  else
    pass "devnet is producing blocks" ""
    echo "  ${D}\$ tsx refresh-devnet.ts   (renews the six-hour snapshot if it has lapsed; same root, nothing redeployed)${Z}"
    (cd contracts/scripts/live && npx tsx refresh-devnet.ts 2>&1 | sed 's/^/    /')
    PF="$(mktemp -t verbatim-devnet.XXXXXX)"; rm -f "$PF"; export VERBATIM_PROOFS_FILE="$PF"   # watching never rewrites the committed evidence
    DLOG="$(mktemp -t verbatim-devnet-log.XXXXXX)"
    # devrun SCRIPT [IDS...]: runs one devnet script, shows its PASS/FAIL lines, and retries once any step the public mempool dropped.
    devrun() {
      local script="$1"; shift
      echo "  ${D}\$ tsx $script $*${Z}"
      (cd contracts/scripts/live && npx tsx "$script" "$@") > "$DLOG" 2>&1
      local lost; lost=$(grep -E "^FAIL" "$DLOG" | grep "not mined within" | sed -E 's/^FAIL ([A-Za-z0-9_-]+):.*/\1/' | tr '\n' ' ')
      if [ -n "$lost" ] && [ "$script" != stateless.ts ]; then
        # The public mempool sometimes forgets a transaction it admitted. That says nothing about the claim, so try the step again once.
        echo "    ${Y}the public mempool dropped: ${lost}; trying again${Z}"
        if [ "$script" = attacks.ts ]; then
          cp "$DLOG" "$DLOG.first"; (cd contracts/scripts/live && npx tsx "$script" $lost) > "$DLOG.second" 2>&1
          { grep -E "^(PASS|FAIL) " "$DLOG.first" | grep -vE "^FAIL ($(echo $lost | tr ' ' '|')):"; grep -E "^(PASS|FAIL) " "$DLOG.second"; } > "$DLOG"
        else
          (cd contracts/scripts/live && npx tsx "$script") > "$DLOG" 2>&1
        fi
      fi
      grep -E "^(PASS|FAIL) " "$DLOG" | while IFS= read -r l; do
        if [ "${l%% *}" = PASS ]; then echo "    ${G}✓${Z} $(echo "${l#PASS }" | cut -c1-150)"; else echo "    ${R}✗${Z} $(echo "${l#FAIL }" | cut -c1-200)"; fi
      done
      DP=$((DP + $(grep -cE "^PASS " "$DLOG"))); DF=$((DF + $(grep -cE "^FAIL " "$DLOG")))
    }
    DP=0; DF=0
    devrun attacks.ts
    devrun swap.ts
    STEPS=$(sed -n '/^const steps/,/^};/p' contracts/scripts/live/stateless.ts | grep -oE '^  async [A-Za-z0-9_]+' | awk '{print $2}')
    if [ "$DESTRUCTIVE" = 1 ]; then devrun stateless.ts $STEPS; else
      devrun stateless.ts $(echo "$STEPS" | grep -vE '^B10$')
      skip "devnet B10 (a leaf revoked while pending)" "it burns a descriptor on the shared devnet until fresh-deploy.sh; pass --destructive to run it"
    fi
    echo "  ${D}$DP passed, $DF failed${Z}"
    [ "$DF" = 0 ] && [ "$DP" -gt 0 ] && pass "devnet: $DP attacks, swaps and stateless-path cases behaved as expected" "" || fail "devnet: $DF case(s) did not behave as expected" "$DP passed"
    unset VERBATIM_PROOFS_FILE; rm -f "$PF" "$DLOG" "$DLOG".*
  fi
fi

# ── 8 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
if want phone; then
  stage "8 · The phone signer" "the Android app has the camera permission and nothing else, so the OS gives it no network at all"
  APK=packages/signer/android/build/verbatim-signer.apk
  if [ ! -f "$APK" ] && [ -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}/build-tools" ]; then echo "  ${D}\$ pnpm --filter @verbatim/signer android${Z}"; pnpm --filter @verbatim/signer android >/dev/null 2>&1; fi
  AAPT=$(ls "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/build-tools/*/aapt2 2>/dev/null | tail -1)
  if [ -f "$APK" ] && [ -n "$AAPT" ]; then
    PERMS=$("$AAPT" dump permissions "$APK" 2>/dev/null | grep -c "uses-permission")
    "$AAPT" dump permissions "$APK" 2>/dev/null | sed 's/^/    /'
    HAS=$("$AAPT" dump permissions "$APK" 2>/dev/null | grep -c INTERNET)
    [ "$PERMS" = 1 ] && [ "$HAS" = 0 ] && pass "APK asks for the camera only, no INTERNET" "" || fail "APK permissions are wrong" "$PERMS permission(s), INTERNET=$HAS"
  else skip "APK permission check" "no APK or Android build tools"; fi
  if command -v adb >/dev/null && adb devices 2>/dev/null | grep -qE "\sdevice$"; then
    adb install -r "$APK" >/dev/null 2>&1 && pass "installed on the connected phone" "$(adb shell getprop ro.product.model | tr -d '\r')" || fail "install failed" ""
    adb shell dumpsys package xyz.verbatim.signer 2>/dev/null | grep -q "android.permission.INTERNET" && fail "the phone reports an INTERNET permission" "" || pass "the phone reports no INTERNET permission" ""
  else skip "phone install" "no authorized phone on adb"; fi
fi

# ── 9 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
if want record && { [ "$RECORD" = 1 ] || [ -n "$ONLY" ]; } && [ "$QUICK" = 0 ]; then
  stage "9 · The recorded demo, in real browsers" "the site on the left, the offline signer on the right, live on Sepolia; writes contracts/docs/demo/verbatim-demo.mp4"
  command -v ffmpeg >/dev/null && run "record the video" bash -c 'cd contracts/scripts/e2e && pnpm exec tsx site-demo.ts' || skip "video" "no ffmpeg"
fi

# ── summary ─────────────────────────────────────────────────────────────────────────────────────────────────────────
echo; hr; echo "${B}▌ Summary${Z}  ${D}$(( $(date +%s) - T0 )) s${Z}"; hr
for r in ${RESULTS[@]+"${RESULTS[@]}"}; do printf '  %s%s\n' "${r%%|*}" "$( [ -n "${r#*|}" ] && echo " ${D}${r#*|}${Z}" )"; done
echo
if [ "$FAILS" = 0 ]; then echo "  ${G}${B}All stages passed.${Z}"; exit 0; else echo "  ${R}${B}$FAILS stage(s) failed.${Z}"; exit 1; fi
