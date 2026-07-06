const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const nodemailer = require("nodemailer");
const db = require("./db");
const { stagingToDoorMapping, outboundActiveStatuses, excludedStatuses } = require("./staging-door-config");

const root = __dirname;
const dataDir = path.join(root, "identity-records");
const port = Number(process.env.PORT || 4178);
const host = process.env.HOST || "0.0.0.0";

const WMS_BASE_URL = process.env.WMS_BASE_URL || "https://unis.item.com/api";
const WMS_AUTH_TOKEN = process.env.WMS_AUTH_TOKEN || "";
const WMS_USERNAME = process.env.WMS_USERNAME || "";
const WMS_PASSWORD_B64 = process.env.WMS_PASSWORD_B64 || "";
const WMS_PASSWORD_RAW = process.env.WMS_PASSWORD || "";
const WMS_TENANT_ID = "LT";
const WMS_FACILITY_ID = "LT_F22";
const YMS_BASE_URL = process.env.YMS_BASE_URL || "https://traffic.item.com/api/yms";
const TIMEZONE = process.env.TIMEZONE || "America/Los_Angeles";
const OPERATOR_NOTIFICATION_RECIPIENT = process.env.OPERATOR_NOTIFICATION_RECIPIENT || "Juan.barragan@unisco.com";
const ALERT_RECIPIENTS = (process.env.ALERT_RECIPIENTS || "Juan.barragan@unisco.com,Ryan.Morales@unisco.com,Angela.bryant@unisco.com,opsteam.lincoln@unisco.com")
  .split(",")
  .map((email) => email.trim())
  .filter(Boolean);
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || "Lincoln Driver Check-In <no-reply@unisco.com>";

function isEmailEnabled() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && ALERT_RECIPIENTS.length);
}

function formatNotificationLines(etNumber, payload) {
  const driver = payload.driverInfo || {};
  const carrier = payload.carrierInfo || {};
  const vehicle = payload.vehicleInfo || {};
  const equipment = payload.equipmentInfo || {};
  const trip = payload.tripInfo || {};
  return [
    `A driver has completed check-in at Lincoln (LT_F22).`,
    ``,
    `ET#: ${etNumber || ""}`,
    `Type: ${trip.direction === "inbound" ? "Inbound receipt" : "Outbound / yard task"}`,
    `Customer: ${trip.customer || ""}`,
    `Receipt/RN: ${trip.receiptId || ""}`,
    `PO: ${trip.poNo || ""}`,
    `Load: ${trip.loadNo || trip.loadId || ""}`,
    `Reference: ${trip.referenceNo || ""}`,
    ``,
    `Driver: ${driver.driverName || [driver.firstName, driver.lastName].filter(Boolean).join(" ")}`,
    `Phone: ${driver.driverPhone || ""}`,
    `License: ${driver.licenseNumber || ""}`,
    `Carrier: ${carrier.carrierName || ""}`,
    `USDOT/MC: ${carrier.usdotNumber || carrier.mcNumber || ""}`,
    `Vehicle plate: ${vehicle.licensePlate || ""}`,
    `Equipment: ${equipment.equipmentNo || ""} ${equipment.equipmentType || ""}`.trim(),
    `Time: ${new Date().toLocaleString("en-US", { timeZone: TIMEZONE })} ${TIMEZONE}`
  ];
}

async function sendCheckinEmailNotification(etNumber, payload) {
  if (!isEmailEnabled()) {
    console.log("[Email notification] SMTP not configured; email not sent.");
    return { sent: false, reason: "smtp_not_configured" };
  }
  const trip = payload.tripInfo || {};
  const subjectParts = ["Lincoln Driver Check-In", etNumber];
  if (trip.receiptId || trip.poNo || trip.loadNo) subjectParts.push(trip.receiptId || trip.poNo || trip.loadNo);
  const subject = subjectParts.filter(Boolean).join(" - ");
  const text = formatNotificationLines(etNumber, payload).join("\n");
  const html = `<pre style="font-family:Arial, sans-serif; white-space:pre-wrap; line-height:1.45;">${escapeHtmlServer(text)}</pre>`;
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  const info = await transporter.sendMail({
    from: SMTP_FROM,
    to: ALERT_RECIPIENTS,
    subject,
    text,
    html
  });
  console.log(`[Email notification] Sent check-in email for ${etNumber} to ${ALERT_RECIPIENTS.join(", ")} messageId=${info.messageId || ""}`);
  return { sent: true, messageId: info.messageId || "" };
}

function escapeHtmlServer(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}


function pickupSummaryFromRecord(record = {}) {
  const type = record.direction === "inbound" ? "inbound receipt" : "outbound / yard move";
  const task = record.entryTask || record.entry_task || "check-in";
  const customer = record.customer ? ` for ${record.customer}` : "";
  const equipment = record.equipmentNo || record.equipment_no ? ` Equipment: ${record.equipmentNo || record.equipment_no}.` : "";
  const refs = [
    record.receiptId || record.receipt_id ? `Receipt/RN ${record.receiptId || record.receipt_id}` : "",
    record.poNo || record.po_no ? `PO ${record.poNo || record.po_no}` : "",
    record.loadNo || record.load_no ? `Load ${record.loadNo || record.load_no}` : "",
    record.referenceNo || record.reference_no ? `Reference ${record.referenceNo || record.reference_no}` : ""
  ].filter(Boolean).join(" / ");
  return `${task} ${type}${customer}.${refs ? ` ${refs}.` : ""}${equipment}`;
}

