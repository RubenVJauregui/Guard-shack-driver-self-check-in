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
assert(index.includes('app.js?v=strictet21'), 'index.html must load cache-busted app.js?v=strictet21');
assert(index.includes('styles.css?v=strictet21'), 'index.html must load cache-busted styles.css?v=strictet21');




// UNIS driver shortcut lock.
assert(index.includes('id="unisDriversBtn"') && index.includes('Unis Drivers press here'), 'Unis Drivers button must appear under prechecked-in button');
assert(index.indexOf('id="preCheckedInBtn"') < index.indexOf('id="unisDriversBtn"'), 'Unis Drivers button must appear below Already Pre-Checked In button');
assert(app.includes('UNIS_DRIVER_DOCK_93: "Please proceed to dock 93"'), 'UNIS driver dock 93 message must be locked');
assert(app.includes('showImmediateTaskInstructionScreen(DRIVER_INSTRUCTIONS.UNIS_DRIVER_DOCK_93)'), 'UNIS driver button must show dock 93 instruction screen');

// Entry task and load-details screen lock.
assert(index.includes('<select name="entryTask" id="entryTaskSelect" required>'), 'entry task dropdown must be required');
assert(index.includes('<option value="" selected disabled hidden></option>'), 'entry task dropdown must start blank');
assert(index.indexOf('<option value="" selected disabled hidden></option>') < index.indexOf('<option>Live Offload</option>'), 'blank entry task option must come before Live Offload');
const step3Start = index.indexOf('data-screen="3"');
const step4Start = index.indexOf('data-screen="4"');
const step5Start = index.indexOf('data-screen="5"');
const step3Html = index.slice(step3Start, step4Start);
const step4Html = index.slice(step4Start, step5Start);
assert(step3Html.includes('Choose your entry task'), 'Step 3 must show Choose your entry task');
assert(!step3Html.includes('PO / RN / Load #') && !step3Html.includes('Comments') && !step3Html.includes('BOL / Load / Seal Picture'), 'Step 3 must show only the entry task selection, not load detail fields');
assert(step4Html.includes('PO / RN / Load # / DN') && step4Html.includes('Comments') && step4Html.includes('BOL / Load / Seal Picture'), 'Step 4 must contain the load detail fields for non-immediate tasks');
assert(index.includes('class="screen complete-screen" data-screen="6"'), 'Complete screen must be data-screen 6 after adding Load Details screen');
assert(app.includes('function isImmediateInstructionTask()'), 'app must detect immediate instruction tasks');
assert(app.includes('showImmediateTaskInstructionScreen(getImmediateTaskInstruction())'), 'immediate instruction tasks must show their message on the next screen');
assert(app.includes('if (currentScreen === 4)'), 'load detail validation must happen on Step 4');
assert(app.includes('function updateLoginModeRequirements()'), 'first-screen login mode must update required fields so Continue works');
assert(app.includes('Continue failed'), 'Continue handler must surface unexpected click errors instead of appearing dead');
assert(app.includes('phoneInput.required = !apptMode'), 'phone must only be required in phone login mode');
assert(app.includes('appointmentInput.required = Boolean(apptMode)') && app.includes('passcodeInput.required = Boolean(apptMode)'), 'appointment/passcode must only be required in APPT login mode');
assert(app.includes('if (currentScreen === 5)'), 'final submit must happen on review Step 5');

// Driver form field lock.
assert(!index.includes('Reference #<input name="referenceNo"'), 'Step 3 must not show a Reference # input box');
assert(!index.includes('name="referenceNo"'), 'Reference # field must not exist in the public form');
assert(index.includes('PO / RN / Load # / DN<input name="loadNo"'), 'Step 3 must show only the PO / RN / Load # box for load reference entry');

// Door routing and assistance lock.

const bannedDriverPhrases = [
  "Assistance Required",
  "Please see the employee",
  "Please see the employee for door assignment",
  "Please see the employee for assistance"
];

for (const phrase of bannedDriverPhrases) {
  assert(!app.includes(phrase), `banned driver-facing phrase must not exist in app.js: ${phrase}`);
  assert(!index.includes(phrase), `banned driver-facing phrase must not exist in index.html: ${phrase}`);
  assert(!identity.includes(phrase), `banned driver-facing phrase must not exist in identity.html: ${phrase}`);
  assert(!readme.includes(phrase), `banned driver-facing phrase must not exist in README.md: ${phrase}`);
}

