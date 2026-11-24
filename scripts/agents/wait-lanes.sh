#!/bin/bash
# wait-lanes.sh <lane>... : returns as soon as one of the lanes' delegate jobs exits and prints its summary.
# Lanes already reported are listed in .agent-logs/reported.
cd "$(dirname "$0")/../.."
mkdir -p .agent-logs && touch .agent-logs/reported
while true; do
  live=0
  for l in "$@"; do
    grep -qx "$l" .agent-logs/reported && continue
    pid=$(cat ".agent-logs/$l.pid")
    if kill -0 "$pid" 2>/dev/null; then
      live=1
    else
      echo "$l" >> .agent-logs/reported
      echo "DONE $l"
      tail -c 3000 ".agent-logs/$l.log"
      exit 0
    fi
  done
  [ "$live" = 0 ] && { echo "all lanes already reported"; exit 0; }
  sleep 30
done