async function sendStoredCheckinEmailNotification(record = {}) {
  if (!isEmailEnabled()) {
    console.log("[Email notification] SMTP not configured; stored check-in email not sent.");
    return { sent: false, reason: "smtp_not_configured" };
  }

  const checkinLink = record.identityUrl || record.identity_url || process.env.COOLIFY_URL || "https://driver-checkin-4178-49c078.coolify.item.pub";
  const dashboardLink = `${process.env.COOLIFY_URL || "https://driver-checkin-4178-49c078.coolify.item.pub"}/dashboard.html`;
  const doorAssignment = record.doorAssignment || record.door_assignment || "Door assignment not available";
  const summary = pickupSummaryFromRecord(record);
  const driverName = record.driverName || record.driver_name || [record.driverFirstName, record.driverLastName].filter(Boolean).join(" ");
  const etNumber = record.etNumber || record.et_number || "";
  const subject = ["Lincoln Driver Check-In", etNumber, driverName].filter(Boolean).join(" - ");
  const lines = [
    "A driver has completed check-in at Lincoln (LT_F22).",
    "",
    `Check-in link: ${checkinLink}`,
    `Dashboard: ${dashboardLink}`,
    `Dock door assignment: ${doorAssignment}`,
    "",
    `Pickup summary: ${summary}`,
    "",
    `ET#: ${etNumber}`,
    `Driver: ${driverName}`,
    `Phone: ${record.driverPhone || record.driver_phone || ""}`,
    `Carrier: ${record.carrierName || record.carrier_name || ""}`,
    `Trailer / container: ${record.equipmentNo || record.equipment_no || ""}`,
    `Entry task: ${record.entryTask || record.entry_task || ""}`,
    `Direction: ${record.direction || ""}`,
    `Customer: ${record.customer || ""}`,
    `Receipt/RN: ${record.receiptId || record.receipt_id || ""}`,
    `PO: ${record.poNo || record.po_no || ""}`,
    `Load: ${record.loadNo || record.load_no || record.wmsLoadNo || record.wms_load_no || ""}`,
    `Reference: ${record.referenceNo || record.reference_no || ""}`,
    `Comments: ${record.comments || ""}`,
    `Time: ${new Date().toLocaleString("en-US", { timeZone: TIMEZONE })} ${TIMEZONE}`
  ];
  const text = lines.join("\n");
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.45;color:#111">
    <h2 style="margin:0 0 12px">Lincoln Driver Check-In</h2>
    <p><strong>Check-in link:</strong> <a href="${escapeHtmlServer(checkinLink)}">${escapeHtmlServer(checkinLink)}</a></p>
    <p><strong>Dock door assignment:</strong> ${escapeHtmlServer(doorAssignment)}</p>
    <p><strong>Pickup summary:</strong> ${escapeHtmlServer(summary)}</p>
    <hr />
    <pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtmlServer(text)}</pre>
  </div>`;
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  const info = await transporter.sendMail({ from: SMTP_FROM, to: ALERT_RECIPIENTS, subject, text, html });
  console.log(`[Email notification] Sent stored check-in email for ${etNumber || "unknown ET"} to ${ALERT_RECIPIENTS.join(", ")} messageId=${info.messageId || ""}`);
  return { sent: true, messageId: info.messageId || "" };
}


function getWmsPassword() {
  if (WMS_PASSWORD_B64) return Buffer.from(WMS_PASSWORD_B64, "base64").toString("utf8");
  return WMS_PASSWORD_RAW;
}

function getUserIdFromJwt(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return "";
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    // Item IAM tokens store user_id inside a nested "data" claim
    const dataBlock = payload.data || {};
    const candidates = [
      dataBlock.user_id,
      dataBlock.userId,
      payload.user_id,
      payload.userId,
      payload.uid,
      payload.sub,
      payload.id
    ];
    for (const c of candidates) {
      if (c && /^\d{10,}$/.test(String(c))) return String(c);
    }
    // Fallback: return first truthy candidate even if not numeric
    for (const c of candidates) {
      if (c) return String(c);
    }
    return "";
  } catch (_err) {
    return "";
  }
}

let cachedWmsToken = "";
let cachedWmsTokenExpiry = 0;
let cachedWmsUserId = "";
let cachedYmsToken = "";
let cachedYmsTokenExpiry = 0;

async function getWmsBearerToken() {
  if (WMS_AUTH_TOKEN) {
    console.log("[WMS auth] Using static WMS_AUTH_TOKEN");
    cachedWmsUserId = cachedWmsUserId || getUserIdFromJwt(WMS_AUTH_TOKEN);
    if (cachedWmsUserId) {
      console.log(`[WMS auth] userId source=static-token-jwt, isNumeric=${/^\d{10,}$/.test(cachedWmsUserId)}, length=${cachedWmsUserId.length}`);
    }
    return WMS_AUTH_TOKEN;
  }
  const password = getWmsPassword();
  if (!WMS_USERNAME || !password) return "";

  if (cachedWmsToken && Date.now() < cachedWmsTokenExpiry) {
    console.log("[WMS auth] Using cached WMS bearer token");
    return cachedWmsToken;
  }

  console.log("[WMS auth] Logging in via wms-bam/auth/login-by-password...");
  try {
    const token = await wmsPasswordLogin(WMS_USERNAME, password);
    if (token) {
      cachedWmsToken = token;
      cachedWmsTokenExpiry = Date.now() + 50 * 60 * 1000;
      console.log("[WMS auth] WMS token acquired successfully");
      return token;
    }
    console.log("[WMS auth] WMS login returned no token");
    return "";
  } catch (err) {
    console.log(`[WMS auth] WMS login failed: ${err.message}`);
    return "";
  }
}

function wmsPasswordLogin(username, password) {
  return new Promise((resolve, reject) => {
    const loginUrl = new URL(`${WMS_BASE_URL}/wms-bam/auth/login-by-password`);
    const postBody = JSON.stringify({ username, password });
    const mod = loginUrl.protocol === "https:" ? https : http;
    const req = mod.request(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(postBody)
      },
      timeout: 8000
    }, (res) => {
      const statusCode = res.statusCode;
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        console.log(`[WMS auth] login response status=${statusCode}`);
        try {
          const parsed = JSON.parse(body);
          const token = parsed?.data?.accessToken || parsed?.data?.access_token || parsed?.accessToken || parsed?.access_token || parsed?.token || "";
          const userId = parsed?.data?.userId || parsed?.data?.user_id || parsed?.data?.id || parsed?.data?.user?.userId || parsed?.data?.user?.id || parsed?.userId || parsed?.id || getUserIdFromJwt(token) || "";
          if (token) {
            if (userId) {
              cachedWmsUserId = String(userId);
              console.log(`[WMS auth] userId source=login-response, isNumeric=${/^\d{10,}$/.test(cachedWmsUserId)}, length=${cachedWmsUserId.length}`);
            } else {
              console.log("[WMS auth] WARNING: no userId found in login response or JWT");
            }
            resolve(token);
          } else {
            reject(new Error(`No token in response (code=${parsed?.code}, msg=${parsed?.msg || parsed?.message || ""})`));
          }
        } catch (err) {
          reject(new Error(`WMS login parse error: ${err.message}`));
        }
      });
    });
    req.on("error", (err) => reject(err));
    req.on("timeout", () => { req.destroy(); reject(new Error("WMS login timeout")); });
    req.write(postBody);
    req.end();
  });
}

async function getYmsBearerToken() {
  if (cachedYmsToken && Date.now() < cachedYmsTokenExpiry) {
    console.log("[YMS auth] Using cached YMS bearer token");
    return cachedYmsToken;
  }

  const wmsToken = await getWmsBearerToken();
  if (!wmsToken) {
    console.log("[YMS auth] No WMS token available for exchange");
    return "";
  }

  console.log("[YMS auth] Exchanging WMS token for YMS token...");
  try {
    const ymsToken = await exchangeWmsForYms(wmsToken);
    if (ymsToken) {
      cachedYmsToken = ymsToken;
      cachedYmsTokenExpiry = Date.now() + 50 * 60 * 1000;
      console.log("[YMS auth] YMS token acquired successfully");
      return ymsToken;
    }
    console.log("[YMS auth] YMS token exchange returned no token");
    return "";
  } catch (err) {
    console.log(`[YMS auth] YMS token exchange failed: ${err.message}`);
    return "";
  }
}

function exchangeWmsForYms(wmsToken) {
  return new Promise((resolve, reject) => {
    if (!cachedWmsUserId) {
      reject(new Error("No WMS userId available for YMS token exchange"));
      return;
    }

    // YMS expects numeric IAM user ID (e.g. 2008267700036030466)
    const userId = String(cachedWmsUserId);
    if (!/^\d+$/.test(userId)) {
      console.log(`[YMS auth] WARNING: userId "${userId}" is not numeric — YMS may reject it`);
    }

    const exchangeUrl = new URL(`${YMS_BASE_URL}/auth/login-by-wms-token`);
    const postBody = JSON.stringify({ userId, wmsToken });
    const mod = exchangeUrl.protocol === "https:" ? https : http;
    console.log(`[YMS auth] exchange request: userId length=${userId.length}, isNumeric=${/^\d+$/.test(userId)}, bodyLength=${postBody.length}`);
    const req = mod.request(exchangeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${wmsToken}`,
        "X-Tenant-ID": WMS_TENANT_ID,
        "X-Yard-ID": WMS_FACILITY_ID,
        "x-facility-id": WMS_FACILITY_ID,
        "Item-Time-Zone": TIMEZONE,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": String(Buffer.byteLength(postBody))
      },
      timeout: 8000
    }, (res) => {
      const statusCode = res.statusCode;
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        console.log(`[YMS auth] exchange response status=${statusCode}`);
        try {
          const parsed = JSON.parse(body);
          const token = parsed?.data?.accessToken || parsed?.data?.access_token || parsed?.accessToken || parsed?.access_token || parsed?.token || "";
          if (token) {
            resolve(token);
          } else {
            reject(new Error(`No YMS token in response (code=${parsed?.code}, msg=${parsed?.msg || parsed?.message || ""})`));
          }
        } catch (err) {
          reject(new Error(`YMS exchange parse error: ${err.message}`));
        }
      });
    });
    req.on("error", (err) => reject(err));
    req.on("timeout", () => { req.destroy(); reject(new Error("YMS exchange timeout")); });
    req.write(postBody);
    req.end();
  });
}