assert(!compactApp.includes('setCompleteHeader("assistance")'), 'fallback flow must not use assistance header mode');
assert(app.includes('setCompleteHeader("instruction")'), 'fallback flow must use instruction header mode');
assert(app.includes('function setCompleteHeader(mode = "complete")'), 'setCompleteHeader must remain explicit');
assert(app.includes('completeHeading) completeHeading.textContent = DRIVER_INSTRUCTIONS.FALLBACK_DETAIL_165_166'), 'fallback header must show locked docks 165/166 instruction');


const ONLY_ALLOWED_DRIVER_MESSAGES = [
  "Go to the door between docks 165 & 166.",
  "Go to the door at dock 144",
  "Go to the door at Dock 45",
  "Go to Dock 94",
  "Drop off container / trailer at any open spot in the yard",
  "Please proceed to pick up your empty"
];
for (const message of ONLY_ALLOWED_DRIVER_MESSAGES) {
  assert(app.includes(message), `required hardcoded driver message missing: ${message}`);
}
assert(!app.includes('Go to the door between docks 165 & 166",'), 'non-period 165/166 instruction must not remain');
assert(app.includes('const DRIVER_INSTRUCTIONS = Object.freeze({'), 'driver-facing instructions must be locked in one constant object');
assert(app.includes('DEFAULT_165_166: "Go to the door between docks 165 & 166."'), 'normal Excel default door must exactly match the hardcoded docks 165/166 message');
assert(app.includes('const EXCEL_DEFAULT_DOOR = DRIVER_INSTRUCTIONS.DEFAULT_165_166;'), 'default door must come from locked instructions');
assert(app.includes('const ASSISTANCE_DOOR_INSTRUCTION = DRIVER_INSTRUCTIONS.FALLBACK_DETAIL_165_166;'), 'fallback main instruction must be the locked docks 165/166 instruction');
assert(app.includes('const WISE_NOT_FOUND_INSTRUCTION = DRIVER_INSTRUCTIONS.DEFAULT_165_166;'), 'WISE not-found fallback must be locked to docks 165/166');
assert(app.includes('const FALLBACK_AFTER_MAX_ATTEMPTS = WISE_NOT_FOUND_INSTRUCTION;'), 'failed lookup fallback must use WISE not-found instruction');
assert(app.includes('const APP_BUILD_VERSION = "strictet21";'), 'app build version must be strictet21');
assert(app.includes('DOCK_144: "Go to the door at dock 144"'), 'Excel dock 144 mapping must remain');
assert(app.includes('DOCK_45: "Go to the door at Dock 45"'), 'Excel Dock 45 mapping must remain');
assert(app.includes('\"Euromarket / Crate & Barrel\"'), 'Crate & Barrel customer mapping must remain');
assert(app.includes('DOCK_94: "Go to Dock 94"'), 'Crate & Barrel mapping must route to Dock 94');
assert(app.includes('return DRIVER_INSTRUCTIONS.DOCK_94;'), 'Crate & Barrel return must use locked Dock 94 instruction');
assert(!app.includes('return "Go to Dock 70";'), 'Crate & Barrel must no longer route to Dock 70');
assert(!app.includes('DOCK_70'), 'Dock 70 must not be a driver-facing locked instruction');
assert(compactApp.includes('if (!etNumber) { return false; } const doorResult = await getDoorAssignmentWithStaging'), 'client must compute door assignment only after confirmed ET');
assert(!compactApp.includes('showLargeInstructionScreen(EXCEL_DEFAULT_DOOR'), 'failure screens must not use Excel default door');
assert(!compactApp.includes('showLargeInstructionScreen(FALLBACK_AFTER_MAX_ATTEMPTS, "")'), 'failure screens must include detail, not blank detail');
assert(app.includes('FALLBACK_DETAIL_165_166: "Go to the door between docks 165 & 166."'), 'ET failure fallback detail must instruct docks 165/166');
assert(app.includes('showLargeInstructionScreen(FALLBACK_AFTER_MAX_ATTEMPTS, DRIVER_INSTRUCTIONS.FALLBACK_DETAIL_165_166)'), 'ET failure fallback must use locked fallback detail');
assert(app.includes('function showLargeInstructionScreen(message, details = DRIVER_INSTRUCTIONS.FALLBACK_DETAIL_165_166)'), 'default assistance detail must use locked docks 165/166 detail');

