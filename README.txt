Driver Check-In 4178 Upload Package

Run locally:
node server.js

Default URL:
http://127.0.0.1:4178/

For another device to scan the QR code, run this on a machine reachable from that device. The server automatically uses the machine LAN IP in generated QR links when accessed from localhost.

Files:
- index.html: driver check-in app
- app.js: check-in flow, door assignment, QR generation
- identity.html: QR destination page
- identity.js: identity confirmation page logic
- styles.css: shared styles
- server.js: static server and identity record API
- identity-records/: runtime storage for generated identity records
