// M3 load — read-only expected-load profile against Restful-Booker.
// Shape: ramping-vus 0→4 (30s) → 4 (60s) → 0 (30s), ~2 min total.
// Peak 4 VUs stays under the plan §5 cap (≤5 VUs); estimate ≈ 360 VU-seconds
// ÷ ~4.5s/iter ≈ 80 iter × 3 req ≈ 240 requests, under the ≤300/run cap.
// Read-only by design: GET /ping, GET /booking, GET /booking/:id with a
// freshly resolved ID each iteration — no fixed IDs (host resets ~10 min),
// no creates/updates/deletes, no auth storm. M1/M2 files untouched.
//
// SAFETY: defaults to http://localhost:3001 and REFUSES any non-localhost
// BASE_URL in setup() unless explicitly opted in with
// -e ALLOW_PUBLIC_LOAD=true (light public load only, shared-host budgets
// apply). Refusal happens before any VU starts — zero requests on refusal.
// Reports (M6): handleSummary writes reports/load-summary.{json,xml,html} (gitignored).

import { sleep } from 'k6';
import { buildSummary } from '../lib/report.js';
import { getThinkTime } from '../lib/config.js';
import { getBooking, getBookings, ping } from '../lib/api.js';
import {
  checkBookingById,
  checkBookingList,
  checkPing,
} from '../lib/checks.js';

export const options = {
  scenarios: {
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 4 },
        { duration: '60s', target: 4 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500'],
    checks: ['rate>0.98'],
  },
};

const LOCAL_DEFAULT = 'http://localhost:3001';

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

function publicLoadAllowed() {
  const raw = __ENV.ALLOW_PUBLIC_LOAD;
  return !!raw && raw.trim().toLowerCase() === 'true';
}

export function setup() {
  const baseUrl = testBaseUrl();
  if (!isLocalhost(baseUrl) && !publicLoadAllowed()) {
    throw new Error(
      `REFUSED: tests/load.js defaults to the local Booker. ` +
        `BASE_URL='${baseUrl}' is not localhost. To run light load against ` +
        `the public/shared host, re-run with -e ALLOW_PUBLIC_LOAD=true ` +
        `(public budgets apply: ≤5 VUs, ≤300 req/run, read-only). ` +
        `Or unset BASE_URL (defaults to ${LOCAL_DEFAULT}) or set it to a ` +
        `http://localhost[:port] or http://127.0.0.1[:port] URL. ` +
        `No requests were sent.`,
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
  // Skipped if the list is empty/unparseable — never a fixed ID.
  let id = null;
  try {
    const arr = listRes.json();
    if (Array.isArray(arr) && arr.length > 0 && arr[0].bookingid !== undefined) {
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
  return buildSummary(data, 'load');
}
