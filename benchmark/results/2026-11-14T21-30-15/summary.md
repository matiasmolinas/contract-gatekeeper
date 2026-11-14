# A/B swarm benchmark — results

- Started: 2026-11-14T21:30:15.411Z
- Provider: `openrouter:deepseek/deepseek-v4-flash-0731` · model reported by the API: `deepseek/deepseek-v4-flash-0731` · temperature 0
- Runs per arm: 3 · stories: 12 · parallel agents: 4
- Repository commit: `aa9a28b504c6d09cef02faf9f265e15cecc80e2f`

Cells show the median across runs, with the range in parentheses.

| Metric | classic | plugins |
| --- | --- | --- |
| Stories merged | 12 (12–12) | 12 (12–12) |
| Stories passing their hidden acceptance test on final main | 12 (12–12) | 12 (12–12) |
| Agent attempts | 13 (13–13) | 12 (12–12) |
| Real git merge conflicts | 1 (1–1) | 0 (0–0) |
| Rejected by the verification step | 0 (0–0) | 0 (0–0) |
| Failed verification after merge | 0 (0–0) | 0 (0–0) |
| LLM calls | 154 (141–155) | 143 (137–159) |
| Prompt tokens (API usage) | 1,785,660 (1,663,217–2,612,613) | 1,672,436 (1,651,511–2,111,813) |
| — of which served from cache | 1,538,560 (1,396,992–2,316,544) | 1,393,152 (1,377,024–1,710,080) |
| Completion tokens (API usage) | 85,816 (58,271–129,084) | 95,118 (92,599–157,980) |
| Total tokens (API usage) | 1,843,931 (1,749,033–2,741,697) | 1,767,554 (1,744,110–2,269,793) |
| Cost reported by the provider (US$) | 0.0961 (0.0632–0.0996) | 0.0851 (0.0761–0.1373) |
| Files read per attempt | 5.23 (4.23–6.08) | 6.42 (5.67–6.5) |
| Full test-suite runs during integration | 22 (22–23) | 8 (7–8) |
| Verification time, summed (ms) | 9,663 (9,320–10,065) | 5,039 (4,640–5,541) |
| Time waiting for a capsule lock, summed (ms) | 0 (0–0) | 278,248 (209,682–313,586) |
| Wall-clock time of the arm (ms) | 178,364 (125,922–371,659) | 382,675 (283,916–541,657) |

Gatekeeper verdicts per run (every attempt that reached the gate):

- run 1: 8 FAST_TRACK, 4 ESCALATE_TO_E2E
- run 2: 8 FAST_TRACK, 4 ESCALATE_TO_E2E
- run 3: 8 FAST_TRACK, 4 ESCALATE_TO_E2E

Raw data: `runN-<arm>.json` holds every turn with the usage object returned by the API, every patch and every verdict.
