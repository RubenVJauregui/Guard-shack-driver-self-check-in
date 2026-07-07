# Driver Self Check-In — Valley View (LT_F1)

Guard shack driver self check-in app for the Valley View facility. Drivers complete a multi-step form (identity, vehicle, load details), the app creates a YMS entry ticket with attached driver/carrier/vehicle/trip data, performs a WMS load lookup for customer resolution, assigns the correct dock door, and generates a QR code for guard scanning.

## Valley View Door Assignment Rules

| Customer Match | Assignment |
|---|---|
| UNIS TRANSPORTATION, ALL MARKET INC / VITA COCO, SAFE CATCH, GALANZ, TCL, SPLENDOR, STRON, KING COFFEE, ZURU, DELMAR | Go to the door between docks 98 & 97 |
| NATUS, STRON, FED EX UPS | Go to the door between docks 75 & 74 |
| SCHINDLER, LIPPERT, NIAGARA BOTTLING LLC-RESIN, MAMMC | Go to the door between docks 56 & 55 |
| All other / unmatched | Go to Dock 98 |

## Running Locally

```bash
npm install
node server.js
```

Default URL: http://127.0.0.1:4178/

## Required Environment Variables

| Variable | Description |
|---|---|
| `WMS_BASE_URL` | WMS API base URL (default: `https://unis.item.com/api`) |
| `WMS_AUTH_TOKEN` | Static WMS bearer token (alternative to username/password login) |
| `WMS_USERNAME` | WMS login username (used if no static token) |
| `WMS_PASSWORD` | WMS login password (plain text) |
| `WMS_PASSWORD_B64` | WMS login password (base64-encoded, takes precedence over plain) |
| `WMS_TENANT_ID` | Tenant ID (default: `LT`) |
| `WMS_FACILITY_ID` | Facility ID (default: `LT_F1`) |
| `YMS_BASE_URL` | YMS API base URL (default: `https://traffic.item.com/api/yms`) |
| `TIMEZONE` | IANA timezone (default: `America/Los_Angeles`) |
| `PORT` | Server port (default: `4178`) |
| `HOST` | Bind address (default: `0.0.0.0`) |

## Deployment Notes

- Deploy behind a reverse proxy (Coolify, nginx, etc.) with HTTPS termination.
- Set all `WMS_*` and `YMS_*` env vars in the deployment platform — the app does not start a mock mode if credentials are missing.
- The app stores identity records on disk under `identity-records/`. Mount a persistent volume if records must survive container restarts.
- After deployment, generate a QR code for the production URL using `generate-qr.js` (see below).

## Generating the Check-In QR Code

Once you know the deployed URL:

```bash
node generate-qr.js https://your-deployed-url.example.com
```

This writes `valley-view-checkin-qr.png` to the project root. Print and post at the Valley View guard shack.

If running without a known production URL, the server logs the LAN IP on startup for local testing.

## Check-In Flow

1. Driver enters phone or appointment credentials.
2. Driver provides name, license, license photo.
3. Driver enters carrier, vehicle, equipment details.
4. Driver selects entry task and enters PO/RN/Load number (required for all tasks except Drop Off Empty).
5. App validates RN against WMS — resolves customer and load ID.
6. Driver reviews and confirms.
7. App creates YMS entry ticket, attaches driver/carrier/vehicle/equipment info, attaches trip/load/customer info from WMS lookup.
8. Completion screen shows door assignment, ET#, RN#, and QR code linking to the identity verification page.

## Identity Page (Guard Scan)

When a guard scans the QR code, the identity page displays:
- ET number
- RN / Load / Pickup
- Driver name
- License number
- Customer
- Door assignment
- Driver license picture

## Inbound Receipt Check-In Support

The Valley View app supports inbound receipts as well as outbound loads. On the Entry Task and Load Details screen, the app checks both fields:

- Reference #
- PO / RN / Load #

Lookup behavior:
1. Try outbound load lookup.
2. If not found, try inbound receipt lookup by Receipt/RN, PO number, BOL/reference, or container number.

Confirmed Valley View inbound example:
- PO: `4700011468`
- Receipt/RN: `RN-6380`
- BOL/reference/container: `0080804544`
- Customer: `ALL MARKET INC / VITA COCO`
- Door assignment: `Go to the door between docks 98 & 97`

## Email Notifications on Driver Check-In

After a successful ET is created, the app sends an email notification to the alert recipients when SMTP is configured in production.

Default recipients:
- Juan.barragan@unisco.com
- Ryan.Morales@unisco.com
- Angela.bryant@unisco.com
- opsteam.valley-view@unisco.com

Required production email settings:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

The check-in response includes `emailNotificationSent` for operational verification.

## Driver Check-Ins Dashboard

Shareable dashboard link after deployment:
`/dashboard.html`

The dashboard stores successful check-ins in PostgreSQL when `DATABASE_URL` is configured. It supports:
- Historical submissions
- Date range, carrier, driver, trailer/container, inbound/outbound, load type, and general search filters
- Full record detail review
- CSV export
- **Edit capability** — operations users can edit any check-in record from the detail panel

### Editing a Check-In

From the dashboard detail modal, click **Edit** to enter edit mode. Editable fields include:
- Driver name, phone, license, email
- Carrier, USDOT/MC
- Vehicle type, plate
- Equipment type, trailer/container number
- Entry task, direction (inbound/outbound)
- Reference, PO/RN/Load, Receipt ID, Load ID, WMS Load #
- Customer, Customer ID, Customer Code
- Door assignment, comments

When saved, the app:
1. Updates the local PostgreSQL record with audit trail (updated_at, updated_by, update_notes).
2. Pushes the updated driver/carrier/vehicle/equipment and trip/load info to the existing YMS entry ticket in WISE 3.0 using the same `basic-info-checkin` and `trip-info-checkin` endpoints used during initial check-in.

The save response shows separate status for local save and WISE update:
- **Both succeeded** — green confirmation.
- **Local saved, WISE failed** — amber warning with explanation. The local record is correct; WISE may need manual verification.
- **Both failed** — red error with guidance.

If the record has no ET number (e.g. older records), WISE update is skipped and clearly noted.

### Edit API

- `GET /api/checkins/:id` — fetch a single check-in record by database ID.
- `PATCH /api/checkins/:id` — update editable fields. Body: `{ fields: { field: value, ... }, updatedBy: "name", updateNotes: "reason" }`. Returns `{ localUpdated, wiseUpdated, message, record }`.

Required database environment variable:
- `DATABASE_URL`
