#!/bin/bash
# check.sh [coop] — full checks in repo/
cd "/Users/Digital Next/Projects/Infini Shoot Game/repo"
echo "typecheck: $(npm run typecheck 2>&1 | grep -c 'error TS') errors"; npm run typecheck 2>&1 | grep 'error TS' | head -15
npx vite build > /tmp/vb.txt 2>&1 && echo "build ok" || { echo "BUILD FAIL"; grep -iE "error" /tmp/vb.txt | head -5; }
npm test > /tmp/t.txt 2>&1; grep -E "^FAIL" /tmp/t.txt | head -10; tail -1 /tmp/t.txt
npm run smoke > /tmp/s.txt 2>&1; grep -E "^FAIL" /tmp/s.txt | head -5; tail -1 /tmp/s.txt
if [ "$1" = coop ]; then npm run coop 2>&1 | grep -E "^- |PASSED|FAILED"; fi