function createYmsEntryTicket(ymsToken) {
  return new Promise((resolve, reject) => {
    const etUrl = new URL(`${YMS_BASE_URL}/self-check-in/entry-ticket`);
    const mod = etUrl.protocol === "https:" ? https : http;
    const req = mod.request(etUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ymsToken}`,
        "X-Tenant-ID": WMS_TENANT_ID,
        "X-Yard-ID": WMS_FACILITY_ID,
        "x-facility-id": WMS_FACILITY_ID,
        "Item-Time-Zone": TIMEZONE,
        "x-channel": "WEB",
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": "2"
      },
      timeout: 8000
    }, (res) => {
      const statusCode = res.statusCode;
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        console.log(`[YMS ET] create response status=${statusCode}`);
        try {
          const parsed = JSON.parse(body);
          const etNumber = parsed?.data || "";
          if (etNumber && typeof etNumber === "string") {
            console.log(`[YMS ET] Created: ${etNumber}`);
            resolve(etNumber);
          } else {
            reject(new Error(`No ET in response (code=${parsed?.code}, msg=${parsed?.msg || parsed?.message || ""})`));
          }
        } catch (err) {
          reject(new Error(`YMS ET parse error: ${err.message}`));
        }
      });
    });
    req.on("error", (err) => reject(err));
    req.on("timeout", () => { req.destroy(); reject(new Error("YMS ET creation timeout")); });
    req.write("{}");
    req.end();
  });
}

function attachBasicInfo(ymsToken, entryId, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${YMS_BASE_URL}/entry-ticket/basic-info-checkin`);
    const driverInfo = payload.driverInfo || {};
    const carrierInfo = payload.carrierInfo || {};
    const vehicleInfo = payload.vehicleInfo || {};
    const equipmentInfo = payload.equipmentInfo || {};

    const vehicleTypeMap = { "Tractor": "TRACTOR", "Box Truck": "BOX_TRUCK", "Car": "CAR" };
    const equipTypeMap = { "Trailer": "TRAILER", "Container": "CONTAINER", "Chassis": "CHASSIS", "Flatbed": "FLATBED" };

    const postBody = JSON.stringify({
      entryId,
      driverInfo: {
        driverPhone: driverInfo.driverPhone || "",
        firstName: driverInfo.firstName || "",
        lastName: driverInfo.lastName || "",
        driverName: driverInfo.driverName || "",
        licenseNumber: driverInfo.licenseNumber || ""
      },
      carrierInfo: {
        carrierName: carrierInfo.carrierName || "",
        usdotNumber: carrierInfo.usdotNumber || "",
        mcNumber: carrierInfo.mcNumber || ""
      },
      vehicleInfo: {
        licensePlate: vehicleInfo.licensePlate || "",
        vehicleType: vehicleTypeMap[vehicleInfo.vehicleType] || vehicleInfo.vehicleType || "TRACTOR"
      },
      equipmentInfo: {
        equipmentNo: equipmentInfo.equipmentNo || "",
        equipmentType: equipTypeMap[equipmentInfo.equipmentType] || equipmentInfo.equipmentType || "TRAILER",
        sealNumber: equipmentInfo.sealNumber || ""
      }
    });

    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ymsToken}`,
        "X-Tenant-ID": WMS_TENANT_ID,
        "X-Yard-ID": WMS_FACILITY_ID,
        "x-facility-id": WMS_FACILITY_ID,
        "Item-Time-Zone": TIMEZONE,
        "x-channel": "WEB",
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(postBody)
      },
      timeout: 8000
    }, (res) => {
      const statusCode = res.statusCode;
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        console.log(`[YMS ET] basic-info-checkin status=${statusCode}`);
        if (statusCode >= 200 && statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`basic-info-checkin status=${statusCode}`));
        }
      });
    });
    req.on("error", (err) => reject(err));
    req.on("timeout", () => { req.destroy(); reject(new Error("basic-info timeout")); });
    req.write(postBody);
    req.end();
  });
}

function attachTripInfo(ymsToken, entryId, tripInfo) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${YMS_BASE_URL}/entry-ticket/trip-info-checkin`);
    const isInbound = tripInfo.direction === "inbound" || tripInfo.receiptId || tripInfo.poNo;
    const loadIds = tripInfo.loadId ? [tripInfo.loadId] : (tripInfo.loadNo ? [tripInfo.loadNo] : []);
    const receiptIds = tripInfo.receiptId ? [tripInfo.receiptId] : [];

    const postBody = JSON.stringify(isInbound ? {
      entryId,
      inboundTripInfo: {
        customerId: tripInfo.customerId || "",
        receiptIds,
        poNo: tripInfo.poNo || "",
        referenceNo: tripInfo.referenceNo || "",
        note: [tripInfo.receiptId, tripInfo.poNo, tripInfo.referenceNo].filter(Boolean).join(" / ")
      }
    } : {
      entryId,
      outboundTripInfo: {
        customerId: tripInfo.customerId || "",
        loadIds
      }
    });

    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ymsToken}`,
        "X-Tenant-ID": WMS_TENANT_ID,
        "X-Yard-ID": WMS_FACILITY_ID,
        "x-facility-id": WMS_FACILITY_ID,
        "Item-Time-Zone": TIMEZONE,
        "x-channel": "WEB",
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(postBody)
      },
      timeout: 8000
    }, (res) => {
      const statusCode = res.statusCode;
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        console.log(`[YMS ET] trip-info-checkin status=${statusCode}`);
        if (statusCode >= 200 && statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`trip-info-checkin status=${statusCode}`));
        }
      });
    });
    req.on("error", (err) => reject(err));
    req.on("timeout", () => { req.destroy(); reject(new Error("trip-info timeout")); });
    req.write(postBody);
    req.end();
  });
}

fs.mkdirSync(dataDir, { recursive: true });
db.initDb().catch((err) => console.log(`[DB] init failed: ${err.message}`));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/identity") {
    const body = await readBody(req);
    const record = JSON.parse(body || "{}");
    const id = crypto.randomUUID();
    fs.writeFileSync(path.join(dataDir, `${id}.json`), JSON.stringify(record, null, 2));
    sendJson(res, { id, url: `${getPublicOrigin(req)}/identity.html?id=${id}` });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/wms-status") {
    const password = getWmsPassword();
    sendJson(res, {
      wmsBaseUrl: WMS_BASE_URL,
      hasAuthToken: Boolean(WMS_AUTH_TOKEN),
      hasUsername: Boolean(WMS_USERNAME),
      hasPassword: Boolean(password),
      tenant: WMS_TENANT_ID,
      facility: WMS_FACILITY_ID,
      cachedTokenActive: Boolean(cachedWmsToken && Date.now() < cachedWmsTokenExpiry),
      emailNotificationsEnabled: isEmailEnabled(),
      alertRecipients: ALERT_RECIPIENTS,
      operatorNotificationRecipient: OPERATOR_NOTIFICATION_RECIPIENT
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/wms-lookup") {
    const rn = url.searchParams.get("rn") || "";
    if (!rn) {
      sendJson(res, { customer: "" });
      return;
    }
    const bearerToken = await getWmsBearerToken();
    if (!bearerToken) {
      sendJson(res, { customer: "", error: "WMS credentials not configured" });
      return;
    }
    try {
      const wmsResult = await wmsLookup(rn, `Bearer ${bearerToken}`);
      sendJson(res, wmsResult);
    } catch (err) {
      sendJson(res, { customer: "", error: "WMS lookup failed" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/wms-inbound-lookup") {
    const keyword = url.searchParams.get("keyword") || "";
    if (!keyword) {
      sendJson(res, { customer: "" });
      return;
    }
    const bearerToken = await getWmsBearerToken();
    if (!bearerToken) {
      sendJson(res, { customer: "", error: "WMS credentials not configured" });
      return;
    }
    try {
      const wmsResult = await wmsInboundLookup(keyword, `Bearer ${bearerToken}`);
      sendJson(res, wmsResult);
    } catch (err) {
      sendJson(res, { customer: "", error: "WMS inbound lookup failed" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/wms-staged-door") {
    const loadId = url.searchParams.get("loadId") || "";
    if (!loadId) {
      sendJson(res, { door: null, source: "no_load_id" });
      return;
    }
    const bearerToken = await getWmsBearerToken();
    if (!bearerToken) {
      sendJson(res, { door: null, source: "auth_unavailable" });
      return;
    }
    try {
      const result = await lookupStagedDoor(loadId, `Bearer ${bearerToken}`);
      sendJson(res, result);
    } catch (err) {
      console.log(`[Staged door] endpoint error: ${err.message}`);
      sendJson(res, { door: null, source: "error", error: err.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/checkins") {
    const result = await db.queryCheckins(Object.fromEntries(url.searchParams.entries()));
    sendJson(res, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/checkins/summary") {
    const summary = await db.getSummary();
    sendJson(res, summary);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/checkins/") && !url.pathname.includes("summary") && !url.pathname.includes("export")) {
    const id = url.pathname.split("/").pop();
    if (!id || isNaN(Number(id))) { sendJson(res, { error: "Invalid ID" }, 400); return; }
    const record = await db.getCheckinById(Number(id));
    if (!record) { sendJson(res, { error: "Check-in not found" }, 404); return; }
    sendJson(res, record);
    return;
  }

  if ((req.method === "PATCH" || req.method === "PUT") && url.pathname.startsWith("/api/checkins/")) {
    const id = url.pathname.split("/").pop();
    if (!id || isNaN(Number(id))) { sendJson(res, { error: "Invalid ID" }, 400); return; }
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const fields = payload.fields || {};
      const updatedBy = payload.updatedBy || "ops-dashboard";
      const updateNotes = payload.updateNotes || "";

      // Validate at least one editable field
      const validKeys = Object.keys(fields).filter(k => db.EDITABLE_FIELDS.includes(k));
      if (validKeys.length === 0) { sendJson(res, { error: "No valid editable fields provided" }, 400); return; }

      // Fetch existing record for ET number
      const existing = await db.getCheckinById(Number(id));
      if (!existing) { sendJson(res, { error: "Check-in not found" }, 404); return; }

      // Update local DB
      const updated = await db.updateCheckin(Number(id), fields, updatedBy, updateNotes);
      const localUpdated = Boolean(updated);

      // Attempt YMS/WISE update if ET exists
      let wiseUpdated = false;
      let wiseMessage = "";
      const etNumber = existing.et_number;
      if (etNumber && localUpdated) {
        try {
          const ymsToken = await getYmsBearerToken();
          if (!ymsToken) {
            wiseMessage = "WISE update skipped: unable to authenticate with yard management system.";
          } else {
            // Update basic info (driver/carrier/vehicle/equipment)
            const merged = { ...existing, ...fields };
            const basicPayload = {
              driverInfo: {
                driverPhone: merged.driver_phone || "",
                firstName: merged.driver_first_name || "",
                lastName: merged.driver_last_name || "",
                driverName: merged.driver_name || `${merged.driver_first_name || ""} ${merged.driver_last_name || ""}`.trim(),
                licenseNumber: merged.driver_license || ""
              },
              carrierInfo: {
                carrierName: merged.carrier_name || "",
                usdotNumber: merged.usdot || ""
              },
              vehicleInfo: {
                licensePlate: merged.license_plate || "",
                vehicleType: merged.vehicle_type || "Tractor"
              },
              equipmentInfo: {
                equipmentNo: merged.equipment_no || "",
                equipmentType: merged.equipment_type || "Trailer",
                sealNumber: ""
              }
            };
            let basicOk = false;
            try {
              await attachBasicInfo(ymsToken, etNumber, basicPayload);
              basicOk = true;
            } catch (err) {
              console.log(`[Edit WISE] basic-info update failed for ${etNumber}: ${err.message}`);
            }

            // Update trip info
            const tripPayload = {
              direction: merged.direction || "outbound",
              customerId: merged.customer_id || "",
              receiptId: merged.receipt_id || "",
              poNo: merged.po_no || "",
              referenceNo: merged.reference_no || "",
              loadId: merged.load_id || "",
              loadNo: merged.load_no || merged.wms_load_no || ""
            };
            let tripOk = false;
            try {
              await attachTripInfo(ymsToken, etNumber, tripPayload);
              tripOk = true;
            } catch (err) {
              console.log(`[Edit WISE] trip-info update failed for ${etNumber}: ${err.message}`);
            }

            wiseUpdated = basicOk || tripOk;
            if (basicOk && tripOk) {
              wiseMessage = "WISE updated successfully.";
            } else if (basicOk) {
              wiseMessage = "WISE driver/vehicle info updated. Trip/load info could not be updated.";
            } else if (tripOk) {
              wiseMessage = "WISE trip/load info updated. Driver/vehicle info could not be updated.";
            } else {
              wiseMessage = "WISE update failed. Local record was saved. Please verify in WISE manually.";
            }
          }
        } catch (err) {
          console.log(`[Edit WISE] update error for ${etNumber}: ${err.message}`);
          wiseMessage = "WISE update encountered an error. Local record was saved.";
        }
      } else if (!etNumber) {
        wiseMessage = "No ET number on this record. WISE update not applicable.";
      }

      sendJson(res, { localUpdated, wiseUpdated, message: wiseMessage, record: updated });
    } catch (err) {
      console.log(`[Edit] PATCH error: ${err.message}`);
      sendJson(res, { error: "Update failed", localUpdated: false, wiseUpdated: false }, 500);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/checkins/export") {
    const result = await db.queryCheckins({ ...Object.fromEntries(url.searchParams.entries()), page: 1, limit: 10000 });
    const headers = ["created_at","et_number","driver_name","driver_phone","driver_license","driver_email","carrier_name","usdot","vehicle_type","license_plate","equipment_type","equipment_no","entry_task","load_type_group","direction","reference_no","load_no","receipt_id","po_no","customer","door_assignment","comments","identity_url"];
    const csv = [headers.join(",")].concat(result.data.map((row) => headers.map((h) => csvCell(row[h])).join(","))).join("\n");
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=lincoln-driver-checkins.csv" });
    res.end(csv);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/checkins") {
    try {
      const body = await readBody(req);
      const record = JSON.parse(body || "{}");
      let emailNotification = { sent: false };
      try {
        emailNotification = await sendStoredCheckinEmailNotification(record);
        record.emailNotificationSent = Boolean(emailNotification.sent);
      } catch (err) {
        record.emailNotificationSent = false;
        console.log(`[Email notification] Stored check-in email failed: ${err.message}`);
      }
      const id = await db.insertCheckin(record);
      sendJson(res, { saved: Boolean(id), id, emailNotificationSent: Boolean(emailNotification.sent) });
    } catch (err) {
      console.log(`[DB] checkin save endpoint error: ${err.message}`);
      sendJson(res, { saved: false });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ticket-lookup") {
    const ticket = (url.searchParams.get("ticket") || "").trim();
    if (!ticket) {
      sendJson(res, { found: false, error: "No ticket number provided" });
      return;
    }
    try {
      const wmsToken = await getWmsBearerToken();
      if (!wmsToken) {
        sendJson(res, { found: false, error: "Lookup service unavailable" });
        return;
      }
      const wmsResult = await wmsLookup(ticket, `Bearer ${wmsToken}`);
      if (wmsResult.customer) {
        console.log(`[Ticket lookup] ticket=${ticket} -> customer="${wmsResult.customer}"`);
        sendJson(res, {
          found: true,
          etNumber: ticket,
          customer: wmsResult.customer,
          customerCode: wmsResult.customerCode || "",
          loadNo: wmsResult.loadNo || "",
          loadId: wmsResult.loadId || ""
        });
      } else {
        console.log(`[Ticket lookup] ticket=${ticket} -> not found`);
        sendJson(res, { found: false, error: "Ticket not found" });
      }
    } catch (err) {
      console.log(`[Ticket lookup] error: ${err.message}`);
      sendJson(res, { found: false, error: "Lookup failed" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/yms-entry-ticket") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");

      const ymsToken = await getYmsBearerToken();
      if (!ymsToken) {
        sendJson(res, { etNumber: "", error: "YMS auth unavailable" });
        return;
      }

      // Step 1: Create blank ET
      const etNumber = await createYmsEntryTicket(ymsToken);
      console.log(`[YMS ET] Created ET: ${etNumber}`);

      let basicInfoAttached = false;
      let tripInfoAttached = false;

      // Step 2: Attach driver/carrier/vehicle/equipment info
      try {
        await attachBasicInfo(ymsToken, etNumber, payload);
        basicInfoAttached = true;
        console.log(`[YMS ET] Basic info attached to ${etNumber}`);
      } catch (err) {
        console.log(`[YMS ET] Basic info attach failed for ${etNumber}: ${err.message}`);
      }

      // Step 3: Attach trip/load info if WMS IDs available
      const tripInfo = payload.tripInfo || {};
      if (tripInfo.loadId || tripInfo.customerId || tripInfo.receiptId || tripInfo.poNo) {
        try {
          await attachTripInfo(ymsToken, etNumber, tripInfo);
          tripInfoAttached = true;
          console.log(`[YMS ET] Trip info attached to ${etNumber}`);
        } catch (err) {
          console.log(`[YMS ET] Trip info attach failed for ${etNumber}: ${err.message}`);
        }
      }

      // Notification email is sent after the browser saves the complete dashboard record,
      // because that record includes the check-in link and dock door assignment.
      sendJson(res, { etNumber, basicInfoAttached, tripInfoAttached, emailNotificationSent: false });
    } catch (err) {
      console.log(`[YMS ET] endpoint error: ${err.message}`);
      sendJson(res, { etNumber: "", error: "ET creation failed" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/identity/")) {
    const id = path.basename(url.pathname);
    const file = path.join(dataDir, `${id}.json`);
    if (!fs.existsSync(file)) {
      sendJson(res, { error: "Not found" }, 404);
      return;
    }
    sendJson(res, JSON.parse(fs.readFileSync(file, "utf8")));
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  const ip = getLanIp();
  console.log(`Driver check-in running at http://127.0.0.1:${port}/`);
  if (ip) console.log(`LAN QR URL base: http://${ip}:${port}/`);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function getPublicOrigin(req) {
  const ip = getLanIp();
  const hostHeader = req.headers.host || `127.0.0.1:${port}`;
  if (ip && hostHeader.startsWith("127.0.0.1")) return `http://${ip}:${port}`;
  return `http://${hostHeader}`;
}

