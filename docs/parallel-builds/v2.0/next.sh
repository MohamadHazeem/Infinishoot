#!/bin/bash
# next.sh [runner] — launch the next queued lane (optionally the next one for a given runner: codex|claude2|me). Prints the lane and runner.
D="/Users/Digital Next/Projects/Infini Shoot Game/lanes/v2"; cd "$D"
line=$( [ -n "$1" ] && grep -m1 " $1\$" queue.txt || head -1 queue.txt )
[ -z "$line" ] && { echo "queue empty"; exit 0; }
L=${line% *}; R=${line#* }
grep -v -x "$line" queue.txt > q.tmp; mv q.tmp queue.txt
if [ "$R" = me ]; then
  ROOT="/Users/Digital Next/Projects/Infini Shoot Game"; cd "$ROOT/repo"
  git worktree add -q "../wt/$L" -b "lane/$L" main && cp -Rc node_modules "../wt/$L/node_modules" && mkdir -p "../wt/$L/notes/lanes"
  { sed "s/<LANE>/$L/g" "$D/_common.md"; echo; cat "$D/$L.md"; } > "../wt/$L/.lane-brief.md"
  echo "AGENT $L"
else
  ./launch.sh "$L" "$R"
fi
