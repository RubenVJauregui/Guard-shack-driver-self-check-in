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

// Facility/branding lock: this production app must remain Lincoln / LT_F22.
assert(server.includes('process.env.WMS_FACILITY_ID || "LT_F22"'), 'server.js must default WMS_FACILITY_ID to LT_F22 and allow env override');
assert(!server.includes('const WMS_FACILITY_ID = "LT_F22"'), 'server.js must not hardcode LT_F22');
assert(index.includes('Driver Check-In — Lincoln'), 'index.html title must remain Lincoln');
assert(dashboard.includes('data-facility="LT_F22"'), 'dashboard.html must remain scoped to LT_F22');
assert(!index.includes('Driver Check-In — Lincoln'), 'index.html must not revert to Lincoln title');
assert(!dashboard.includes('data-facility="LT_F22"'), 'dashboard.html must not revert to LT_F22');
assert(!pkg.includes('driver-checkin-lincoln'), 'package metadata must not identify this app as Lincoln');

// Asset cache-busting lock: phones must not keep stale JS/CSS.
assert(index.includes('app.js?v=etlock2'), 'index.html must load cache-busted app.js?v=etlock2');
assert(index.includes('styles.css?v=etlock2'), 'index.html must load cache-busted styles.css?v=etlock2');

// Door routing lock.
assert(app.includes('const EXCEL_DEFAULT_DOOR = "Go to the door between docks 165 & 166";'), 'unlisted/fallback messages must use Excel row 1 Column B');
assert(app.includes('function getDoorAssignmentWithStaging'), 'Complete flow must include getDoorAssignmentWithStaging helper');
assert(compactApp.includes('return { assignment: getDoorAssignment(customerValue), source: "excel", stagedLocation: "" };'), 'getDoorAssignmentWithStaging must return Excel door assignment');
assert(app.includes('"Gurunanda"'), 'Gurunanda must be explicitly mapped in the Dock 45 customer list');
assert(app.includes('"ALL MARKET INC / VITA COCO"') && app.includes('return "Go to the door at dock 144";'), 'Vita Coco/Column D mapping to dock 144 must remain');
assert(app.includes('return "Go to the door between docks 165 & 166";'), 'Column B mapping to docks 165/166 must remain for listed customers only');

// Lookup/complete-flow UX lock.
assert(app.includes('setCompleteHeader("assistance")'), 'assistance fallback screen must not say Check in complete');
assert(app.includes('const FALLBACK_AFTER_MAX_ATTEMPTS = "Please see the employee for assistance";'), 'third failed lookup must show assistance, not door assignment');
assert(compactApp.includes('if (rnLookupAttempts >= 3) { showLargeInstructionScreen(FALLBACK_AFTER_MAX_ATTEMPTS'), 'third failed lookup must use large instruction screen');
assert(compactApp.includes('showLargeInstructionScreen(FALLBACK_AFTER_MAX_ATTEMPTS, "")'), 'all fallback instruction messages must use Excel row 1 text only');
assert(!compactApp.includes('showLargeInstructionScreen(FALLBACK_AFTER_MAX_ATTEMPTS, "Load was found in WMS'), 'ET fallback must not display non-Excel-row message text');
assert(!compactApp.includes('showLargeInstructionScreen(FALLBACK_AFTER_MAX_ATTEMPTS, "PO / RN / Load was not found'), 'failed lookup fallback must not display non-Excel-row message text');

// ET creation lock: no completed check-in or dock assignment without confirmed server-created ET.
assert(server.includes('if (req.method === "POST" && url.pathname === "/api/yms-entry-ticket")'), 'server must expose /api/yms-entry-ticket');
assert(server.includes('sendJson(res, { ok: true, etNumber'), 'server YMS ET endpoint must return ok true plus etNumber');
assert(server.includes('function findEtNumber') && server.includes('entryId') && server.includes('entryNo') && server.includes('entryNumber') && server.includes('etNumber') && server.includes('ticketNo'), 'server must normalize nested ET number fields');
assert(server.includes('YMS did not return an ET number'), 'server must fail clearly when YMS returns no ET number');
assert(server.includes('temporary create failure, retrying once'), 'server must retry temporary YMS ET creation failures once');
assert(server.includes('const ymsEtBySubmissionSignature = new Map();'), 'server must cache ETs by exact idempotency signature');
assert(server.includes('idempotencyKey') && server.includes('ymsEtBySubmissionSignature.has(idempotencyKey)'), 'server must reuse ET only by exact idempotency key');
assert(compactApp.includes('idempotencyKey: duplicateEtSignature'), 'client must send exact submission idempotency key to server');
assert(compactApp.includes('if (etRes.ok && etData.ok === true && etData.etNumber)'), 'client must require ok true and etNumber before completion');
assert(compactApp.includes('if (!etNumber) { return false; } const doorResult = await getDoorAssignmentWithStaging'), 'client must compute door assignment only after confirmed ET');
assert(!compactApp.includes('await recoverRecentlyCreatedEt({ loadId:'), 'client must not recover/reuse ET by load alone');

// Drop Off Empty behavior lock.
assert(compactApp.includes('nextBtn.textContent = "Complete"; if (isDropOffEmpty()) { showLargeInstructionScreen("Drop off container / trailer at any open spot in the yard"'), 'Drop Off Empty submit fallback must show yard open-spot instruction as a large screen');
assert(compactApp.includes('if (isDropOffEmpty()) { buildReview(); showScreen(currentScreen + 1);'), 'Drop Off Empty must skip PO/RN/Load validation');
assert(app.includes('doorInstruction.textContent = "Drop off container / trailer at any open spot in the yard";'), 'Drop Off Empty completion screen must show yard open-spot instruction');

// Final screen QR/ET/RN lock for successful normal check-ins.
assert(compactApp.includes('identityQr.src = `https://api.qrserver.com/v1/create-qr-code/'), 'successful normal check-ins must generate QR code');
assert(compactApp.includes('etNumberEl.textContent = `ET# ${etNumber}`;'), 'successful normal check-ins must display ET number');
assert(compactApp.includes('rnNumberEl.textContent = rnValue ? `RN# ${rnValue}` : "RN# Not provided";'), 'successful normal check-ins must display RN/load number');

// Server resilience lock.
assert(server.includes('process.on("uncaughtException"') && server.includes('process.on("unhandledRejection"'), 'server must guard uncaught ECONNRESET/aborted errors');
assert(compactServer.includes('req.on("aborted", onAborted);'), 'readBody must handle aborted requests');
assert(compactServer.includes('if (res.writableEnded || res.destroyed) return;'), 'sendJson must skip writes to disconnected responses');

if (process.exitCode) process.exit(process.exitCode);
console.log('Regression guard passed: stabilized Lincoln check-in app behavior is locked.');
