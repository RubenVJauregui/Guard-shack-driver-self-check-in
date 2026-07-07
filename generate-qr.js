const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

const url = process.argv[2];
if (!url) {
  console.error("Usage: node generate-qr.js <deployed-url>");
  console.error("Example: node generate-qr.js https://driver-checkin-4178-49c078.coolify.item.pub");
  process.exit(1);
}

const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=16&format=png&data=${encodeURIComponent(url)}`;
const outFile = path.join(__dirname, "valley-view-checkin-qr.png");

console.log(`Generating QR code for: ${url}`);
console.log(`Output: ${outFile}`);

const file = fs.createWriteStream(outFile);
https.get(qrApiUrl, (res) => {
  if (res.statusCode !== 200) {
    console.error(`QR API returned status ${res.statusCode}`);
    process.exit(1);
  }
  res.pipe(file);
  file.on("finish", () => {
    file.close();
    console.log("QR code saved successfully.");
  });
}).on("error", (err) => {
  fs.unlinkSync(outFile);
  console.error(`Failed to generate QR: ${err.message}`);
  process.exit(1);
});
