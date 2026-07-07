#!/usr/bin/env node
// Regression test: Lincoln-only validation
// Fails if Valley View / LT_F1 / Dock 45 / non-Lincoln customers appear in Lincoln door rules or DB filtering.

const fs = require('fs');
const path = require('path');

let failures = 0;

function assert(condition, msg) {
  if (!condition) { console.error(`FAIL: ${msg}`); failures++; }
  else { console.log(`PASS: ${msg}`); }
}

// 1. app.js must NOT contain Valley View / Dock 45 / Dock 144 / Dock 70 / Dock 165 references in door routing
const appJs = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
assert(!appJs.includes('Dock 45'), 'app.js does not reference Dock 45');
assert(!appJs.includes('dock 144'), 'app.js does not reference dock 144');
assert(!appJs.includes('Dock 70'), 'app.js does not reference Dock 70');
assert(!appJs.includes('docks 165'), 'app.js does not reference docks 165');
assert(!appJs.includes('docks 166'), 'app.js does not reference docks 166');
assert(!appJs.includes('Valley View'), 'app.js does not reference Valley View');
assert(!appJs.includes('KARAKA'), 'app.js does not include KARAKA customer');
assert(!appJs.includes('GURUNANDA') && !appJs.includes('Gurunanda'), 'app.js does not include GURUNANDA customer');
assert(!appJs.includes('SIMPLE MODERN'), 'app.js does not include SIMPLE MODERN customer');
assert(!appJs.includes('NZXT'), 'app.js does not include NZXT customer');
assert(!appJs.includes('door45Customers'), 'app.js does not have door45Customers array');
assert(!appJs.includes('door144Customers'), 'app.js does not have door144Customers array');
assert(!appJs.includes('door70Customers'), 'app.js does not have door70Customers array');
assert(!appJs.includes('doorBetween165_166'), 'app.js does not have doorBetween165_166 array');

// 2. app.js MUST contain Lincoln door rules
assert(appJs.includes('docks98_97Customers') || appJs.includes('docks 98 & 97'), 'app.js has Lincoln docks 98 & 97 rule');
assert(appJs.includes('docks75_74Customers') || appJs.includes('docks 75 & 74'), 'app.js has Lincoln docks 75 & 74 rule');
assert(appJs.includes('docks56_55Customers') || appJs.includes('docks 56 & 55'), 'app.js has Lincoln docks 56 & 55 rule');
assert(appJs.includes('LINCOLN_DEFAULT_DOOR'), 'app.js uses LINCOLN_DEFAULT_DOOR constant');

// 3. db.js classifyFacility rejects Dock 45 and non-Lincoln customers
const dbJs = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
assert(dbJs.includes("'dock 45'"), 'db.js NON_LINCOLN_DOOR_PATTERNS includes dock 45');
assert(dbJs.includes("'dock 144'"), 'db.js NON_LINCOLN_DOOR_PATTERNS includes dock 144');
assert(dbJs.includes("'dock 70'"), 'db.js NON_LINCOLN_DOOR_PATTERNS includes dock 70');
assert(dbJs.includes("KARAKA"), 'db.js rejects KARAKA customer');
assert(dbJs.includes("GURUNANDA"), 'db.js rejects GURUNANDA customer');
assert(dbJs.includes("SIMPLE MODERN"), 'db.js rejects SIMPLE MODERN customer');
assert(dbJs.includes("NZXT"), 'db.js rejects NZXT customer');
assert(dbJs.includes("lincolnDashboardWhere"), 'db.js has lincolnDashboardWhere function');
assert(dbJs.includes("NOT ILIKE '%Dock 45%'"), 'db.js dashboard WHERE excludes Dock 45');
assert(dbJs.includes("NOT ILIKE '%dock 144%'"), 'db.js dashboard WHERE excludes dock 144');
assert(dbJs.includes("NOT ILIKE '%dock 70%'"), 'db.js dashboard WHERE excludes dock 70');

// 4. dashboard.html must not contain Valley View or LT_F1 references
const dashHtml = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
assert(!dashHtml.includes('Valley View'), 'dashboard.html does not reference Valley View');
assert(!dashHtml.includes('LT_F1'), 'dashboard.html does not reference LT_F1');
assert(dashHtml.includes('LT_F22') || dashHtml.includes('Lincoln'), 'dashboard.html references Lincoln/LT_F22');

// 5. Facility ID hardcoded to LT_F22
const serverJs = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
assert(serverJs.includes('"LT_F22"'), 'server.js has LT_F22 facility ID');
assert(!serverJs.includes('WMS_FACILITY_ID = "LT_F1"'), 'server.js does not default to LT_F1');

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures > 0 ? 1 : 0);
