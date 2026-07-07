const fs = require('fs');
const path = require('path');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function assert(condition, message) {
  if (!condition) {
    console.error(`REGRESSION GUARD FAILED: ${message}`);
    process.exitCode = 1;
  }
}
function exists(file) { return fs.existsSync(file); }

const app = read('app.js');
const server = read('server.js');
const db = read('db.js');
const index = read('index.html');
const dashboard = read('dashboard.html');
const dashboardJs = read('dashboard.js');
const identity = read('identity.html');
const qr = read('generate-qr.js');
const readme = read('README.md');
const pkg = read('package.json');
const compactApp = app.replace(/\s+/g, ' ');
const compactServer = server.replace(/\s+/g, ' ');

// Valley View / LT_F1 lock.
assert(server.includes('process.env.WMS_FACILITY_ID || "LT_F1"'), 'server.js must default WMS_FACILITY_ID to LT_F1 and allow env override');
assert(!server.includes('const WMS_FACILITY_ID = "LT_F22"'), 'server.js must not hardcode LT_F22');
assert(index.includes('Driver Check-In — Valley View'), 'index.html title must remain Valley View');
assert(dashboard.includes('data-facility="LT_F1"'), 'dashboard.html must remain scoped to LT_F1');
assert(identity.includes('Driver Identity — Valley View'), 'identity page title must say Valley View');
assert(qr.includes('valley-view-checkin-qr.png'), 'QR generator must output valley-view-checkin-qr.png');
assert(readme.includes('Valley View') && readme.includes('LT_F1'), 'README must identify Valley View / LT_F1');
assert(!readme.includes('Lincoln') && !identity.includes('Lincoln') && !dashboard.includes('Lincoln') && !dashboardJs.includes('Lincoln') && !qr.includes('lincoln'), 'labels must not mention Lincoln');
assert(!pkg.includes('driver-checkin-lincoln'), 'package metadata must not identify this app as Lincoln');
assert(!exists('test-lincoln-only.js'), 'test-lincoln-only.js must not exist');
assert(!exists('lincoln-checkin-qr.png'), 'lincoln-checkin-qr.png must not exist');

// Asset cache-busting lock.
assert(index.includes('app.js?v=strictet2'), 'index.html must load cache-busted app.js?v=strictet2');
assert(index.includes('styles.css?v=strictet2'), 'index.html must load cache-busted styles.css?v=strictet2');


// Driver form field lock.
assert(!index.includes('Reference #<input name="referenceNo"'), 'Step 3 must not show a Reference # input box');
assert(!index.includes('name="referenceNo"'), 'Reference # field must not exist in the public form');
assert(index.includes('PO / RN / Load #<input name="loadNo"'), 'Step 3 must show only the PO / RN / Load # box for load reference entry');

// Door routing and assistance lock.
assert(app.includes('const EXCEL_DEFAULT_DOOR = "Go to the door between docks 165 & 166";'), 'normal Excel default door must remain docks 165/166');
assert(app.includes('const ASSISTANCE_DOOR_INSTRUCTION = "Please see the employee for door assignment";'), 'assistance instruction constant must exist');
assert(app.includes('const FALLBACK_AFTER_MAX_ATTEMPTS = ASSISTANCE_DOOR_INSTRUCTION;'), 'failed lookup fallback must use assistance instruction');
assert(app.includes('return "Go to the door at dock 144";'), 'Excel dock 144 mapping must remain');
assert(app.includes('return "Go to the door at Dock 45";'), 'Excel Dock 45 mapping must remain');
assert(app.includes('return "Go to Dock 70";'), 'Excel Dock 70 mapping must remain');
assert(compactApp.includes('if (!etNumber) { return false; } const doorResult = await getDoorAssignmentWithStaging'), 'client must compute door assignment only after confirmed ET');
assert(!compactApp.includes('showLargeInstructionScreen(EXCEL_DEFAULT_DOOR'), 'failure screens must not use Excel default door');
assert(!compactApp.includes('showLargeInstructionScreen(FALLBACK_AFTER_MAX_ATTEMPTS, "")'), 'failure screens must include assistance detail, not blank detail');
assert(!compactApp.includes('showLargeInstructionScreen(FALLBACK_AFTER_MAX_ATTEMPTS, "Load was found in WMS'), 'ET fallback must not display dock-related WMS-found fallback');

