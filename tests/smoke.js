// M2 smoke — Restful-Booker health + read + auth sanity, via M2 helpers.
// Budget: shared-iterations, 1 VU x 3 iterations x 3 requests = 9 total,
// within the plan's ≤10-request public-host cap.
// Behavior and thresholds identical to M1; only wiring changed (imports,
// no inline JSON). No writes except the auth token request.
// Reports (M6): handleSummary writes reports/smoke-summary.{json,xml,html} (gitignored).

import { sleep } from 'k6';
import { buildSummary } from '../lib/report.js';
import { getBaseUrl, getThinkTime } from '../lib/config.js';
import { authenticate, getBookings, ping } from '../lib/api.js';
import { checkAuth, checkBookingList, checkPing } from '../lib/checks.js';

export const options = {
  scenarios: {
    smoke: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 3,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const baseUrl = getBaseUrl();
  const thinkTime = getThinkTime();

  // 1. Health: GET /ping → 201 'Created'.
  checkPing(ping(baseUrl));
  sleep(thinkTime);

  // 2. Read: GET /booking → 200 JSON array.
  checkBookingList(getBookings(baseUrl));
  sleep(thinkTime);

  // 3. Auth: POST /auth (public demo creds) → 200 + token.
  checkAuth(authenticate(baseUrl));
  sleep(thinkTime);
}

// M6 reporting — scenarios, checks and thresholds above are untouched.
export function handleSummary(data) {
  return buildSummary(data, 'smoke');
}
