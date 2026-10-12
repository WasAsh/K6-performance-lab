# k6 Performance Lab — Restful-Booker

QA performance-testing portfolio built on **Grafana k6 (OSS, JavaScript only, no npm dependencies)**.
Target API: [Restful-Booker](https://github.com/mwinteringham/restful-booker) — a public
training booking API with auth + CRUD. Heavy profiles run against a **local Docker
self-host** of the same API; the public host is used for smoke and light load only.

Tested with **k6 v2.2.0** (portable Windows binary — see [Prerequisites](#prerequisites)).

## How it works

```text
tests/smoke.js|load.js|stress.js|spike.js|soak.js   # one file per profile
   └─ import from lib/
        config.js  # BASE_URL + THINK_TIME resolution (k6 __ENV)
        api.js     # one group()-tagged wrapper per Booker endpoint
        checks.js  # shared check() blocks (non-blocking; thresholds gate the run)
        data.js    # SharedArray seed (data/bookings.json) + unique payload builder, demo creds
        report.js  # buildSummary() → reports/<type>-summary.{json,xml,html} via handleSummary
config/environments.json  # public + local base URLs (reference; k6 does not read this file at runtime)
data/bookings.json        # static seed payloads (names/dates/prices)
docker-compose.yml        # local Booker + Prometheus + Grafana, loopback-only ports
prometheus.yml            # minimal Prometheus config (remote-write receiver enabled via compose flags)
reports/                  # gitignored per-run output (JSON + JUnit XML + HTML)
Docs/next-phase-plan.md   # project roadmap and public-host budgets (planning doc, not a runbook)
```

Key design points (all verified in source):

- Every API call passes `baseUrl` explicitly and is wrapped in `group()` so the
  end-of-test summary shows per-endpoint timings.
- `GET /booking/:id` sends `Accept: application/json` — without it Booker returns
  `418` to k6 (k6 sends no `Accept` header by default; see `lib/api.js`).
- `GET /booking/:id` always uses a **live ID from the same iteration's list
  response** — never a fixed ID (the host resets roughly every ~10 min).
- Load/stress/soak **skip the detail lookup** when the list is empty or
  unparseable, so check counts legitimately vary run to run.
- Write helpers (`createBooking`, `updateBooking`, `partialUpdateBooking`,
  `deleteBooking`) and their checks **exist in `lib/` but no test file calls
  them yet** — all five profiles are read-only except smoke's `POST /auth`
  token request.
- `lib/data.js` holds the public Booker training credentials
  (`admin` / `password123`) as `DEMO_CREDS`. These are documented demo
  credentials, not secrets — still, never put private tokens in the repo
  (local overrides belong in untracked `.env`, see `.env.example`).

## Prerequisites

- **Windows PowerShell** (commands below assume PowerShell 5.1+, run from the repo root).
- **k6 v2.2.0.** Any install works if `k6` is on `PATH`. The runs in this project
  were executed with the portable binary at:

  ```powershell
  "$env:LOCALAPPDATA\Temp\opencode\k6\k6-v2.2.0-windows-amd64\k6.exe"
  ```

  Note: that lives under `Temp` and may not survive cleanup — prefer a permanent
  install (`winget install k6` / `choco install k6`, requires admin for choco)
  and then plain `k6` in the commands below. To save typing:

  ```powershell
  $K6 = "$env:LOCALAPPDATA\Temp\opencode\k6\k6-v2.2.0-windows-amd64\k6.exe"
  ```

- **Docker Desktop** (Engine + Compose v2) for the local stack. No Node/npm
  build step — k6 runs the `.js` files directly.

## Local stack (Docker Compose)

`docker-compose.yml` defines three services, all bound to loopback only:

| Service        | Container             | URL                                                     |
|----------------|-----------------------|---------------------------------------------------------|
| restful-booker | k6-lab-restful-booker | `http://localhost:3001` (`GET /ping` → `201 Created`)   |
| prometheus     | k6-lab-prometheus     | `http://localhost:9090`                                 |
| grafana        | k6-lab-grafana        | `http://localhost:3000` (login `admin` / `admin`)       |

```powershell
# from the repo root
docker compose up -d --build   # first run builds Booker (downloads ~1 GB base layers + npm install; slow networks take several minutes)
docker compose ps
curl.exe http://localhost:3001/ping   # expect: 201 "Created"
docker compose logs restful-booker    # or: prometheus, grafana
docker compose down                # stop everything (keeps volumes)
```

Notes:

- The Booker image builds from pinned upstream git
  (`.../restful-booker.git#00461155995c8636866bf51dc444f63033da44fb`,
  main HEAD as of 2026-10-12, committed 2026-03-27),
  so the first build needs network access. Rebuilds are incremental.
- Only `restful-booker` uses `restart: "no"`; Prometheus/Grafana use
  `unless-stopped`. After a reboot, Booker needs an explicit `docker compose up -d`.
- Prometheus runs with `--web.enable-remote-write-receiver` so k6 can push
  via `-o experimental-prometheus-rw` (default endpoint
  `http://localhost:9090/api/v1/write`).

## Test profiles

| Test | Purpose | VU profile / duration | Thresholds | Local-only protection |
|------|---------|----------------------|------------|----------------------|
| `tests/smoke.js` | Health + read + auth sanity | `shared-iterations`: 1 VU × 3 iters × 3 req = **9 req**, ~10 s | `http_req_failed rate<0.01`, `p(95)<1000`, `checks rate>0.99` | **None** — intended for either target |
| `tests/load.js` | Expected-load reads | `ramping-vus` 0→4 (30s) → 4 (60s) → 0 (30s); **~2 min**, peak **4 VUs**, ~240 req | `rate<0.02`, `p(95)<1500`, `checks>0.98` | **Opt-in** — `setup()` refuses non-localhost `BASE_URL` unless `-e ALLOW_PUBLIC_LOAD=true`; defaults to `http://localhost:3001` |
| `tests/stress.js` | Beyond-expected gradual ramp + plateaus | `ramping-vus` 0→10 (1m) → 10 (2m) → 20 (1m) → 0 (1m); **~5 min**, peak **20 VUs** | `rate<0.05`, `p(95)<2500`, `checks>0.95` | **Yes** — `setup()` throws on non-localhost `BASE_URL` before any VU starts (0 requests sent); defaults to `http://localhost:3001` |
| `tests/spike.js` | Sudden-surge survival + recovery (ping + list only) | `ramping-vus` 1 (30s) → 20 (10s) → 20 (30s) → 0 (30s); **~1m40s**, peak **20 VUs** | `rate<0.05`, `p(95)<2000`, `checks>0.95` | **Yes** — same `setup()` refusal |
| `tests/soak.js` | Flat endurance for slow drift | `constant-vus` **3 VUs × 30 min**, ~3,900 req (~2.2 rps) | `rate<0.02`, `p(95)<1500`, `checks>0.95` | **Yes** — same `setup()` refusal |

Thresholds gate the run: k6 exits non-zero when any threshold fails. Checks
themselves are non-blocking — the `checks rate>…` threshold is what turns
check failures into a failed run.

### ⚠️ Public-target warning

The public host (`https://restful-booker.herokuapp.com`) is a **shared training
service with no load-testing SLA** — appropriate targets are **smoke and
carefully limited light load only** (single-digit VUs, triple-digit requests
per run, read-heavy, 1s+ think time; back off on any 429/timeout, never retry
harder). **`stress.js`, `spike.js`, and `soak.js` must stay local** — they
refuse non-localhost targets in `setup()`, and bypassing that guard to aim
them at the public host would be abuse. `load.js` refuses non-local targets
unless explicitly opted in (`-e ALLOW_PUBLIC_LOAD=true`), but passing the
flag is a conscious act — keep public load runs inside the stated budgets.

## Running the tests (PowerShell, against local API)

Run from the repo root with the stack up. Explicit `-e BASE_URL` is recommended
even where the test defaults to local, so the target is visible in history.

```powershell
$K6 = "$env:LOCALAPPDATA\Temp\opencode\k6\k6-v2.2.0-windows-amd64\k6.exe"
# (or: $K6 = "k6"  if k6 is on PATH)

# Smoke (~10 s) — local + Prometheus remote-write
& $K6 run -e BASE_URL=http://localhost:3001 -o experimental-prometheus-rw tests/smoke.js

# Load (~2 min) — local + Prometheus remote-write
& $K6 run -e BASE_URL=http://localhost:3001 -o experimental-prometheus-rw tests/load.js

# Stress (~5 min) — local only (guard refuses anything non-localhost)
& $K6 run -e BASE_URL=http://localhost:3001 -o experimental-prometheus-rw tests/stress.js

# Spike (~1m40s) — local only
& $K6 run -e BASE_URL=http://localhost:3001 -o experimental-prometheus-rw tests/spike.js

# Soak (30 min) — local only
& $K6 run -e BASE_URL=http://localhost:3001 -o experimental-prometheus-rw tests/soak.js
```

Variants:

```powershell
# Without Prometheus output (console summary + reports/ only) — omit the -o flag:
& $K6 run -e BASE_URL=http://localhost:3001 tests/smoke.js

# Stress/spike/soak without -e BASE_URL also target local (built-in default),
# but explicit is preferred for auditability.

# Think time override (seconds, 0–10, default 1; anything else falls back to 1):
& $K6 run -e BASE_URL=http://localhost:3001 -e THINK_TIME=2 tests/load.js

# Against the public host — smoke and light load ONLY (see warning above):
& $K6 run -e BASE_URL=https://restful-booker.herokuapp.com tests/smoke.js

# Light public load requires the explicit opt-in (refused without it):
& $K6 run -e BASE_URL=https://restful-booker.herokuapp.com -e ALLOW_PUBLIC_LOAD=true tests/load.js
```

Environment resolution (implemented in `lib/config.js`, mirrored in
`config/environments.json`):

- Smoke resolves the target via `getBaseUrl()`: `__ENV.BASE_URL` when set,
  else the **public** Heroku URL — always pass `-e BASE_URL` deliberately.
- Load resolves via its own `testBaseUrl()`: `__ENV.BASE_URL` when set, else
  `http://localhost:3001`, then `setup()` **refuses** non-localhost targets
  unless `-e ALLOW_PUBLIC_LOAD=true` (case-insensitive `true`).
- Stress/spike/soak resolve via their own `testBaseUrl()`: `__ENV.BASE_URL`
  when set, else `http://localhost:3001`, then `setup()` **refuses** anything
  not starting with `http://localhost` / `http://127.0.0.1` (case-insensitive;
  `https://localhost…` is also refused — Booker serves plain HTTP).
- k6 does **not** auto-load `.env` — `.env.example` is documentation only.
  Pass variables with `-e` (or `$env:BASE_URL=…` in the shell).

## Reports

Every test wires `handleSummary()` → `buildSummary(data, '<type>')`. The
default console summary still prints; additionally each run writes three files
(gitignored via `reports/` in `.gitignore`):

- `reports/<type>-summary.json` — machine-readable: `testType`, UTC `timestamp`,
  `success` (**`true`/`false`/`null`** — `null` means the summary payload carried
  no threshold results and must never be read as success), per-expression
  `thresholds`, `keyMetrics` (`httpReqs`, `failedRate` %, `p95` ms, `avg` ms,
  `checkRate` %), per-check pass/fail list, and full `metrics`.
- `reports/<type>-summary.xml` — JUnit (one `<testcase>` per check plus one per
  threshold expression; check and threshold failures both count toward
  `failures`).
- `reports/<type>-summary.html` — human-readable tables with an overall
  `PASS — …` / `FAIL — …` / `UNKNOWN — …` banner.

Filenames are per test type, so a new run of the same test overwrites only its
own three files. Reference example (local smoke, green):
`httpReqs 9`, `failedRate 0.00%`, `p95 76.89ms`, `avg 26.05ms`,
`checkRate 100.00%`, all thresholds held.

## Prometheus / Grafana

- k6 pushes with `-o experimental-prometheus-rw` to
  `http://localhost:9090/api/v1/write` (k6 default; override with
  `K6_PROMETHEUS_RW_SERVER_URL` if needed). **Start the compose stack before
  the run** — if nothing listens on `:9090`, the run still executes but metric
  delivery fails and the end-of-test console summary can be cut short
  (the `reports/` files remain the source of truth).
- `prometheus.yml` in the repo is intentionally minimal (`scrape_interval: 5s`,
  empty `scrape_configs`) — remote-write ingestion needs no scrape entries.
- **Grafana setup is currently manual — no datasource or dashboards are
  provisioned in this repo.** After `docker compose up -d`: open
  `http://localhost:3000`, log in, add a Prometheus datasource pointing at
  `http://prometheus:9090` (container network; `http://localhost:9090` also
  works from the browser side for direct access), then build or import k6
  dashboard panels.
- ⚠️ **Grafana ships with default credentials `admin` / `admin`** (set in
  `docker-compose.yml`; you are prompted to change the password on first
  login). All three published ports bind `127.0.0.1` only, so the stack is not
  reachable beyond this host — still, change the Grafana password for any
  shared machine.

## Safety limits & known limitations

- Public host: smoke + light load only (see warning). The shared host resets
  roughly every 10 min — no run ever depends on state older than one iteration.
- Every VU sleeps `THINK_TIME` (default 1s) between requests — no tight loops.
- `getLocalBaseUrl()` in `lib/config.js` is currently unused (stress/spike/soak
  each define their own `LOCAL_DEFAULT`) — cosmetic duplication, harmless.
- Soak thresholds gate pass/fail only; **no time-series drift analysis exists**
  — do not claim slow-degradation detection beyond comparing per-run p95/error
  rates.
- Pinned versions (verified 2026-10-12; k6 v2.2.0 for the tests):

  | Component | Pin |
  |-----------|-----|
  | Restful-Booker source | upstream `main` @ `00461155995c8636866bf51dc444f63033da44fb` (committed 2026-03-27, merge PR #48 nedb→lokijs) |
  | Prometheus | `prom/prometheus:v2.55.1@sha256:2659f4c2…51b0d3` (final 2.x stable; keeps the `--web.enable-remote-write-receiver` flag valid) |
  | Grafana | `grafana/grafana:11.6.16@sha256:d67af920…47d2c3` (latest 11.x patch; pairs with the Prometheus datasource API) |

  Full digests live in `docker-compose.yml`. Prometheus 3.x and Grafana 12+
  are deliberately deferred — each needs a verification run before adoption.
- Re-pin procedure (intentional updates only): resolve the new tag on Docker
  Hub (`https://hub.docker.com/v2/repositories/<ns>/<repo>/tags/<tag>`,
  record the manifest-list `digest`), update the `image:` line to
  `<repo>:<tag>@sha256:<digest>` (for Booker, read the commit SHA from the
  GitHub API and update the `#<sha>` context suffix), then
  `docker compose pull prometheus grafana && docker compose up -d --build`.
  Never pin by re-tagging a locally built image — digests of local builds are
  build IDs, not registry content addresses.
- Test-file header comments reference an older bring-up
  (`git clone … && docker-compose up`); the current path is this repo's
  `docker-compose.yml` (`docker compose up -d --build`).
- No CI workflow, no `package.json`, no `Docs/test-strategy.md` exist yet —
  the roadmap (`Docs/next-phase-plan.md`) describes them as future work.

## Cleanup

```powershell
docker compose down        # stop all three services (data volumes kept)
docker compose down -v     # also delete prometheus_data + grafana_data (stored metrics/dashboards are lost)
docker compose ps          # confirm nothing remains
```

`reports/*` and `.env` are gitignored — safe to leave, delete, or regenerate.

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|-------------------|
| First `docker compose up -d --build` takes very long / appears stuck on `node:22` layers | Normal on slow networks (~1 GB base layers + `npm install`). Layer pulls resume on retry — re-run the same command; check progress with `docker compose logs restful-booker` in another shell. |
| `curl.exe http://localhost:3001/ping` → connection refused | Booker still building or crashed: `docker compose ps`, then `docker compose logs restful-booker`. Ensure no other process occupies `:3001`. |
| Port already allocated (`3001`/`9090`/`3000`) | Another local service holds the port. Stop it or adjust the `ports:` mapping in `docker-compose.yml` (keep `127.0.0.1:` prefix). |
| `k6 run tests/stress.js` (or spike/soak) aborts with `REFUSED: … targets the local Booker only` | `BASE_URL` is set to something non-localhost. Unset it or set `-e BASE_URL=http://localhost:3001`. This is the guard working — zero requests were sent. |
| Run works but Prometheus has no data / console summary truncated | Prometheus wasn't up when k6 ran (`-o experimental-prometheus-rw` defaults to `localhost:9090`). `docker compose up -d`, re-run; `reports/` files are still valid for the completed run. |
| `& $K6 …` → command not found | The portable binary path under `$env:LOCALAPPDATA\Temp\…` was cleaned. Re-download k6 v2.2.0 or install permanently and use `$K6 = "k6"`. |
| Booking-detail checks missing from a report (fewer checks than requests) | The list came back empty/unparseable that iteration, so the detail lookup was skipped by design. Check the run's list responses before assuming a failure. |
| Grafana shows no data | Datasource/dashboards are manual (see above). Verify the datasource URL, then query any `k6_`-prefixed metric in Explore. |
| Grafana login rejected after password change | Credentials persist in the `grafana_data` volume. Reset via `docker compose down -v` (deletes dashboards) or use Grafana's admin reset procedure. |
