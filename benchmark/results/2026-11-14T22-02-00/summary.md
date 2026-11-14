# A/B swarm benchmark — results

- Started: 2026-11-14T22:02:00.398Z
- Provider: `openrouter:deepseek/deepseek-v4-flash-0731` · model reported by the API: `deepseek/deepseek-v4-flash-0731` · temperature 0
- Runs per arm: 3 · stories: 12 · parallel agents: 4
- Repository commit: `1f0aae5c5d30d90a785e2a16e97caffa135d15a4`

Cells show the median across runs, with the range in parentheses.

| Metric | coupled | classic | plugins |
| --- | --- | --- | --- |
| Stories merged | 12 (12–12) | 12 (12–12) | 12 (12–12) |
| Stories passing their hidden acceptance test on final main | 12 (11–12) | 12 (12–12) | 12 (12–12) |
| Agent attempts | 15 (15–15) | 13 (13–14) | 12 (12–12) |
| Real git merge conflicts | 2 (1–2) | 1 (1–2) | 0 (0–0) |
| Rejected by the verification step | 1 (0–1) | 0 (0–0) | 0 (0–0) |
| Failed verification after merge | 0 (0–0) | 0 (0–0) | 0 (0–0) |
| LLM calls | 319 (260–322) | 144 (144–160) | 137 (130–161) |
| Prompt tokens (API usage) | 11,129,540 (7,751,356–11,312,861) | 1,832,289 (1,525,241–2,270,502) | 1,700,531 (1,324,939–2,396,122) |
| — of which served from cache | 9,918,976 (6,861,824–10,228,992) | 1,591,808 (1,190,656–1,985,536) | 1,431,808 (1,095,168–2,036,736) |
| Completion tokens (API usage) | 213,084 (88,236–278,241) | 125,372 (123,062–127,335) | 128,215 (86,373–132,262) |
| Total tokens (API usage) | 11,407,781 (7,839,592–11,525,945) | 1,957,661 (1,648,303–2,397,837) | 1,832,793 (1,411,312–2,524,337) |
| Cost reported by the provider (US$) | 0.4779 (0.3651–0.6019) | 0.0898 (0.0766–0.1476) | 0.0848 (0.0605–0.1393) |
| Files read per attempt | 3.6 (3.2–3.8) | 4.86 (4.77–5) | 6.33 (5.92–7.75) |
| Full test-suite runs during integration | 24 (22–24) | 22 (21–23) | 7 (7–7) |
| Verification time, summed (ms) | 11,061 (10,129–11,146) | 9,431 (8,925–9,824) | 4,433 (4,407–4,770) |
| Time waiting for a capsule lock, summed (ms) | 0 (0–0) | 0 (0–0) | 268,834 (203,173–328,006) |
| Wall-clock time of the arm (ms) | 462,883 (366,698–1,323,691) | 277,290 (250,314–379,650) | 293,130 (283,322–456,576) |

Gatekeeper verdicts per run (every attempt that reached the gate):

- run 1: 8 FAST_TRACK, 4 ESCALATE_TO_E2E
- run 2: 8 FAST_TRACK, 4 ESCALATE_TO_E2E
- run 3: 8 FAST_TRACK, 4 ESCALATE_TO_E2E

Raw data: `runN-<arm>.json` holds every turn with the usage object returned by the API, every patch and every verdict.
