// Staging-location-to-door mapping configuration for Valley View (LT_F1).
// Operations can update this file to change door assignments based on where loads are staged.
//
// How it works:
// 1. The app looks up the WISE load inventory for the load ID.
// 2. Each inventory row has a locationId; locations are resolved to get type/name/category.
// 3. If the location type is DOCK, the driver goes directly to that dock door.
// 4. If the location type is STAGING (or other warehouse type), this mapping is checked.
// 5. If no mapping matches, the app falls back to the locked Valley View door rules.
//
// Mapping format:
//   Each entry has a "pattern" (matched against location name, case-insensitive)
//   and a "door" (driver-facing instruction).
//   Prefix matching uses "startsWith" logic.

const stagingToDoorMapping = [
  // Add Valley View staging-location-to-door rules here as needed.
];

// Inventory statuses that indicate freight is outbound/staged/ready for pickup.
const outboundReadyInventoryStatuses = [
  "PICKED",
  "PACKED",
  "STAGED",
  "LOADED",
  "ALLOCATED",
  "AVAILABLE"
];

if (typeof module !== "undefined") {
  module.exports = { stagingToDoorMapping, outboundReadyInventoryStatuses };
}