function getLanIp() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return "";
}

function normalizeLookupValue(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isGenericLookupInput(value) {
  const raw = String(value || "").trim();
  const normalized = normalizeLookupValue(raw);
  const generic = new Set(["NA", "N", "NAN", "NAA", "NONE", "NULL", "UNKNOWN", "LOAD", "PO", "RN", "PICKUP", "PICK", "REFERENCE", "REF", "BOL", "NUMBER", "NUM", "TEST", "ASDF", "ASDFGH"]);
  if (!normalized || normalized.length < 4) return true;
  if (generic.has(normalized)) return true;
  if (/^[A-Z]+$/.test(normalized) && normalized.length < 6) return true;
  return false;
}

function collectLookupCandidateValues(record) {
  const values = [];
  const preferredKeys = /^(loadNo|loadNumber|loadId|receiptId|receiptNo|rn|rnNo|referenceNo|refNo|poNo|purchaseOrderNo|pickupNo|pickupNumber|appointmentNo|bolNo|orderNo|orderId|orderIds|dnNo|containerNo|trailerNo)$/i;
  const excludedKeys = /customer|carrier|address|name|status|type|time|date|created|updated|note|comment/i;

  function visit(obj, key = "") {
    if (obj == null) return;
    if (Array.isArray(obj)) {
      obj.forEach((item) => visit(item, key));
      return;
    }
    if (typeof obj === "object") {
      Object.entries(obj).forEach(([childKey, value]) => {
        if (preferredKeys.test(childKey) || (!excludedKeys.test(childKey) && /no$|id$|number$|code$/i.test(childKey))) {
          visit(value, childKey);
        } else if (typeof value === "object") {
          visit(value, childKey);
        }
      });
      return;
    }
    if ((typeof obj === "string" || typeof obj === "number") && !excludedKeys.test(key)) {
      const text = String(obj).trim();
      if (text) values.push({ key, text, normalized: normalizeLookupValue(text) });
    }
  }

  visit(record);
  return values.filter((v) => v.normalized.length >= 4);
}

function isStrongLookupMatch(input, record) {
  const normalizedInput = normalizeLookupValue(input);
  if (isGenericLookupInput(input)) return false;
  const candidates = collectLookupCandidateValues(record);
  for (const candidate of candidates) {
    const c = candidate.normalized;
    if (c === normalizedInput) return true;
    // Allow a real pickup/load number to match the leading token in strings like "45107769 // SP BOL".
    if (normalizedInput.length >= 6 && c.startsWith(normalizedInput)) return true;
    // Allow exact token match before punctuation/slashes/spaces.
    const rawTokens = candidate.text.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    if (rawTokens.some((token) => normalizeLookupValue(token) === normalizedInput)) return true;
  }
  return false;
}

function formatWmsLookupResult(match) {
  return {
    customer: match.customerName,
    customerCode: match.customerCode || "",
    customerId: match.customerId || "",
    loadNo: match.loadNo || "",
    loadId: match.id || match.loadId || "",
    orderIds: match.orderIds || [],
    carrierName: match.carrierName || "",
    appointmentTime: match.appointmentTime || ""
  };
}

function wmsLookup(rn, authHeader) {
  return new Promise((resolve) => {
    const rawInput = String(rn || "").trim();
    if (isGenericLookupInput(rawInput)) {
      console.log(`[WMS lookup] RN=${rawInput} -> rejected generic/too-short input`);
      resolve({ customer: "" });
      return;
    }

    const lookupUrl = new URL(`${WMS_BASE_URL}/wms-bam/outbound/load/search-by-paging`);
    const postBody = JSON.stringify({ pageNo: 1, pageSize: 10, keyword: rawInput });
    const mod = lookupUrl.protocol === "https:" ? https : http;
    const req = mod.request(lookupUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "x-tenant-id": WMS_TENANT_ID,
        "x-facility-id": WMS_FACILITY_ID,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(postBody)
      },
      timeout: 5000
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const list = parsed?.data?.list || [];
          const match = list.find((item) => item?.customerName && isStrongLookupMatch(rawInput, item));
          if (match) {
            console.log(`[WMS lookup] RN=${rawInput} -> accepted strong match customer="${match.customerName}" loadNo="${match.loadNo || ""}"`);
            resolve(formatWmsLookupResult(match));
          } else {
            console.log(`[WMS lookup] RN=${rawInput} -> rejected weak/fuzzy results (${list.length} results)`);
            resolve({ customer: "" });
          }
        } catch (err) {
          console.log(`[WMS lookup] RN=${rawInput} -> parse error: ${err.message}`);
          resolve({ customer: "" });
        }
      });
    });
    req.on("error", (err) => {
      console.log(`[WMS lookup] RN=${rawInput} -> network error: ${err.message}`);
      resolve({ customer: "" });
    });
    req.on("timeout", () => {
      console.log(`[WMS lookup] RN=${rawInput} -> timeout`);
      req.destroy();
      resolve({ customer: "" });
    });
    req.write(postBody);
    req.end();
  });
}


