const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function assert(condition, message) {
  if (!condition) {
    console.error(`REGRESSION GUARD FAILED: ${message}`);
    process.exitCode = 1;
  }
}

const app = read('app.js');
const server = read('server.js');
const index = read('index.html');
const dashboard = read('dashboard.html');
const pkg = read('package.json');
const compactApp = app.replace(/\s+/g, ' ');
const compactServer = server.replace(/\s+/g, ' ');

// Facility/branding lock: this production app must remain Valley View / LT_F1.
assert(server.includes('process.env.WMS_FACILITY_ID || "LT_F1"'), 'server.js must default WMS_FACILITY_ID to LT_F1 and allow env override');
assert(!server.includes('const WMS_FACILITY_ID = "LT_F22"'), 'server.js must not hardcode LT_F22');
assert(index.includes('Driver Check-In — Valley View'), 'index.html title must remain Valley View');
assert(dashboard.includes('data-facility="LT_F1"'), 'dashboard.html must remain scoped to LT_F1');
assert(!index.includes('Driver Check-In — Lincoln'), 'index.html must not revert to Lincoln title');
assert(!dashboard.includes('data-facility="LT_F22"'), 'dashboard.html must not revert to LT_F22');
assert(!pkg.includes('driver-checkin-lincoln'), 'package metadata must not identify this app as Lincoln');

// Asset cache-busting lock: phones must not keep stale JS/CSS.
assert(index.includes('app.js?v=stabilized1'), 'index.html must load cache-busted app.js?v=stabilized1');
assert(index.includes('styles.css?v=stabilized1'), 'index.html must load cache-busted styles.css?v=stabilized1');

// Door routing lock.
assert(app.includes('const EXCEL_DEFAULT_DOOR = "Go to the door at Dock 45";'), 'unlisted valid WMS customers must default to Dock 45');
assert(app.includes('function getDoorAssignmentWithStaging'), 'Complete flow must include getDoorAssignmentWithStaging helper');
assert(compactApp.includes('return { assignment: getDoorAssignment(customerValue), source: "excel", stagedLocation: "" };'), 'getDoorAssignmentWithStaging must return Excel door assignment');
assert(app.includes('"Gurunanda"'), 'Gurunanda must be explicitly mapped in the Dock 45 customer list');
assert(app.includes('"ALL MARKET INC / VITA COCO"') && app.includes('return "Go to the door at dock 144";'), 'Vita Coco/Column D mapping to dock 144 must remain');
assert(app.includes('return "Go to the door between docks 165 & 166";'), 'Column B mapping to docks 165/166 must remain for listed customers only');

// Lookup/complete-flow UX lock.
assert(compactApp.includes('if (rnLookupAttempts >= 3) { showLargeInstructionScreen(FALLBACK_AFTER_MAX_ATTEMPTS'), 'third failed lookup must use large instruction screen');
assert(compactApp.includes('if (fallbackResult?.customer) { const doorResult = await getDoorAssignmentWithStaging'), 'valid-load ET submit fallback must still use WMS customer door assignment');
assert(compactApp.includes('showLargeInstructionScreen(doorResult.assignment, "Load was found in WMS, but ET could not be created.'), 'valid-load ET fallback must show large instruction screen, not inline red error');

// Drop Off Empty behavior lock: never show dock/door fallback for empty drop-off submit failures.
assert(compactApp.includes('nextBtn.textContent = "Complete"; if (isDropOffEmpty()) { showLargeInstructionScreen("Drop off container / trailer at any open spot in the yard"'), 'Drop Off Empty submit fallback must show yard open-spot instruction as a large screen');
assert(compactApp.includes('if (isDropOffEmpty()) { buildReview(); showScreen(currentScreen + 1);'), 'Drop Off Empty must skip PO/RN/Load validation');
assert(app.includes('doorInstruction.textContent = "Drop off container / trailer at any open spot in the yard";'), 'Drop Off Empty completion screen must show yard open-spot instruction');

// Final screen QR/ET/RN lock for successful normal check-ins.
assert(compactApp.includes('identityQr.src = `https://api.qrserver.com/v1/create-qr-code/'), 'successful normal check-ins must generate QR code');
assert(compactApp.includes('etNumberEl.textContent = `ET# ${etNumber}`;'), 'successful normal check-ins must display ET number');
assert(compactApp.includes('rnNumberEl.textContent = rnValue ? `RN# ${rnValue}` : "RN# Not provided";'), 'successful normal check-ins must display RN/load number');

// Server resilience lock: phone disconnects must not crash Node after ET creation.
assert(server.includes('process.on("uncaughtException"') && server.includes('process.on("unhandledRejection"'), 'server must guard uncaught ECONNRESET/aborted errors');
assert(compactServer.includes('req.on("aborted", onAborted);'), 'readBody must handle aborted requests');
assert(compactServer.includes('if (res.writableEnded || res.destroyed) return;'), 'sendJson must skip writes to disconnected responses');

if (process.exitCode) process.exit(process.exitCode);
console.log('Regression guard passed: stabilized Valley View check-in app behavior is locked.');
