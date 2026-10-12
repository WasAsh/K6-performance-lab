// M4 spike — LOCAL-ONLY sudden-surge survival profile.
// Shape: ramping-vus 1 (30s) → 20 (10s) → 20 (30s) → 0 (30s), ~1m40s total.
// Unlike stress (gradual ramp + sustained plateaus), spike jumps from a
// 1-VU baseline to a 20-VU surge in 10s to observe survival and recovery.
// Peak 20 VUs is within the plan §5 local allowance (≤25). Read-only and
// deliberately narrower than stress: GET /ping + GET /booking only, so the
// surge measures raw survival without detail-lookup noise. No writes.
//
// SAFETY: defaults to http://localhost:3001 and REFUSES any non-localhost
// BASE_URL in setup(), before any VU starts (zero requests sent on refusal).
// Requires a local Booker: git clone https://github.com/mwinteringham/restful-booker
// && docker-compose up (app on http://localhost:3001). M1–M3 files untouched.
// Reports (M6): handleSummary writes reports/spike-summary.{json,xml,html} (gitignored).

import { sleep } from 'k6';
import { buildSummary } from '../lib/report.js';
import { getThinkTime } from '../lib/config.js';
import { getBookings, ping } from '../lib/api.js';
import { checkBookingList, checkPing } from '../lib/checks.js';

const LOCAL_DEFAULT = 'http://localhost:3001';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 1 },
        { duration: '10s', target: 20 },
        { duration: '30s', target: 20 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
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
      `REFUSED: tests/spike.js targets the local Booker only. ` +
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
  checkBookingList(getBookings(baseUrl));
  sleep(thinkTime);
}

// M6 reporting — scenarios, checks and thresholds above are untouched.
export function handleSummary(data) {
  return buildSummary(data, 'spike');
}