function wmsInboundLookup(keyword, authHeader) {
  return new Promise((resolve) => {
    const lookupUrl = new URL(`${WMS_BASE_URL}/wms-bam/inbound/receipt/search-by-paging`);
    const postBody = JSON.stringify({ pageNo: 1, pageSize: 10, keyword });
    const mod = lookupUrl.protocol === "https:" ? https : http;
    const req = mod.request(lookupUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "x-tenant-id": WMS_TENANT_ID,
        "x-facility-id": WMS_FACILITY_ID,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(postBody)
      },
      timeout: 5000
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const raw = parsed?.data?.list || parsed?.data?.records || parsed?.data || [];
          const rows = Array.isArray(raw) ? raw : [];
          const normalizedKeyword = String(keyword || "").trim().toUpperCase();
          const match = rows.find((row) => {
            const candidates = [row.id, row.receiptId, row.receiptNo, row.rn, row.poNo, row.bolNo, row.referenceNo, row.containerNo]
              .map((v) => String(v || "").trim().toUpperCase());
            return candidates.includes(normalizedKeyword);
          }) || rows[0];
          if (match && (match.customerName || match.customerId)) {
            resolve({
              type: "inbound",
              customer: match.customerName || match.customer || "",
              customerCode: match.customerCode || "",
              customerId: match.customerId || "",
              receiptId: match.id || match.receiptId || match.receiptNo || match.rn || "",
              poNo: match.poNo || "",
              bolNo: match.bolNo || "",
              referenceNo: match.referenceNo || match.bolNo || match.containerNo || "",
              containerNo: match.containerNo || "",
              status: match.status || ""
            });
          } else {
            resolve({ customer: "" });
          }
        } catch (err) {
          console.log(`[WMS inbound] keyword=${keyword} -> parse error: ${err.message}`);
          resolve({ customer: "" });
        }
      });
    });
    req.on("error", (err) => {
      console.log(`[WMS inbound] keyword=${keyword} -> network error: ${err.message}`);
      resolve({ customer: "" });
    });
    req.on("timeout", () => {
      console.log(`[WMS inbound] keyword=${keyword} -> timeout`);
      req.destroy();
      resolve({ customer: "" });
    });
    req.write(postBody);
    req.end();
  });
}


