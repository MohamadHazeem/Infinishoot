# CI shield fixture: supplementary jsdom proxy

Rail/shield/storm, seed 4242, normal god bot, two stages. Same frozen-before/final-refund runner comparison; not a replacement for the browser CI baseline. Sweep times/kills below are per-stage, whereas browser CI records cumulative values.

| Stage | Metric | Before | After | Change | 25% tolerance |
|---|---|---|---|---|---|
| 1 | time | 254 | 253 | -0.4% | PASS |
| 1 | kills | 5296 | 5208 | -1.7% | PASS |
| 1 | level | 19 | 19 | 0.0% | PASS |
| 1 | ranks | 13 | 13 | 0.0% | PASS |
| 2 | time | 259 | 267 | 3.1% | PASS |
| 2 | kills | 7604 | 8456 | 11.2% | PASS |
| 2 | level | 27 | 30 | 11.1% | PASS |
| 2 | ranks | 24 | 26 | 8.3% | PASS |

Both versions clear two stages. No browser baseline was changed. Run `npm run balance` after integration before deciding whether its browser measurements need refresh.
