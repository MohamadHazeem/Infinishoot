#!/bin/bash
# lane.sh <lane> <kind> [base-branch]
# One builder per lane in its own git worktree (.agent-logs/wt/<lane>, branch lane/<lane>), briefed from
# .agent-logs/briefs/_common.md + <lane>.md, logging to .agent-logs/<lane>.log. The job is routed by the shared
# ~/.claude/tools/delegate.sh (kind: code | build | design | ui | local | verify | review; it picks the pool,
# model and speed tier). Everything under .agent-logs/ is git-ignored.
# Remove with: git worktree remove .agent-logs/wt/<lane> && git branch -d lane/<lane>
set -e
L=$1; K=$2; ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; BASE=${3:-$(git -C "$ROOT" branch --show-current)}
WT="$ROOT/.agent-logs/wt/$L"
cd "$ROOT"
[ -d "$WT" ] || { git worktree add -q "$WT" -b "lane/$L" "$BASE"; cp -Rc node_modules "$WT/node_modules"; }
{ sed "s/<LANE>/$L/g" .agent-logs/briefs/_common.md; echo; cat ".agent-logs/briefs/$L.md"; } > "$WT/.lane-brief.md"
nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' "$HOME/.claude/tools/delegate.sh" "$K" "$WT" "$WT/.lane-brief.md" "$ROOT/.agent-logs/$L.log" --add-dir "$ROOT/.git" \
  > "$ROOT/.agent-logs/$L.delegate.log" 2>&1 &
echo "$!" > "$ROOT/.agent-logs/$L.pid"
echo "launched $L ($K) pid $! in $WT"
