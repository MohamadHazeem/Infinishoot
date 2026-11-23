#!/bin/zsh
# gate.sh [dir] : every release check, in three waves instead of one long line (about 15 min instead of 30).
#   wave 1 (Node and jsdom, at once): test, smoke, balance, visual, coop8
#   wave 2 (online co-op, one at a time: run together they starve each other's PeerJS/WebRTC connections): coop --offline, coop4, migrate
#   wave 3 (alone, so the frame times mean something): bench:real --check
# A failed check is run once more on its own before it counts (the machine is shared and often loaded).
# One line per check; logs in .agent-logs/gate-<branch>/. Exit code 1 if any check still fails.
D=${1:-$(cd "$(dirname "$0")/../.." && pwd)}
cd "$D" || exit 2
L=.agent-logs/gate-$(git branch --show-current | tr / -)
mkdir -p $L
: > $L/result
check() { # name cmd...
  local n=$1; shift; local t0=$(date +%s)
  if "$@" > $L/$n.log 2>&1; then echo "PASS $n ($(( $(date +%s)-t0 ))s)" >> $L/result; return 0; fi
  echo "FAIL $n ($(( $(date +%s)-t0 ))s): $(tail -3 $L/$n.log | tr '\n' ' ' | cut -c1-300)" >> $L/result
  return 1
}
retry() { # name cmd...  (second attempt alone, after its wave)
  local n=$1; shift
  grep -q "^FAIL $n " $L/result || return 0
  sed -i '' "/^FAIL $n /d" $L/result
  mv $L/$n.log $L/$n.first.log
  check "$n" "$@" && sed -i '' "s/^PASS $n (/PASS $n on retry (/" $L/result
}
typeset -A CMD
CMD=(
  test 'npm test'
  smoke 'npm run smoke'
  balance 'timeout 1500 npm run balance'
  visual 'timeout 1200 npm run visual'
  coop8 'timeout 900 npm run coop8'
  coop 'timeout 1200 npm run coop -- --offline'
  coop4 'timeout 1500 npm run coop4'
  migrate 'timeout 1500 npm run migrate -- --runs 2'
  benchreal 'timeout 1800 npm run bench:real -- --check'
)
wave() { for n in "$@"; do check $n ${(z)CMD[$n]} & done; wait; for n in "$@"; do retry $n ${(z)CMD[$n]}; done; }

check build npm run build || { cat $L/result; exit 1; }
wave test smoke balance visual coop8
wave coop
wave coop4
wave migrate
wave benchreal
cat $L/result
! grep -q '^FAIL' $L/result