function wmsSearchInventoryByLoad(loadId, authHeader) {
  return new Promise((resolve) => {
    const searchUrl = new URL(`${WMS_BASE_URL}/wms/wms-inventory/search`);
    const postBody = JSON.stringify({
      loadId,
      statuses: outboundActiveStatuses,
      excludeStatuses,
      currentPage: 1,
      pageSize: 200
    });
    const mod = searchUrl.protocol === "https:" ? https : http;
    const req = mod.request(searchUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "x-tenant-id": WMS_TENANT_ID,
        "x-facility-id": WMS_FACILITY_ID,
        "item-time-zone": TIMEZONE,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(postBody)
      },
      timeout: 8000
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const rows = parsed?.data || [];
          resolve(Array.isArray(rows) ? rows : []);
        } catch (err) {
          console.log(`[WMS inventory] loadId=${loadId} -> parse error: ${err.message}`);
          resolve([]);
        }
      });
    });
    req.on("error", (err) => {
      console.log(`[WMS inventory] loadId=${loadId} -> network error: ${err.message}`);
      resolve([]);
    });
    req.on("timeout", () => {
      console.log(`[WMS inventory] loadId=${loadId} -> timeout`);
      req.destroy();
      resolve([]);
    });
    req.write(postBody);
    req.end();
  });
}

