const fs = require('fs');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

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

// Facility/branding lock: this production app must remain Valley View / LT_F1.
assert(server.includes('process.env.WMS_FACILITY_ID || "LT_F1"'), 'server.js must default WMS_FACILITY_ID to LT_F1 and allow env override');
assert(!server.includes('const WMS_FACILITY_ID = "LT_F22"'), 'server.js must not hardcode LT_F22');
assert(index.includes('Driver Check-In — Valley View'), 'index.html title must remain Valley View');
assert(dashboard.includes('data-facility="LT_F1"'), 'dashboard.html must remain scoped to LT_F1');
assert(!index.includes('Driver Check-In — Lincoln'), 'index.html must not revert to Lincoln title');
assert(!dashboard.includes('data-facility="LT_F22"'), 'dashboard.html must not revert to LT_F22');
assert(!pkg.includes('driver-checkin-lincoln'), 'package metadata must not identify this app as Lincoln');

// Drop Off Empty behavior lock: never show dock/door fallback for empty drop-off submit failures.
const compactApp = app.replace(/\s+/g, ' ');
assert(compactApp.includes('nextBtn.textContent = \"Complete\"; if (isDropOffEmpty()) { showLargeInstructionScreen(\"Drop off container / trailer at any open spot in the yard\"'), 'Drop Off Empty submit fallback must show yard open-spot instruction as a large screen');
assert(compactApp.includes('if (isDropOffEmpty()) { buildReview(); showScreen(currentScreen + 1);'), 'Drop Off Empty must skip PO/RN/Load validation');
assert(app.includes('doorInstruction.textContent = "Drop off container / trailer at any open spot in the yard";'), 'Drop Off Empty completion screen must show yard open-spot instruction');

if (process.exitCode) process.exit(process.exitCode);
console.log('Regression guard passed: Valley View facility and Drop Off Empty behavior are locked.');