// Driver license photo validation lock.
assert(app.includes('driverPhotoValidated = false') && app.includes('driverPhotoValidated = accepted'), 'driverPhotoValidated state must be maintained');
assert(app.includes('driverPhotoValidating || !driverPhotoValidated'), 'driver photo validation must block progression until accepted');
assert(app.includes('Please upload a clear, readable picture of your driver license before continuing.'), 'driver photo validation error copy must be present');

// Public ET recovery must be gone.
assert(!app.includes('recoverRecentlyCreatedEt'), 'client ET recovery helper must be removed');
assert(!app.includes('/api/yms-entry-ticket-recover'), 'client must not call public ET recovery endpoint');
assert(!server.includes('/api/yms-entry-ticket-recover'), 'server recovery endpoint must be removed');
assert(!server.includes('recoverYmsEntryTicket'), 'server recovery-by-load helper must be removed');
assert(!server.includes('extractYmsList'), 'server recovery list extractor must be removed');

// Strict ET creation lock.
assert(server.includes('if (req.method === "POST" && url.pathname === "/api/yms-entry-ticket")'), 'server must expose /api/yms-entry-ticket');
assert(server.includes('sendJson(res, { ok: true, etNumber'), 'server YMS ET endpoint must return ok true plus etNumber');
assert(server.includes('function findEtNumber') && server.includes('entryId') && server.includes('entryNo') && server.includes('entryNumber') && server.includes('etNumber') && server.includes('ticketNo'), 'server must normalize nested ET number fields');
assert(server.includes('YMS did not return an ET number'), 'server must fail clearly when YMS returns no ET number');
assert(server.includes('temporary create failure, retrying once'), 'server must retry temporary YMS ET creation failures once');
assert(server.includes('const ymsEtBySubmissionSignature = new Map();'), 'server must cache ETs by exact idempotency signature');
assert(compactApp.includes('idempotencyKey: duplicateEtSignature'), 'client must send exact submission idempotency key to server');
assert(compactApp.includes('if (etRes.ok && etData.ok === true && etData.etNumber)'), 'client must require ok true and etNumber before completion');

// DB Valley View classification lock.
assert(db.includes("facility_id TEXT DEFAULT 'LT_F1'") && db.includes("facility_name TEXT DEFAULT 'Valley View'"), 'DB defaults must be LT_F1 / Valley View');
assert(db.includes("facility_id = ?')") || db.includes("facility_id = ?"), 'dashboard query must filter by facility');
assert(!db.includes("door_assignment ILIKE '%165%'") && !db.includes("door_assignment ILIKE '%166%'"), 'DB migration must not quarantine docks 165/166');
assert(db.includes("'dock 45'") && db.includes("'dock 144'") && db.includes("'dock 70'") && db.includes("'dock 2'"), 'Valley View door patterns must remain classified to LT_F1');

// Drop Off Empty success behavior remains allowed only after ET success.
assert(app.includes('doorInstruction.textContent = "Drop off container / trailer at any open spot in the yard";'), 'Drop Off Empty successful completion instruction must remain');

// Server resilience lock.
assert(server.includes('process.on("uncaughtException"') && server.includes('process.on("unhandledRejection"'), 'server must guard uncaught ECONNRESET/aborted errors');
assert(compactServer.includes('req.on("aborted", onAborted);'), 'readBody must handle aborted requests');
assert(compactServer.includes('if (res.writableEnded || res.destroyed) return;'), 'sendJson must skip writes to disconnected responses');

if (process.exitCode) process.exit(process.exitCode);
console.log('Regression guard passed: strict Valley View ET and assistance behavior is locked.');
