// M2 API wrappers — one per Booker endpoint, each tagged with group() so
// per-endpoint timings show up in the end-of-test summary. Callers pass
// baseUrl explicitly ( honor __ENV.BASE_URL via lib/config.js). Auth payload
// is built internally from lib/data.js — test files never inline JSON.

import http from 'k6/http';
import { group } from 'k6';
import { authPayload } from './data.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function tokenHeaders(token) {
  return { 'Content-Type': 'application/json', Cookie: `token=${token}` };
}

export function ping(baseUrl) {
  return group('ping', () => http.get(`${baseUrl}/ping`));
}

export function getBookings(baseUrl) {
  return group('getBookings', () => http.get(`${baseUrl}/booking`));
}

export function getBooking(baseUrl, id) {
  // Booker quirk: GET /booking/:id returns 418 without an explicit Accept
  // header (curl works because it sends `Accept: */*`; k6 sends none).
  return group('getBooking', () =>
    http.get(`${baseUrl}/booking/${id}`, {
      headers: { Accept: 'application/json' },
    }),
  );
}

export function authenticate(baseUrl) {
  return group('auth', () =>
    http.post(`${baseUrl}/auth`, authPayload(), { headers: JSON_HEADERS }),
  );
}

export function createBooking(baseUrl, booking) {
  return group('createBooking', () =>
    http.post(`${baseUrl}/booking`, JSON.stringify(booking), {
      headers: JSON_HEADERS,
    }),
  );
}

export function updateBooking(baseUrl, id, booking, token) {
  return group('updateBooking', () =>
    http.put(`${baseUrl}/booking/${id}`, JSON.stringify(booking), {
      headers: tokenHeaders(token),
    }),
  );
}

export function partialUpdateBooking(baseUrl, id, partial, token) {
  return group('partialUpdateBooking', () =>
    http.patch(`${baseUrl}/booking/${id}`, JSON.stringify(partial), {
      headers: tokenHeaders(token),
    }),
  );
}

export function deleteBooking(baseUrl, id, token) {
  return group('deleteBooking', () =>
    http.del(`${baseUrl}/booking/${id}`, null, {
      headers: tokenHeaders(token),
    }),
  );
}
