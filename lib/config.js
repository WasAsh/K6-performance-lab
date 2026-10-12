// M1 env resolution. Single-purpose helper — no API/check/data helpers yet (M2).
// Defaults mirror config/environments.json (public.baseUrl) so the k6 runtime
// stays dependency-free (no open()/JSON-import path fragility in M1).

const PUBLIC_BASE_URL = 'https://restful-booker.herokuapp.com';

const LOCAL_BASE_URL = 'http://localhost:3001';

export function getBaseUrl() {
  const fromEnv = __ENV.BASE_URL;
  if (fromEnv && fromEnv.trim() !== '') {
    return fromEnv;
  }
  return PUBLIC_BASE_URL;
}

export function getThinkTime() {
  const raw = __ENV.THINK_TIME;
  const parsed = parseFloat(raw);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 10) {
    return parsed;
  }
  return 1;
}

export function getLocalBaseUrl() {
  return LOCAL_BASE_URL;
}
