// M2 test data — SharedArray seed + deterministic unique builder.
// k6-only (k6/data). No npm dependencies. Public demo creds live here so
// test files never inline credentials or payload JSON.

import { SharedArray } from 'k6/data';

const seeds = new SharedArray('bookings', () => JSON.parse(open('../data/bookings.json')));

// Public Booker training credentials (documented demo account, not a secret).
export const DEMO_CREDS = { username: 'admin', password: 'password123' };

export function authPayload() {
  return JSON.stringify(DEMO_CREDS);
}

export function seedCount() {
  return seeds.length;
}

export function seedBooking(index) {
  return seeds[index % seeds.length];
}

// Unique payload per VU/iteration so parallel VUs never collide on the
// shared public host (which resets every ~10 min). Tag identifies the caller.
export function uniqueBooking(tag) {
  const seed = seedBooking(__VU + __ITER);
  return {
    firstname: `${seed.firstname}-v${__VU}-i${__ITER}-${Date.now()}-${tag || 'm2'}`,
    lastname: seed.lastname,
    totalprice: seed.totalprice,
    depositpaid: seed.depositpaid,
    bookingdates: {
      checkin: seed.bookingdates.checkin,
      checkout: seed.bookingdates.checkout,
    },
    additionalneeds: seed.additionalneeds,
  };
}