function wmsSearchLocations(locationIds, authHeader) {
  return new Promise((resolve) => {
    if (!locationIds.length) { resolve([]); return; }
    const searchUrl = new URL(`${WMS_BASE_URL}/wms/wms-location/search`);
    const postBody = JSON.stringify({ ids: locationIds, currentPage: 1, pageSize: locationIds.length + 10 });
    const mod = searchUrl.protocol === "https:" ? https : http;
    const req = mod.request(searchUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "x-tenant-id": WMS_TENANT_ID,
        "x-facility-id": WMS_FACILITY_ID,
        "item-time-zone": TIMEZONE,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(postBody)
      },
      timeout: 8000
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const rows = parsed?.data || [];
          resolve(Array.isArray(rows) ? rows : []);
        } catch (err) {
          console.log(`[WMS location] -> parse error: ${err.message}`);
          resolve([]);
        }
      });
    });
    req.on("error", (err) => {
      console.log(`[WMS location] -> network error: ${err.message}`);
      resolve([]);
    });
    req.on("timeout", () => {
      console.log(`[WMS location] -> timeout`);
      req.destroy();
      resolve([]);
    });
    req.write(postBody);
    req.end();
  });
}

function resolveDoorFromStagedLocation(locations, inventoryRows) {
  if (!locations.length) return null;

  // Count inventory rows per locationId to find dominant location
  const locationCounts = {};
  for (const row of inventoryRows) {
    if (row.locationId) {
      locationCounts[row.locationId] = (locationCounts[row.locationId] || 0) + (row.qty || 1);
    }
  }

  // Sort locations by inventory quantity (dominant first)
  const sortedLocations = [...locations].sort((a, b) => {
    return (locationCounts[b.id] || 0) - (locationCounts[a.id] || 0);
  });

  const dominantLocation = sortedLocations[0];
  if (!dominantLocation) return null;

  // If location type is DOCK or category is DOCK, route directly to that dock
  if (dominantLocation.type === "DOCK" || dominantLocation.category === "DOCK") {
    const doorName = dominantLocation.name || dominantLocation.akaName || "assigned dock";
    return {
      door: `Go to the door at ${doorName}`,
      source: "dock_location",
      locationName: doorName,
      locationType: dominantLocation.type,
      locationCategory: dominantLocation.category,
      locationId: dominantLocation.id
    };
  }

  // If location type is STAGING or other warehouse type, check configurable mapping
  const locationName = (dominantLocation.name || "").toUpperCase();
  for (const mapping of stagingToDoorMapping) {
    const pattern = (mapping.pattern || "").toUpperCase();
    if (!pattern) continue;
    if (locationName === pattern || locationName.startsWith(pattern)) {
      return {
        door: mapping.door,
        source: "staging_mapping",
        locationName: dominantLocation.name,
        locationType: dominantLocation.type,
        locationCategory: dominantLocation.category,
        locationId: dominantLocation.id,
        matchedPattern: mapping.pattern
      };
    }
  }

  // Multiple different locations with no clear mapping = ambiguous
  const uniqueLocationIds = [...new Set(inventoryRows.map((r) => r.locationId).filter(Boolean))];
  if (uniqueLocationIds.length > 1 && !locationCounts[dominantLocation.id]) {
    return {
      door: null,
      source: "ambiguous",
      locationName: dominantLocation.name,
      locationType: dominantLocation.type,
      locationId: dominantLocation.id,
      uniqueLocations: uniqueLocationIds.length
    };
  }

  // No mapping found for this staging location - return info but no door override
  return {
    door: null,
    source: "no_mapping",
    locationName: dominantLocation.name,
    locationType: dominantLocation.type,
    locationCategory: dominantLocation.category,
    locationId: dominantLocation.id
  };
}

