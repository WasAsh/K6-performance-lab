// M5 soak — LOCAL-ONLY endurance profile.
// Shape: constant-vus, 3 VUs for 30 min (plan §5 self-host allowance).
// Unlike stress/spike (changing VU shapes), soak holds a flat, stable load
// to surface slow degradation (latency drift, error creep) over time.
// Read-only: GET /ping, GET /booking, GET /booking/:id with a freshly
// resolved ID each iteration — reset-aware by construction (the public host
// resets every ~10 min; local self-host resets too, so no iteration ever
// depends on an ID older than itself). No writes, no auth storm.
//
// RUNTIME ESTIMATE: 3 VUs × 1800 s ÷ ~4.2 s/iter ≈ 1290 iter × 3 req ≈
// ~3900 requests total (~2.2 rps) — light for a local Docker Booker.
// Trend analysis of p95 over the run belongs to M6 reporting; here the
// thresholds gate the run (non-zero exit on drift/failure).
//
// SAFETY: defaults to http://localhost:3001 and REFUSES any non-localhost
// BASE_URL in setup(), before any VU starts (zero requests sent on refusal).
// Requires a local Booker: git clone https://github.com/mwinteringham/restful-booker
// && docker-compose up (app on http://localhost:3001). M1–M4 files untouched.
// Reports (M6): handleSummary writes reports/soak-summary.{json,xml,html} (gitignored).

import { sleep } from 'k6';
import { buildSummary } from '../lib/report.js';
import { getThinkTime } from '../lib/config.js';
import { getBooking, getBookings, ping } from '../lib/api.js';
import {
  checkBookingById,
  checkBookingList,
  checkPing,
} from '../lib/checks.js';

const LOCAL_DEFAULT = 'http://localhost:3001';

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: 3,
      duration: '30m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500'],
    checks: ['rate>0.95'],
  },
};

function testBaseUrl() {
  const raw = __ENV.BASE_URL;
  if (raw && raw.trim() !== '') {
    return raw.trim();
  }
  return LOCAL_DEFAULT;
}

function isLocalhost(url) {
  const u = url.toLowerCase();
  return (
    u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1')
  );
}

export function setup() {
  const baseUrl = testBaseUrl();
  if (!isLocalhost(baseUrl)) {
    throw new Error(
      `REFUSED: tests/soak.js targets the local Booker only. ` +
        `BASE_URL='${baseUrl}' is not localhost. Unset BASE_URL ` +
        `(defaults to ${LOCAL_DEFAULT}) or set it to a http://localhost[:port] ` +
        `or http://127.0.0.1[:port] URL. No requests were sent.`,
    );
  }
  return { baseUrl };
}

export default function (data) {
  const baseUrl = data.baseUrl;
  const thinkTime = getThinkTime();

  // 1. Health: GET /ping → 201 'Created'.
  checkPing(ping(baseUrl));
  sleep(thinkTime);

  // 2. List: GET /booking → 200 JSON array.
  const listRes = getBookings(baseUrl);
  checkBookingList(listRes);
  sleep(thinkTime);

  // 3. Detail: GET /booking/:id with a live ID from this iteration's list.
  let id = null;
  try {
    const arr = listRes.json();
    if (
      Array.isArray(arr) &&
      arr.length > 0 &&
      arr[0].bookingid !== undefined
    ) {
      id = arr[0].bookingid;
    }
  } catch (e) {
    id = null;
  }
  if (id !== null) {
    checkBookingById(getBooking(baseUrl, id));
    sleep(thinkTime);
  }
}

// M6 reporting — scenarios, checks and thresholds above are untouched.
export function handleSummary(data) {
  return buildSummary(data, 'soak');
}
