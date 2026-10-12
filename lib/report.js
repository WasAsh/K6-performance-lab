// M6 reporting — shared end-of-test summary builder. k6 built-ins only:
// JSON.stringify + string templates. No npm packages, no remote jslib
// imports (so local-only tests also work offline), no Cloud services.
// Each test wires it via `export function handleSummary(data) {
// return buildSummary(data, '<type>'); }` — scenarios, checks and
// thresholds are untouched; the default console summary still prints.
// Outputs (gitignored) per test type to avoid clobbering across runs:
//   reports/<type>-summary.json  machine-readable (type, timestamp,
//                                 thresholds, key metrics, full metrics)
//   reports/<type>-summary.xml   JUnit (one testcase per check)
//   reports/<type>-summary.html  human-readable tables

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Recursively collect { name, passes, fails } from root_group + subgroups.
function collectChecks(group, out) {
  if (!group || typeof group !== 'object') {
    return out;
  }
  const checks = group.checks;
  if (Array.isArray(checks)) {
    for (let i = 0; i < checks.length; i++) {
      const c = checks[i] || {};
      out.push({
        name: c.name !== undefined ? String(c.name) : 'unnamed check',
        passes: typeof c.passes === 'number' ? c.passes : 0,
        fails: typeof c.fails === 'number' ? c.fails : 0,
      });
    }
  }
  const groups = group.groups;
  if (Array.isArray(groups)) {
    for (let i = 0; i < groups.length; i++) {
      collectChecks(groups[i], out);
    }
  }
  return out;
}

// { metric: { expression: ok } } from the summary payload, when present.
function collectThresholds(metrics) {
  const result = {};
  if (!metrics || typeof metrics !== 'object') {
    return result;
  }
  const names = Object.keys(metrics);
  for (let i = 0; i < names.length; i++) {
    const m = metrics[names[i]];
    if (m && typeof m === 'object' && m.thresholds && typeof m.thresholds === 'object') {
      const exprs = Object.keys(m.thresholds);
      const inner = {};
      for (let j = 0; j < exprs.length; j++) {
        const t = m.thresholds[exprs[j]];
        inner[exprs[j]] = t && typeof t === 'object' ? !!t.ok : !!t;
      }
      result[names[i]] = inner;
    }
  }
  return result;
}

function num(metrics, name, field) {
  try {
    const v = metrics[name].values[field];
    return typeof v === 'number' ? v : null;
  } catch (e) {
    return null;
  }
}

function buildJunit(testType, timestamp, checks, thresholds) {
  let failures = 0;
  let cases = '';
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    cases += `    <testcase classname="k6.${escXml(testType)}.checks" name="${escXml(c.name)}"`;
    if (c.fails > 0) {
      failures += 1;
      cases += `>\n      <failure message="${c.fails} failure(s), ${c.passes} pass(es)">check "${escXml(c.name)}" failed ${c.fails} time(s)</failure>\n    </testcase>\n`;
    } else {
      cases += `/>\n`;
    }
  }
  const thresholdNames = Object.keys(thresholds);
  for (let i = 0; i < thresholdNames.length; i++) {
    const exprs = Object.keys(thresholds[thresholdNames[i]]);
    for (let j = 0; j < exprs.length; j++) {
      const ok = thresholds[thresholdNames[i]][exprs[j]];
      cases += `    <testcase classname="k6.${escXml(testType)}.thresholds" name="${escXml(thresholdNames[i])} ${escXml(exprs[j])}"`;
      if (!ok) {
        failures += 1;
        cases += `>\n      <failure message="threshold crossed">threshold "${escXml(exprs[j])}" on ${escXml(thresholdNames[i])} failed</failure>\n    </testcase>\n`;
      } else {
        cases += `/>\n`;
      }
    }
  }
  const total = checks.length + totalThresholds(thresholds);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuite name="k6-${escXml(testType)}" tests="${total}" failures="${failures}" timestamp="${escXml(timestamp)}">\n` +
    cases +
    `</testsuite>\n`
  );
}

function totalThresholds(thresholds) {
  let n = 0;
  const names = Object.keys(thresholds);
  for (let i = 0; i < names.length; i++) {
    n += Object.keys(thresholds[names[i]]).length;
  }
  return n;
}

function rowHtml(cells, header) {
  const tag = header ? 'th' : 'td';
  let r = '      <tr>';
  for (let i = 0; i < cells.length; i++) {
    r += `<${tag}>${escHtml(cells[i] === null || cells[i] === undefined ? 'n/a' : cells[i])}</${tag}>`;
  }
  return r + '</tr>\n';
}

function buildHtml(testType, timestamp, success, thresholds, key, checks) {
  let thresholdRows = '';
  const names = Object.keys(thresholds);
  if (names.length === 0) {
    thresholdRows = '      <tr><td colspan="3">no threshold results in summary payload</td></tr>\n';
  }
  for (let i = 0; i < names.length; i++) {
    const exprs = Object.keys(thresholds[names[i]]);
    for (let j = 0; j < exprs.length; j++) {
      const ok = thresholds[names[i]][exprs[j]];
      thresholdRows += rowHtml([names[i], exprs[j], ok ? 'PASS' : 'FAIL'], false);
    }
  }
  let checkRows = '';
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    checkRows += rowHtml(
      [c.name, String(c.passes), String(c.fails), c.fails === 0 ? 'PASS' : 'FAIL'],
      false,
    );
  }
  return (
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n` +
    `<meta charset="utf-8">\n<title>k6 ${escHtml(testType)} report</title>\n` +
    `<style>body{font-family:sans-serif;margin:2em}table{border-collapse:collapse;margin-bottom:2em}` +
    `th,td{border:1px solid #999;padding:.4em .8em;text-align:left}th{background:#eee}</style>\n` +
    `</head>\n<body>\n` +
    `<h1>k6 ${escHtml(testType)} report</h1>\n` +
    `<p>Executed at (UTC): ${escHtml(timestamp)}</p>\n` +
    `<p>Overall result: ${escHtml(verdictText(success))}</p>\n` +
    `<h2>Key metrics</h2>\n<table>\n` +
    rowHtml(['Metric', 'Value'], true) +
    rowHtml(['HTTP requests', key.httpReqs], false) +
    rowHtml(['Failed request rate', key.failedRate], false) +
    rowHtml(['Response time p95 (ms)', key.p95], false) +
    rowHtml(['Response time avg (ms)', key.avg], false) +
    rowHtml(['Check pass rate', key.checkRate], false) +
    `</table>\n<h2>Thresholds</h2>\n<table>\n` +
    rowHtml(['Metric', 'Expression', 'Result'], true) +
    thresholdRows +
    `</table>\n<h2>Checks</h2>\n<table>\n` +
    rowHtml(['Check', 'Passes', 'Fails', 'Result'], true) +
    checkRows +
    `</table>\n</body>\n</html>\n`
  );
}

