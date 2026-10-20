#!/bin/bash
# Emits one line per finished external builder (re-reads pids.txt so newly launched lanes are watched too).
ROOT="/Users/Digital Next/Projects/Infini Shoot Game"; done_list="$ROOT/lanes/v2/done.txt"; touch "$done_list"
while true; do
  while IFS=: read -r p l; do
    [ -z "$p" ] && continue
    grep -qx "$l" "$done_list" && continue
    if ! kill -0 "$p" 2>/dev/null; then
      echo "$l" >> "$done_list"
      echo "DONE lane $l: $(git -C "$ROOT/wt/$l" log --oneline main..HEAD 2>/dev/null | wc -l | tr -d ' ') commits; tail: $(tail -c 250 "$ROOT/logs/$l.log" | tr '\n' ' ')"
    fi
  done < "$ROOT/lanes/v2/pids.txt"
  sleep 30
done
