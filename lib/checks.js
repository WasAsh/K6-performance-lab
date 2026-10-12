// M2 checks — shared check() blocks. Non-blocking by k6 design; the
// `checks` threshold in each test turns failures into a failed run.
// Names for ping/list/auth match the M1 smoke exactly (behavior preserved).

import { check } from 'k6';

export function checkPing(res) {
  return check(res, {
    'ping status is 201': (r) => r.status === 201,
    'ping body is Created': (r) => r.body && r.body.includes('Created'),
  });
}

export function checkBookingList(res) {
  return check(res, {
    'booking list status is 200': (r) => r.status === 200,
    'booking list is JSON array': (r) => {
      try {
        return Array.isArray(r.json());
      } catch (e) {
        return false;
      }
    },
  });
}

export function checkAuth(res) {
  return check(res, {
    'auth status is 200': (r) => r.status === 200,
    'auth returns token': (r) => {
      try {
        const token = r.json('token');
        return typeof token === 'string' && token.length > 0;
      } catch (e) {
        return false;
      }
    },
  });
}

export function checkBookingById(res) {
  return check(res, {
    'booking status is 200': (r) => r.status === 200,
    'booking has firstname': (r) => {
      try {
        return typeof r.json('firstname') === 'string';
      } catch (e) {
        return false;
      }
    },
    'booking has bookingdates': (r) => {
      try {
        return typeof r.json('bookingdates') === 'object';
      } catch (e) {
        return false;
      }
    },
  });
}

export function checkCreateBooking(res) {
  return check(res, {
    'create status is 200': (r) => r.status === 200,
    'create returns bookingid': (r) => {
      try {
        return typeof r.json('bookingid') === 'number';
      } catch (e) {
        return false;
      }
    },
  });
}

export function checkUpdateBooking(res) {
  return check(res, {
    'update status is 200': (r) => r.status === 200,
    'update echoes firstname': (r) => {
      try {
        return typeof r.json('firstname') === 'string';
      } catch (e) {
        return false;
      }
    },
  });
}

export function checkDeleteBooking(res) {
  return check(res, {
    'delete status is 201': (r) => r.status === 201,
  });
}