function fmtRate(v) {
  if (typeof v !== 'number') {
    return null;
  }
  return `${(v * 100).toFixed(2)}%`;
}

function fmtMs(v) {
  if (typeof v !== 'number') {
    return null;
  }
  return v.toFixed(2);
}

function verdictText(success) {
  if (success === true) {
    return 'PASS — all thresholds held';
  }
  if (success === false) {
    return 'FAIL — one or more thresholds failed';
  }
  return 'UNKNOWN — no threshold results in summary payload';
}

// Shared handleSummary body. Returns the k6 file map; the default console
// summary still prints to stdout.
export function buildSummary(data, testType) {
  const timestamp = new Date().toISOString();
  const metrics = (data && data.metrics) || {};
  const checks = collectChecks(data && data.root_group, []);
  const thresholds = collectThresholds(metrics);

  const httpReqs = num(metrics, 'http_reqs', 'count');
  const failedRate = num(metrics, 'http_req_failed', 'rate');
  const p95 = num(metrics, 'http_req_duration', 'p(95)');
  const avg = num(metrics, 'http_req_duration', 'avg');
  let checkPasses = 0;
  let checkTotal = 0;
  for (let i = 0; i < checks.length; i++) {
    checkPasses += checks[i].passes;
    checkTotal += checks[i].passes + checks[i].fails;
  }

  const key = {
    httpReqs: httpReqs,
    failedRate: fmtRate(failedRate),
    p95: fmtMs(p95),
    avg: fmtMs(avg),
    checkRate: checkTotal > 0 ? fmtRate(checkPasses / checkTotal) : null,
  };

  // Overall verdict: AND of all threshold results. null when the payload
  // carries no threshold results — unknown must never read as success.
  let success = null;
  const thresholdNames = Object.keys(thresholds);
  if (thresholdNames.length > 0) {
    success = true;
    for (let i = 0; i < thresholdNames.length; i++) {
      const exprs = Object.keys(thresholds[thresholdNames[i]]);
      for (let j = 0; j < exprs.length; j++) {
        if (!thresholds[thresholdNames[i]][exprs[j]]) {
          success = false;
        }
      }
    }
  }

  const prefix = `reports/${testType}-summary`;
  return {
    [`${prefix}.json`]: JSON.stringify(
      {
        testType: testType,
        timestamp: timestamp,
        success: success,
        thresholds: thresholds,
        keyMetrics: key,
        checks: checks,
        metrics: metrics,
      },
      null,
      2,
    ),
    [`${prefix}.xml`]: buildJunit(testType, timestamp, checks, thresholds),
    [`${prefix}.html`]: buildHtml(testType, timestamp, success, thresholds, key, checks),
  };
}