// Driver picture upload lock.
assert(index.includes('Picture *'), 'picture label must show upload is required');
assert(index.includes('name="driverPhoto" type="file" accept="image/*" capture="environment" required'), 'driver picture input must be required');
assert(app.includes('const driverPhotoInput = form.elements.driverPhoto;'), 'app must explicitly check that a picture was selected');
assert(app.includes('function validateDriverLicenseImage(file)'), 'picture validation function must remain explicit');
assert(app.includes('finishValidation(true, "Picture accepted.")'), 'any uploaded picture must be accepted');
assert(compactApp.includes('const driverPhotoInput = form.elements.driverPhoto; if (!driverPhotoInput.files || !driverPhotoInput.files.length)'), 'missing picture must be blocked');
assert(!app.includes('clear, ' + 'readable') && !app.includes('clear ' + 'picture') && !app.includes('readable ' + 'picture'), 'photo upload must accept any selected picture without quality gating');
assert(!index.includes('Driver License Picture *'), 'photo label must not imply a strict license photo quality requirement');

// Public ET recovery must be gone.
assert(!app.includes('recoverRecentlyCreatedEt'), 'client ET recovery helper must be removed');
assert(!app.includes('/api/yms-entry-ticket-recover'), 'client must not call public ET recovery endpoint');
assert(!server.includes('/api/yms-entry-ticket-recover'), 'server recovery endpoint must be removed');
assert(!server.includes('recoverYmsEntryTicket'), 'server recovery-by-load helper must be removed');
assert(!server.includes('extractYmsList'), 'server recovery list extractor must be removed');


// DN/order lookup lock.
assert(server.includes('function wmsOrderLookup(keyword, authHeader)'), 'server must search WMS outbound orders/DNs when load lookup misses');
assert(server.includes('/wms-bam/outbound/order/search-by-paging'), 'server must call outbound order search for DN/order/SO lookup');
assert(server.includes('function wmsLookupAny(identifier, authHeader)'), 'server must try load lookup before DN/order lookup');
assert(server.includes('const wmsResult = await wmsLookupAny(rn, `Bearer ${bearerToken}`);'), '/api/wms-lookup must use the combined WMS lookup');
assert(server.includes('matchType: "dn-order"'), 'DN/order matches must be identified in WMS lookup result');

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
assert(db.includes("'dock 45'") && db.includes("'dock 144'") && db.includes("'dock 70'") && db.includes("'dock 94'"), 'Valley View door patterns including Dock 94 must remain classified to LT_F1');
assert(!db.includes("'dock 2'"), 'Dock 2 must not be included in Valley View door classification patterns');

// Drop Off Empty success behavior remains allowed only after ET success.
assert(app.includes('DROP_EMPTY: "Drop off container / trailer at any open spot in the yard"'), 'Drop Off Empty successful completion instruction must remain');
assert(app.includes('PICKUP_EMPTY: "Please proceed to pick up your empty"'), 'Pickup Empty successful completion instruction must remain');

// Server resilience lock.
assert(server.includes('process.on("uncaughtException"') && server.includes('process.on("unhandledRejection"'), 'server must guard uncaught ECONNRESET/aborted errors');
assert(compactServer.includes('req.on("aborted", onAborted);'), 'readBody must handle aborted requests');
assert(compactServer.includes('if (res.writableEnded || res.destroyed) return;'), 'sendJson must skip writes to disconnected responses');

assert(app.includes('return DRIVER_INSTRUCTIONS.DOCK_45;'), 'customers not found on the Excel sheet must route to Dock 45');
assert(app.includes('showLargeInstructionScreen(WISE_NOT_FOUND_INSTRUCTION'), 'WISE not-found path must immediately show docks 165/166');

assert(server.includes('const ADMIN_CHANGE_TOKEN = process.env.ADMIN_CHANGE_TOKEN || "";'), 'ADMIN_CHANGE_TOKEN must be configured as a runtime env var');
assert(server.includes('function requireAdminChangeToken(req, res)'), 'protected dashboard changes must require admin token');
assert(server.includes('if (!requireAdminChangeToken(req, res)) return;'), 'mutating dashboard/check-in routes must enforce admin token');
assert(dashboardJs.includes('X-Admin-Change-Token'), 'dashboard must send admin change token for protected changes');
assert(!app.toLowerCase().includes('recover by load'), 'public ET recovery-by-load marker must not return');
assert(!read('staging-door-config.js').includes('Fontana'), 'staging config must not contain stale Fontana comments');
assert(!read('staging-door-config.js').includes('SharkNinja'), 'staging config must not contain stale SharkNinja comments');

if (process.exitCode) process.exit(process.exitCode);
console.log('Regression guard passed: strict Valley View ET and assistance behavior is locked.');