async function lookupStagedDoor(loadId, authHeader) {
  if (!loadId) return { door: null, source: "no_load_id" };

  console.log(`[Staged door] Looking up inventory for loadId=${loadId}`);
  const inventoryRows = await wmsSearchInventoryByLoad(loadId, authHeader);

  if (!inventoryRows.length) {
    console.log(`[Staged door] No active inventory rows found for loadId=${loadId}`);
    return { door: null, source: "no_inventory", loadId };
  }

  console.log(`[Staged door] Found ${inventoryRows.length} inventory rows for loadId=${loadId}`);

  // Collect unique locationIds
  const locationIds = [...new Set(inventoryRows.map((r) => r.locationId).filter(Boolean))];
  if (!locationIds.length) {
    console.log(`[Staged door] No locationIds in inventory rows for loadId=${loadId}`);
    return { door: null, source: "no_location_ids", loadId, inventoryCount: inventoryRows.length };
  }

  console.log(`[Staged door] Resolving ${locationIds.length} unique locations`);
  const locations = await wmsSearchLocations(locationIds, authHeader);

  if (!locations.length) {
    console.log(`[Staged door] Could not resolve any locations for loadId=${loadId}`);
    return { door: null, source: "location_resolve_failed", loadId, locationIds };
  }

  const result = resolveDoorFromStagedLocation(locations, inventoryRows);
  console.log(`[Staged door] loadId=${loadId} -> source=${result?.source}, door=${result?.door || "none"}, location=${result?.locationName || ""}`);
  return { ...result, loadId, inventoryCount: inventoryRows.length, locationCount: locations.length };
}
