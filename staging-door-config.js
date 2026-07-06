// Staging-location-to-door mapping configuration.
// Operations can update this file to change door assignments based on where loads are staged.
//
// How it works:
// 1. When a load is looked up, inventory records are queried by loadId.
// 2. Each inventory row has a locationId; locations are resolved to get type/name/category.
// 3. If the location type is DOCK, the driver goes directly to that dock door.
// 4. If the location type is STAGING (or other warehouse type), this mapping is checked.
// 5. If no mapping matches, fall back to customer-based Excel rules.
//
// Mapping format:
//   Each entry has a "pattern" (matched against location name, case-insensitive)
//   and a "door" (the driver-facing door instruction).
//   Patterns are checked in order; first match wins.
//   Use "*" as a wildcard segment. Prefix matching uses "startsWith" logic.

const stagingToDoorMapping = [
  // Example: staging locations starting with "STG-A" route to Door 45
  // { pattern: "STG-A", door: "Go to Door 45" },
  // Example: staging locations starting with "STG-B" route to dock 165-166
  // { pattern: "STG-B", door: "Go to the door between docks 165 & 166" },
  // Example: exact location name
  // { pattern: "STAGING-DOCK-12", door: "Go to Door 12" },
];

// Inventory statuses that indicate freight is outbound/staged/ready for pickup.
// Only inventory rows with these statuses are considered for door assignment.
const outboundActiveStatuses = ["PICKED", "PACKED", "LOADED", "OPEN"];

// Inventory statuses to exclude (canceled/shipped/unavailable).
const excludedStatuses = ["SHIPPED", "ADJUSTOUT", "DAMAGE"];

module.exports = { stagingToDoorMapping, outboundActiveStatuses, excludedStatuses };
