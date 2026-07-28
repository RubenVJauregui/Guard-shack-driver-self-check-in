const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const nodemailer = require("nodemailer");
const QRCode = require("qrcode");
const db = require("./db");
const { stagingToDoorMapping, outboundReadyInventoryStatuses } = require("./staging-door-config");

const OUTBOUND_INVENTORY_STATUSES = Array.isArray(outboundReadyInventoryStatuses)
  ? outboundReadyInventoryStatuses
  : [];
const EXCLUDED_INVENTORY_STATUSES = Object.freeze(["SHIPPED", "ADJUSTOUT", "DAMAGE"]);

process.on("uncaughtException", (err) => {
  if (err && (err.code === "ECONNRESET" || err.message === "aborted" || err.message === "Request aborted by client")) {
    console.log(`[Server] Ignored client disconnect: ${err.code || err.message}`);
    return;
  }
  console.error("[Server] Uncaught exception:", err);
});

process.on("unhandledRejection", (err) => {
  if (err && (err.code === "ECONNRESET" || err.message === "aborted" || err.message === "Request aborted by client")) {
    console.log(`[Server] Ignored aborted request promise: ${err.code || err.message}`);
    return;
  }
  console.error("[Server] Unhandled rejection:", err);
});

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
const WMS_FACILITY_ID = process.env.WMS_FACILITY_ID || "LT_F1";
const YMS_BASE_URL = process.env.YMS_BASE_URL || "https://traffic.item.com/api/yms";
const TIMEZONE = process.env.TIMEZONE || "America/Los_Angeles";
const OPERATOR_NOTIFICATION_RECIPIENT = process.env.OPERATOR_NOTIFICATION_RECIPIENT || "Juan.barragan@unisco.com";
const ALERT_RECIPIENTS = (process.env.ALERT_RECIPIENTS || "Juan.barragan@unisco.com,Ryan.Morales@unisco.com,Angela.bryant@unisco.com,Juan.barragan@unisco.com")
  .split(",")
  .map((email) => email.trim())
  .filter(Boolean);
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || "Valley View Driver Check-In <no-reply@unisco.com>";
const ADMIN_CHANGE_TOKEN = process.env.ADMIN_CHANGE_TOKEN || "";
const ADDITIONAL_ADMIN_CHANGE_TOKENS = (process.env.ADDITIONAL_ADMIN_CHANGE_TOKENS || "")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);
const ymsEtBySubmissionSignature = new Map();

function requireAdminChangeToken(req, res) {
  const validTokens = [ADMIN_CHANGE_TOKEN, ...ADDITIONAL_ADMIN_CHANGE_TOKENS].filter(Boolean);
  if (!validTokens.length) {
    sendJson(res, { ok: false, error: "Admin change protection is not configured" }, 503);
    return false;
  }
  const provided = String(req.headers["x-admin-change-token"] || req.headers["x-owner-token"] || "");
  if (!validTokens.includes(provided)) {
    sendJson(res, { ok: false, error: "Not authorized to make changes" }, 403);
    return false;
  }
  return true;
}

function isEmailEnabled() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && ALERT_RECIPIENTS.length);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return "";
}

const CHECKIN_VALIDATION_LABELS = Object.freeze({
  etCreated: { es: "ET creado", en: "ET created" },
  dnLinked: { es: "DN vinculado", en: "DN linked" },
  loadLinked: { es: "LOAD vinculado", en: "LOAD linked" },
  validDock: { es: "Dock válido", en: "Valid dock" },
  loadTaskCreated: { es: "Load Task creado", en: "Load Task created" },
  windowCheckinCompleted: { es: "Window Check-In terminado", en: "Window Check-In completed" },
  qrCreated: { es: "QR creado", en: "QR created" },
  wiseSynced: { es: "WISE sincronizado", en: "WISE synced" }
});

function validationIds(...values) {
  const ids = [];
  for (const value of values) {
    if (Array.isArray(value)) ids.push(...value);
    else if (value !== undefined && value !== null) ids.push(value);
  }
  return [...new Set(ids.map((value) => firstNonEmptyString(value)).filter(Boolean))];
}

function buildCheckinValidation(context = {}) {
  const etNumber = firstNonEmptyString(context.etNumber);
  const orderIds = validationIds(context.orderIds, context.orderId, context.dnId);
  const loadId = firstNonEmptyString(context.loadId);
  const dockId = numericDockId(context.dockId);
  const loadTaskId = firstNonEmptyString(context.loadTaskId);
  const entryStatus = firstNonEmptyString(context.entryStatus);
  const identityUrl = firstNonEmptyString(context.identityUrl);
  const syncStatus = firstNonEmptyString(context.syncStatus, context.wiseSynced ? "CONFIRMED" : "NOT_CONFIRMED");
  const facts = {
    etCreated: Boolean(etNumber && context.etCreated !== false),
    dnLinked: Boolean(orderIds.length && context.dnLinked),
    loadLinked: Boolean(loadId && context.loadLinked),
    validDock: Boolean(dockId),
    loadTaskCreated: Boolean(loadTaskId && context.loadTaskCreated !== false),
    windowCheckinCompleted: Boolean(context.windowCheckinCompleted),
    qrCreated: Boolean(context.qrCreated && identityUrl),
    wiseSynced: Boolean(context.wiseSynced)
  };
  const details = {
    etCreated: facts.etCreated ? `ET ${etNumber} confirmado.` : "El ET no fue confirmado.",
    dnLinked: facts.dnLinked ? `DN/orden confirmada: ${orderIds.join(", ")}.` : "No se confirmó una DN/orden vinculada.",
    loadLinked: facts.loadLinked ? `LOAD ${loadId} confirmado en el readback.` : "WISE/YMS no confirmó el LOAD esperado.",
    validDock: facts.validDock ? `Dock/location ID ${dockId} verificado.` : "No se confirmó un dock/location ID numérico válido.",
    loadTaskCreated: facts.loadTaskCreated ? `Load Task ${loadTaskId} confirmado.` : "No se confirmó la creación o reutilización del Load Task.",
    windowCheckinCompleted: facts.windowCheckinCompleted ? `Window Check-In confirmado${entryStatus ? ` con estado ${entryStatus}` : ""}.` : "Window Check-In todavía no fue confirmado por readback.",
    qrCreated: facts.qrCreated ? "Identidad guardada y QR preparado." : "El QR todavía no fue confirmado por el portal.",
    wiseSynced: facts.wiseSynced ? "WISE/YMS confirmó la sincronización final." : "La sincronización final con WISE/YMS no fue confirmada."
  };
  const evidenceByKey = {
    etCreated: { etNumber },
    dnLinked: { orderIds },
    loadLinked: { loadId },
    validDock: { dockId },
    loadTaskCreated: { loadTaskId },
    windowCheckinCompleted: { etNumber, entryStatus },
    qrCreated: { identityUrl },
    wiseSynced: { etNumber, loadId, loadTaskId, entryStatus, syncStatus }
  };
  const steps = Object.keys(CHECKIN_VALIDATION_LABELS).map((key) => ({
    key,
    label: CHECKIN_VALIDATION_LABELS[key],
    passed: facts[key],
    details: details[key],
    evidence: evidenceByKey[key]
  }));
  return {
    passed: steps.every((step) => step.passed),
    steps,
    evidence: { etNumber, orderIds, loadId, dockId, loadTaskId, entryStatus, identityUrl, syncStatus },
    generatedAt: new Date().toISOString()
  };
}

function logCheckinValidation(source, etNumber, validation) {
  const summary = validation.steps.map((step) => `${step.key}=${step.passed ? "PASS" : "FAIL"}`).join(" ");
  console.log(`[Validation Engine] source=${source} et=${etNumber || "none"} passed=${validation.passed} ${summary}`);
}

function extractYmsReadback(detail, expectedLoadId) {
  const value = asObject(detail?.data || detail);
  const outboundTask = value.outboundTask || value.task || null;
  const rawLoads = value.outboundLoads || value.loads || value.activity?.loads || [];
  const loads = Array.isArray(rawLoads) ? rawLoads : [];
  const expected = firstNonEmptyString(expectedLoadId);
  const loadLinked = Boolean(expected && loads.some((load) => validationIds(load?.loadId, load?.id, load?.loadNo).includes(expected)));
  const entryStatus = firstNonEmptyString(value.entryStatus, value.status);
  const windowCheckinCompleted = /WINDOW_CHECKED_IN|DOCK_CHECKED_IN|IN_YARD|LOADING/i.test(entryStatus);
  return {
    entryStatus,
    loadLinked,
    taskPresent: Boolean(outboundTask),
    dockId: firstNonEmptyString(outboundTask?.assignLocationId, outboundTask?.dockId, value.dockId, value.locationId),
    loadTaskId: firstNonEmptyString(value.loadTaskId, outboundTask?.taskId),
    windowCheckinCompleted,
    wiseSynced: Boolean(windowCheckinCompleted && loadLinked && outboundTask)
  };
}

function formatNotificationLines(etNumber, payload) {
  const driver = payload.driverInfo || {};
  const carrier = payload.carrierInfo || {};
  const vehicle = payload.vehicleInfo || {};
  const equipment = payload.equipmentInfo || {};
  const trip = payload.tripInfo || {};
  return [
    `A driver has completed check-in at Valley View (LT_F1).`,
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
  const subjectParts = ["Valley View Driver Check-In", etNumber];
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



function normalizeForCompare(value = "") {
  return String(value).trim().toUpperCase();
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
  const subject = ["Valley View Driver Check-In", etNumber, driverName].filter(Boolean).join(" - ");
  const lines = [
    "A driver has completed check-in at Valley View (LT_F1).",
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
    <h2 style="margin:0 0 12px">Valley View Driver Check-In</h2>
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

function findEtNumber(value) {
  if (!value) return "";
  if (typeof value === "string") return /^ET[-\w]+$/i.test(value.trim()) ? value.trim() : "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEtNumber(item);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  const directKeys = ["entryId", "entryNo", "entryNumber", "etNumber", "ticketNo"];
  for (const key of directKeys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const key of directKeys) {
    const candidate = value.data?.[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  const nested = [value.data, value.result, value.payload, value.entryTicket, value.ticket];
  for (const item of nested) {
    const found = findEtNumber(item);
    if (found) return found;
  }
  return "";
}

function isTemporaryYmsCreateFailure(err = {}) {
  return err.temporary === true || err.timeout === true || (Number(err.statusCode) >= 500 && Number(err.statusCode) < 600);
}

function createYmsEntryTicketOnce(ymsToken) {
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
      timeout: 12000
    }, (res) => {
      const statusCode = res.statusCode;
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        console.log(`[YMS ET] create response status=${statusCode}`);
        let parsed = null;
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (err) {
          console.log(`[YMS ET] create parse failure body=${body.slice(0, 2000)}`);
          const parseErr = new Error(`YMS ET parse error: ${err.message}`);
          parseErr.statusCode = statusCode;
          reject(parseErr);
          return;
        }
        const etNumber = findEtNumber(parsed);
        if (statusCode >= 200 && statusCode < 300 && etNumber) {
          console.log(`[YMS ET] Created: ${etNumber}`);
          resolve({ ok: true, etNumber, raw: parsed });
          return;
        }
        console.log(`[YMS ET] create failed/no ET status=${statusCode} body=${JSON.stringify(parsed).slice(0, 2000)}`);
        const err = new Error(etNumber ? `YMS ET status=${statusCode}` : "YMS did not return an ET number");
        err.statusCode = statusCode;
        err.temporary = statusCode >= 500 && statusCode < 600;
        err.raw = parsed;
        reject(err);
      });
    });
    req.on("error", (err) => { err.temporary = true; reject(err); });
    req.on("timeout", () => { const err = new Error("YMS ET creation timeout"); err.timeout = true; err.temporary = true; req.destroy(err); reject(err); });
    req.write("{}");
    req.end();
  });
}

async function createYmsEntryTicket(ymsToken) {
  try {
    return await createYmsEntryTicketOnce(ymsToken);
  } catch (err) {
    if (isTemporaryYmsCreateFailure(err)) {
      console.log(`[YMS ET] temporary create failure, retrying once: ${err.message}`);
      return await createYmsEntryTicketOnce(ymsToken);
    }
    throw err;
  }
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
    sendJson(res, { id, saved: true, url: `${getPublicOrigin(req)}/identity.html?id=${id}` });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/qr") {
    const data = String(url.searchParams.get("data") || "").trim();
    if (!data) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("Missing QR data");
      return;
    }
    try {
      const svg = await QRCode.toString(data, {
        type: "svg",
        width: 190,
        margin: 2,
        errorCorrectionLevel: "M"
      });
      res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" });
      res.end(svg);
    } catch (err) {
      console.log(`[QR] generation failed: ${err.message}`);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("QR generation failed");
    }
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
      const wmsResult = await wmsLookupAny(rn, `Bearer ${bearerToken}`);
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


  if (req.method === "PATCH" && /^\/api\/checkins\/(\d+)\/assignment$/.test(url.pathname)) {
    if (!requireAdminChangeToken(req, res)) return;
    const id = url.pathname.match(/\/api\/checkins\/(\d+)\/assignment/)[1];
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || "{}");
      const result = await db.updateAssignment(Number(id), data);
      if (result) sendJson(res, { updated: true, assignment: result });
      else sendJson(res, { updated: false, error: "Record not found or not a Valley View record" }, 404);
    } catch (err) {
      console.log(`[Assignment] error: ${err.message}`);
      sendJson(res, { updated: false, error: "Assignment update failed" }, 500);
    }
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
    if (!requireAdminChangeToken(req, res)) return;
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
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=valley-view-driver-checkins.csv" });
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

      // --- Automatic post-check-in workflow (non-blocking) ---
      if (id) {
        setImmediate(() => autoPostCheckinWorkflow(id, record).catch(err => {
          console.log(`[Auto workflow] Unhandled error for checkin #${id}: ${err.message}`);
        }));
      }

      sendJson(res, { saved: Boolean(id), id, emailNotificationSent: Boolean(emailNotification.sent) });
    } catch (err) {
      console.log(`[DB] checkin save endpoint error: ${err.message}`);
      sendJson(res, { saved: false });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/wise-operators") {
    try {
      const wmsToken = await getWmsBearerToken();
      if (!wmsToken) {
        sendJson(res, { operators: [], error: "WMS authentication unavailable" });
        return;
      }
      const operators = await fetchWiseOperators(`Bearer ${wmsToken}`);
      sendJson(res, { operators });
    } catch (err) {
      console.log(`[WISE operators] error: ${err.message}`);
      sendJson(res, { operators: [], error: "Operator lookup failed" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname.match(/^\/api\/checkins\/(\d+)\/load-task$/)) {
    if (!requireAdminChangeToken(req, res)) return;
    const id = Number(url.pathname.match(/\/api\/checkins\/(\d+)\/load-task/)[1]);
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const record = await db.getCheckinById(id);
      if (!record) { sendJson(res, { created: false, error: "Check-in not found or not a Valley View record" }, 404); return; }
      if (record.direction === "inbound") {
        await db.updateLoadTask(id, { loadTaskStatus: "not_applicable", loadTaskError: "Load task generation is for outbound loads only. Inbound receipts are processed through the receiving workflow." });
        sendJson(res, { created: false, error: "Load task generation is for outbound loads only. Inbound receipts are processed through the receiving workflow." });
        return;
      }
      const operatorId = payload.operatorId;
      const operatorName = payload.operatorName || "";
      if (!operatorId) { sendJson(res, { created: false, error: "Please select a WISE operator before generating a load task." }, 400); return; }
      const loadId = record.load_id || record.wms_load_no || "";
      if (!loadId) {
        await db.updateLoadTask(id, { wiseOperatorId: operatorId, wiseOperatorName: operatorName, loadTaskStatus: "blocked", loadTaskError: "No WMS load ID available for this check-in. A load task requires a confirmed load ID from WMS." });
        sendJson(res, { created: false, error: "No WMS load ID available for this check-in. A load task requires a confirmed load ID from WMS." });
        return;
      }
      const dockId = payload.dockId || record.dock_id || "";
      if (!dockId) {
        await db.updateLoadTask(id, { wiseOperatorId: operatorId, wiseOperatorName: operatorName, loadTaskStatus: "blocked", loadTaskError: "No dock ID available. A dock assignment is required to generate a load task." });
        sendJson(res, { created: false, error: "No dock ID available. A dock assignment is required to generate a load task." });
        return;
      }
      const wmsToken = await getWmsBearerToken();
      if (!wmsToken) {
        sendJson(res, { created: false, error: "WMS authentication unavailable. Cannot create load task." });
        return;
      }
      const entryTask = (record.entry_task || "").toLowerCase();
      const loadMode = entryTask.includes("preload") ? "PRE_LOAD" : "LIVE_LOAD";
      const taskResult = await createWmsLoadTask(`Bearer ${wmsToken}`, {
        dockId,
        loadIds: [loadId],
        assigneeUserId: operatorId,
        entryId: record.et_number || "",
        loadMode,
        equipmentType: record.equipment_type || "",
        note: `Valley View check-in #${id}. Driver: ${record.driver_name || ""}. ET: ${record.et_number || ""}.`
      });
      if (taskResult.taskId) {
        await db.updateLoadTask(id, { wiseOperatorId: operatorId, wiseOperatorName: operatorName, loadTaskId: taskResult.taskId, loadTaskStatus: "created", loadTaskError: null, dockId });
        sendJson(res, { created: true, taskId: taskResult.taskId, message: "Load task created and assigned." });
      } else {
        await db.updateLoadTask(id, { wiseOperatorId: operatorId, wiseOperatorName: operatorName, loadTaskStatus: "failed", loadTaskError: taskResult.error || "Task creation failed" });
        sendJson(res, { created: false, error: taskResult.error || "Load task creation failed." });
      }
    } catch (err) {
      console.log(`[Load task] error: ${err.message}`);
      sendJson(res, { created: false, error: "Load task creation failed." }, 500);
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
    let entryValidationContext = {};
    try {
      const body = await readBody(req);
      const payload = asObject(JSON.parse(body || "{}"));
      const tripInfo = asObject(payload.tripInfo);
      const entryTaskTag = firstNonEmptyString(
        payload.entryTask,
        payload.entryTaskTag,
        payload.loadTypeGroup,
        tripInfo.entryTask,
        tripInfo.entryTaskTag,
        tripInfo.loadTypeGroup
      );
      entryValidationContext = {
        orderIds: validationIds(tripInfo.orderIds, tripInfo.orderId, payload.orderIds, payload.orderId),
        loadId: firstNonEmptyString(tripInfo.loadId),
        dockId: firstNonEmptyString(tripInfo.dockId),
        loadTaskId: firstNonEmptyString(tripInfo.loadTaskId),
        qrCreated: false
      };

      const ymsToken = await getYmsBearerToken();
      if (!ymsToken) {
        const validation = buildCheckinValidation(entryValidationContext);
        logCheckinValidation("yms-entry-ticket-auth-unavailable", "", validation);
        sendJson(res, { ok: false, etNumber: "", error: "YMS auth unavailable", validation }, 503);
        return;
      }

      const idempotencyKey = String(payload.idempotencyKey || payload.idempotencySignature || "").trim();
      if (idempotencyKey && ymsEtBySubmissionSignature.has(idempotencyKey)) {
        const cached = ymsEtBySubmissionSignature.get(idempotencyKey);
        console.log(`[YMS ET] Reusing ET ${cached.etNumber} for exact submission signature ${idempotencyKey.slice(0, 12)}`);
        if (cached.response) {
          sendJson(res, { ...cached.response, reused: true });
          return;
        }
        const validation = buildCheckinValidation({ etNumber: cached.etNumber, etCreated: true, qrCreated: false });
        logCheckinValidation("yms-entry-ticket-reuse-pending", cached.etNumber, validation);
        sendJson(res, { ok: true, etNumber: cached.etNumber, reused: true, validation, raw: cached.raw || {} });
        return;
      }

      // Step 1: Create blank ET and require a real ET number.
      const created = await createYmsEntryTicket(ymsToken);
      const etNumber = created.etNumber;
      if (!etNumber) {
        console.log(`[YMS ET] create returned without ET number raw=${JSON.stringify(created.raw || {}).slice(0, 2000)}`);
        const validation = buildCheckinValidation(entryValidationContext);
        logCheckinValidation("yms-entry-ticket-create-missing-et", "", validation);
        sendJson(res, { ok: false, etNumber: "", error: "YMS did not return an ET number", validation, raw: created.raw || {} }, 502);
        return;
      }
      entryValidationContext.etNumber = etNumber;
      entryValidationContext.etCreated = true;
      console.log(`[YMS ET] Created ET: ${etNumber}`);
      if (idempotencyKey) ymsEtBySubmissionSignature.set(idempotencyKey, { etNumber, raw: created.raw || {}, createdAt: Date.now() });

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
      if (tripInfo.loadId || tripInfo.customerId || tripInfo.receiptId || tripInfo.poNo) {
        try {
          await attachTripInfo(ymsToken, etNumber, tripInfo);
          tripInfoAttached = true;
          console.log(`[YMS ET] Trip info attached to ${etNumber}`);
        } catch (err) {
          console.log(`[YMS ET] Trip info attach failed for ${etNumber}: ${err.message}`);
        }
      }

      // Step 4: Complete self-check-in so ET moves to checked-in status
      let checkinCompleted = false;
      let checkinCompleteError = "";
      try {
        await ymsPostRequest(ymsToken, `/self-check-in/${encodeURIComponent(etNumber)}/complete-check-in`, {});
        checkinCompleted = true;
        console.log(`[YMS ET] Self-check-in completed for ${etNumber}`);
      } catch (err) {
        checkinCompleteError = err.message || "Complete check-in failed";
        console.log(`[YMS ET] Complete check-in failed for ${etNumber}: ${checkinCompleteError}`);
      }

      // Step 5: LIVE LOAD SOP — Create WMS Load Task first, then YMS task-entry-checkin, then finalize
      let activityLoadAdded = false;
      let activityLoadError = "";
      let windowCheckinCompleted = false;
      let windowCheckinError = "";
      let createdLoadTaskId = tripInfo.loadTaskId || "";
      let assignedDockId = "";
      let assignedDockName = tripInfo.dockName || "";
      let validationEntryStatus = "";
      let validationLoadLinked = false;
      let validationTaskPresent = false;
      let validationWiseSynced = false;
      const isOutbound = tripInfo.direction !== "inbound";
      const hasLoad = Boolean(tripInfo.loadId);
      const isPreload = /preload|pick.?up.?preload/i.test(entryTaskTag || "");
      const loadMode = isPreload ? "PRE_LOAD" : "LIVE_LOAD";
      const modeLabel = isPreload ? "Preload" : "Live Load";
      const inYardAction = /live.load|load|preload/i.test(entryTaskTag || "")
        ? (isOutbound ? "PRE_LOAD" : "DROP_OFF_RECEIVING")
        : (tripInfo.receiptId ? "DROP_OFF_RECEIVING" : "");

      if (checkinCompleted && (hasLoad || tripInfo.receiptId)) {
        const wmsToken = await getWmsBearerToken().catch(() => null);

        // Phase A: Resolve a verified numeric dock/location ID and reuse any existing load task.
        if (tripInfo.loadId && wmsToken) {
          try {
            const dockResolution = await resolveEtDock(etNumber, tripInfo, `Bearer ${wmsToken}`);
            assignedDockId = dockResolution.dockId;
            assignedDockName = dockResolution.dockName || assignedDockName;
            if (!createdLoadTaskId && dockResolution.loadTaskId) createdLoadTaskId = dockResolution.loadTaskId;
          } catch (e) {
            console.log(`[YMS ET] Dock resolution failed for ${etNumber}: ${e.message}`);
          }
        }

        if (!AUTO_OPERATOR_ID) {
          windowCheckinError = "No default operator configured. Guard must assign user and dock manually.";
        } else if (!assignedDockId) {
          windowCheckinError = "LOAD linked to ET, but WISE did not return a verified numeric dock/location ID. Load Task could not be created automatically; guard must assign the dock in WISE.";
        } else {
          // Phase B: Materialize WMS Load Task BEFORE any YMS finalization
          if (isOutbound && hasLoad && !createdLoadTaskId && wmsToken) {
            try {
              const ltResult = await createWmsLoadTask(`Bearer ${wmsToken}`, {
                dockId: assignedDockId,
                loadIds: [tripInfo.loadId],
                assigneeUserId: AUTO_OPERATOR_ID,
                entryId: etNumber,
                loadMode,
                note: `Auto ${modeLabel} SOP: ET=${etNumber} pickup=${tripInfo.loadNo || tripInfo.loadId} dock=${assignedDockId}`
              });
              if (ltResult.taskId) {
                createdLoadTaskId = ltResult.taskId;
                console.log(`[YMS ET] WMS Load Task CREATED (${modeLabel}): ${createdLoadTaskId} for ET=${etNumber} loadId=${tripInfo.loadId}`);
              } else {
                activityLoadError = `WMS Load Task creation (${modeLabel}) failed: ${ltResult.error || "unknown"}`;
                console.log(`[YMS ET] WMS Load Task FAILED (${modeLabel}) for ${etNumber}: ${activityLoadError}`);
              }
            } catch (ltErr) {
              activityLoadError = `WMS Load Task error: ${ltErr.message}`;
              console.log(`[YMS ET] WMS Load Task error for ${etNumber}: ${ltErr.message}`);
            }
          } else if (createdLoadTaskId) {
            console.log(`[YMS ET] Using existing WMS Load Task for ${etNumber}: ${createdLoadTaskId}`);
          }

          // Phase C: YMS task-entry-checkin — materialize the in-yard task
          let taskEntryDone = false;
          let taskEntryError = "";
          if (isOutbound && hasLoad) {
            const taskEntryBody = {
              entryId: etNumber,
              loadIds: [tripInfo.loadId],
              assignLocationId: assignedDockId,
              assigneeUserName: AUTO_OPERATOR_NAME,
              inYardAction: inYardAction || "PRE_LOAD",
              ...(createdLoadTaskId ? { taskId: createdLoadTaskId } : {})
            };
            console.log(`[YMS ET] task-entry-checkin PAYLOAD for ${etNumber}: ${JSON.stringify(taskEntryBody)}`);

            try {
              await ymsPostRequest(ymsToken, "/entry-ticket/task-entry-checkin", taskEntryBody);
              taskEntryDone = true;
              console.log(`[YMS ET] task-entry-checkin (${modeLabel}) completed for ${etNumber} loadIds=[${tripInfo.loadId}]`);
            } catch (err) {
              taskEntryError = err.message || "task-entry-checkin failed";
              console.log(`[YMS ET] task-entry-checkin (${modeLabel}) FAILED for ${etNumber}: ${taskEntryError}`);
            }
          } else if (tripInfo.receiptId) {
            const taskEntryBody = {
              entryId: etNumber,
              receiptIds: [tripInfo.receiptId],
              assignLocationId: assignedDockId,
              assigneeUserName: AUTO_OPERATOR_NAME,
              inYardAction: "DROP_OFF_RECEIVING"
            };
            console.log(`[YMS ET] task-entry-checkin (inbound) PAYLOAD for ${etNumber}: ${JSON.stringify(taskEntryBody)}`);
            try {
              await ymsPostRequest(ymsToken, "/entry-ticket/task-entry-checkin", taskEntryBody);
              taskEntryDone = true;
              console.log(`[YMS ET] task-entry-checkin (inbound) completed for ${etNumber} receiptIds=[${tripInfo.receiptId}]`);
            } catch (err) {
              taskEntryError = err.message || "task-entry-checkin failed";
              console.log(`[YMS ET] task-entry-checkin (inbound) FAILED for ${etNumber}: ${taskEntryError}`);
            }
          }

          // Phase D: task-info-checkin — finalize window check-in with outbound task assignment
          let taskInfoDone = false;
          let taskInfoError = "";
          const taskInfoBody = { entryId: etNumber, ...(tripInfo.customerId ? { customerId: tripInfo.customerId } : {}) };
          if (isOutbound && hasLoad) {
            taskInfoBody.outboundTripInfo = { customerId: tripInfo.customerId || "", loadIds: [tripInfo.loadId] };
            taskInfoBody.outboundTask = {
              assignLocationId: assignedDockId,
              assigneeUserId: AUTO_OPERATOR_ID,
              assigneeUserName: AUTO_OPERATOR_NAME,
              description: `Auto SOP: ${modeLabel} task=${createdLoadTaskId || "new"} dock=${assignedDockId}`
            };
          } else if (tripInfo.receiptId) {
            taskInfoBody.inboundTripInfo = { customerId: tripInfo.customerId || "", receiptIds: [tripInfo.receiptId] };
            taskInfoBody.inboundTask = {
              assignLocationId: assignedDockId,
              assigneeUserId: AUTO_OPERATOR_ID,
              assigneeUserName: AUTO_OPERATOR_NAME,
              description: `Inbound receipt ${tripInfo.receiptId}`
            };
          }

          console.log(`[YMS ET] task-info-checkin PAYLOAD for ${etNumber}: ${JSON.stringify(taskInfoBody)}`);
          try {
            await ymsPostRequest(ymsToken, "/entry-ticket/task-info-checkin", taskInfoBody);
            taskInfoDone = true;
            console.log(`[YMS ET] task-info-checkin (${modeLabel}) completed for ${etNumber}`);
          } catch (err) {
            taskInfoError = err.message || "task-info-checkin failed";
            console.log(`[YMS ET] task-info-checkin (${modeLabel}) FAILED for ${etNumber}: ${taskInfoError}`);
          }

          // Phase E: Readback verification with retries
          let verified = false;
          let verifyStatus = "";
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              if (attempt > 1) await new Promise((r) => setTimeout(r, 1500 * attempt));
              const detail = await ymsGetRequest(ymsToken, `/entry-ticket/${etNumber}/window-checkin-detail`);
              const readback = extractYmsReadback(detail, tripInfo.loadId);
              validationEntryStatus = readback.entryStatus || validationEntryStatus;
              validationLoadLinked = readback.loadLinked;
              validationTaskPresent = readback.taskPresent;
              validationWiseSynced = Boolean(readback.wiseSynced && createdLoadTaskId && assignedDockId);

              console.log(`[YMS ET] Readback #${attempt} for ${etNumber}: status=${readback.entryStatus || "unknown"} hasLoad=${readback.loadLinked} hasTask=${readback.taskPresent} isDone=${readback.windowCheckinCompleted} loadTask=${createdLoadTaskId || "none"}`);

              if (readback.windowCheckinCompleted && readback.loadLinked && readback.taskPresent && createdLoadTaskId && assignedDockId) {
                verified = true;
                verifyStatus = readback.entryStatus || "WINDOW_CHECKED_IN";
                break;
              }
              verifyStatus = readback.entryStatus;
            } catch (readErr) {
              console.log(`[YMS ET] Readback #${attempt} failed: ${readErr.message}`);
            }
          }

          if (verified) {
            windowCheckinCompleted = true;
            activityLoadAdded = true;
            console.log(`[YMS ET] VERIFIED ${etNumber} mode=${modeLabel}: status=${verifyStatus} loadTask=${createdLoadTaskId} dock=${assignedDockId} operator=${AUTO_OPERATOR_NAME}`);
          } else if (taskInfoDone && createdLoadTaskId) {
            windowCheckinCompleted = false;
            activityLoadAdded = true;
            windowCheckinError = `LOAD vinculado, Load Task ${createdLoadTaskId} creado (${modeLabel}), pero YMS no confirmó Window Check-In (status=${verifyStatus || "unknown"}). Guard must open Window Check-In and Save and Continue.`;
            console.log(`[YMS ET] PARTIAL ${etNumber} mode=${modeLabel}: task created=${createdLoadTaskId} but readback not final. status=${verifyStatus}`);
          } else if (taskInfoDone && !createdLoadTaskId) {
            windowCheckinCompleted = false;
            activityLoadAdded = true;
            windowCheckinError = `LOAD vinculado, pero Load Task de ${modeLabel} no fue creado/activado; check-in incompleto. El guardia debe crear/confirmar Load Task en WISE/YMS.`;
            console.log(`[YMS ET] PARTIAL ${etNumber} mode=${modeLabel}: task-info accepted but no load task materialized`);
          } else {
            activityLoadError = taskInfoError || taskEntryError || "Final check-in steps did not complete.";
            console.log(`[YMS ET] FAILED ${etNumber} mode=${modeLabel}: taskInfo=${taskInfoDone} taskEntry=${taskEntryDone} loadTask=${createdLoadTaskId || "none"}`);
          }
        }
      } else if (!checkinCompleted) {
        windowCheckinError = "Self-check-in did not complete; cannot proceed with task assignment.";
        activityLoadError = windowCheckinError;
      } else if (!hasLoad && !tripInfo.receiptId) {
        activityLoadError = "No loadId or receiptId available to attach to Activity.";
      }

      // Step 6: Reject old pre-entry ETs for same load (safe: only NEED_WINDOW_CHECK_IN, not the new ET)
      let oldEtsRejected = [];
      let oldEtRejectionError = "";
      if (hasLoad && checkinCompleted) {
        try {
          const detail = await ymsGetRequest(ymsToken, `/entry-ticket/${etNumber}/window-checkin-detail`).catch(() => null);
          // Search for other ETs tied to same load by querying load's entry tickets
          // This is best-effort; if the API doesn't support search, skip gracefully
          console.log(`[YMS ET] Old ET rejection: skipped (safe — requires manual release of stale pre-entry ETs for load ${tripInfo.loadId})`);
        } catch (e) {
          oldEtRejectionError = `Old ET check skipped: ${e.message}`;
          console.log(`[YMS ET] ${oldEtRejectionError}`);
        }
      }

      const loadTaskId = createdLoadTaskId || tripInfo.loadTaskId || "";
      const orderId = tripInfo.orderId || "";
      const orderIds = validationIds(tripInfo.orderIds, orderId);
      const pickupNo = tripInfo.pickupNo || tripInfo.loadNo || "";
      const validation = buildCheckinValidation({
        etNumber,
        etCreated: true,
        orderIds,
        dnLinked: Boolean(tripInfoAttached && orderIds.length && validationLoadLinked),
        loadId: tripInfo.loadId,
        loadLinked: validationLoadLinked,
        dockId: assignedDockId,
        loadTaskId,
        loadTaskCreated: Boolean(loadTaskId),
        windowCheckinCompleted,
        qrCreated: false,
        wiseSynced: validationWiseSynced && windowCheckinCompleted,
        entryStatus: validationEntryStatus,
        syncStatus: validationWiseSynced ? "READBACK_CONFIRMED" : "READBACK_NOT_CONFIRMED"
      });
      logCheckinValidation("yms-entry-ticket", etNumber, validation);
      const responsePayload = {
        ok: true, etNumber, basicInfoAttached, tripInfoAttached,
        checkinCompleted, checkinCompleteError,
        activityLoadAdded, activityLoadError: activityLoadError || "",
        windowCheckinCompleted, windowCheckinError: windowCheckinError || "",
        assignedOperator: windowCheckinCompleted ? AUTO_OPERATOR_NAME : "",
        assignedOperatorId: windowCheckinCompleted ? AUTO_OPERATOR_ID : "",
        assignedDockId: assignedDockId || "",
        assignedDockName: assignedDockName || "",
        loadId: tripInfo.loadId || "",
        loadNo: tripInfo.loadNo || "",
        loadTaskId: loadTaskId || "",
        orderId: orderId || "",
        orderIds,
        pickupNo: pickupNo || "",
        receiptId: tripInfo.receiptId || "",
        containerNo: tripInfo.containerNo || "",
        oldEtsRejected,
        oldEtRejectionError: oldEtRejectionError || "",
        loadTaskStatus: windowCheckinCompleted ? "window_checked_in" : (loadTaskId ? "task_created" : "pending"),
        loadTaskError: windowCheckinError || (!loadTaskId && hasLoad ? "No WMS load task exists for this load. Guard/warehouse must create and assign it." : ""),
        wiseSynced: validationWiseSynced && windowCheckinCompleted,
        validation,
        emailNotificationSent: false, raw: created.raw || {}
      };
      if (idempotencyKey) {
        ymsEtBySubmissionSignature.set(idempotencyKey, { etNumber, raw: created.raw || {}, createdAt: Date.now(), response: responsePayload });
      }
      sendJson(res, responsePayload);
    } catch (err) {
      console.log(`[YMS ET] endpoint error: ${err.message}`);
      const validation = buildCheckinValidation(entryValidationContext);
      logCheckinValidation("yms-entry-ticket-error", entryValidationContext.etNumber || "", validation);
      sendJson(res, {
        ok: false,
        etNumber: entryValidationContext.etNumber || "",
        error: err.message === "YMS did not return an ET number" ? "YMS did not return an ET number" : "ET creation failed",
        validation
      }, 502);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/yms-window-checkin-complete") {
    try {
      const body = await readBody(req);
      const payload = asObject(JSON.parse(body || "{}"));
      const etNumber = firstNonEmptyString(payload.etNumber);
      const loadId = firstNonEmptyString(payload.loadId);
      const orderIds = validationIds(payload.orderIds, payload.orderId);
      const requestedDockId = firstNonEmptyString(payload.dockId);
      const requestedLoadTaskId = firstNonEmptyString(payload.loadTaskId);
      const customerId = firstNonEmptyString(payload.customerId);
      const assigneeUserId = firstNonEmptyString(payload.assigneeUserId);
      const assigneeUserName = firstNonEmptyString(payload.assigneeUserName);

      const respondWithValidation = (context = {}, extra = {}, statusCode = 200) => {
        const validation = buildCheckinValidation({
          etNumber,
          etCreated: Boolean(etNumber),
          orderIds,
          dnLinked: Boolean(orderIds.length && context.loadLinked),
          loadId,
          loadLinked: Boolean(context.loadLinked),
          dockId: firstNonEmptyString(context.dockId, requestedDockId),
          loadTaskId: firstNonEmptyString(context.loadTaskId, requestedLoadTaskId),
          loadTaskCreated: Boolean(firstNonEmptyString(context.loadTaskId, requestedLoadTaskId)),
          windowCheckinCompleted: Boolean(context.windowCheckinCompleted),
          qrCreated: false,
          wiseSynced: Boolean(context.wiseSynced),
          entryStatus: context.entryStatus,
          syncStatus: context.wiseSynced ? "READBACK_CONFIRMED" : "READBACK_NOT_CONFIRMED"
        });
        logCheckinValidation("yms-window-checkin-complete", etNumber, validation);
        sendJson(res, {
          completed: validation.steps.find((step) => step.key === "windowCheckinCompleted")?.passed === true,
          etNumber,
          status: firstNonEmptyString(context.entryStatus),
          validation,
          ...extra
        }, statusCode);
      };

      if (!etNumber) {
        respondWithValidation({}, { reason: "ET number is required." }, 400);
        return;
      }
      if (!loadId) {
        respondWithValidation({}, { reason: "A confirmed WMS LOAD is required." }, 400);
        return;
      }

      const ymsToken = await getYmsBearerToken();
      if (!ymsToken) {
        respondWithValidation({}, { reason: "YMS authentication is unavailable." }, 503);
        return;
      }

      let etDetail;
      try {
        etDetail = await ymsGetRequest(ymsToken, "/entry-ticket/" + encodeURIComponent(etNumber) + "/window-checkin-detail");
      } catch {
        try {
          etDetail = await ymsGetRequest(ymsToken, "/self-check-in/" + encodeURIComponent(etNumber) + "/entry-detail");
        } catch {
          respondWithValidation({}, { reason: "WISE/YMS detail could not be read. Please retry." });
          return;
        }
      }

      let readback = extractYmsReadback(etDetail, loadId);
      const detailValue = asObject(etDetail?.data || etDetail);
      const createdSource = firstNonEmptyString(detailValue.createdSource);
      let loadTaskId = firstNonEmptyString(requestedLoadTaskId, detailValue.loadTaskId, readback.loadTaskId);
      let dockId = firstNonEmptyString(requestedDockId, readback.dockId, detailValue.dockId, detailValue.locationId);
      console.log(`[YMS window] ET=${etNumber} status=${readback.entryStatus || "unknown"} source=${createdSource || "unknown"} loadTask=${loadTaskId || "none"} dock=${dockId || "none"}`);

      const readbackContext = () => ({
        ...readback,
        dockId,
        loadTaskId,
        wiseSynced: Boolean(readback.wiseSynced && numericDockId(dockId) && loadTaskId)
      });

      if (readback.windowCheckinCompleted || loadTaskId) {
        respondWithValidation(readbackContext(), {
          reason: readback.windowCheckinCompleted
            ? "Window Check-In readback completed."
            : "Load Task exists, but final Window Check-In readback is still pending."
        });
        return;
      }
      if (createdSource && createdSource !== "SELF_CHECKIN") {
        respondWithValidation(readbackContext(), { reason: "This ET is not eligible for self-service Window Check-In." });
        return;
      }
      if (readback.entryStatus && readback.entryStatus !== "NEED_WINDOW_CHECK_IN" && readback.entryStatus !== "NEW") {
        respondWithValidation(readbackContext(), { reason: "This ET is not currently eligible for Window Check-In." });
        return;
      }
      if (!numericDockId(dockId)) {
        respondWithValidation(readbackContext(), { reason: "A verified numeric dock/location ID is required." });
        return;
      }

      if (payload.driverInfo || payload.vehicleInfo) {
        try {
          await attachBasicInfo(ymsToken, etNumber, payload);
          console.log(`[YMS window] Basic info refreshed for ${etNumber}`);
        } catch (err) {
          console.log(`[YMS window] Basic info refresh failed for ${etNumber}: ${err.message}`);
        }
      }

      try {
        await attachTripInfo(ymsToken, etNumber, {
          direction: payload.direction || "outbound",
          customerId,
          loadId,
          loadNo: payload.loadNo || "",
          receiptId: payload.receiptId || "",
          poNo: payload.poNo || "",
          referenceNo: payload.referenceNo || ""
        });
        console.log(`[YMS window] Trip info refreshed for ${etNumber}`);
      } catch (err) {
        console.log(`[YMS window] Trip info refresh failed for ${etNumber}: ${err.message}`);
      }

      const taskBody = {
        entryId: etNumber,
        outboundTripInfo: { customerId, loadIds: [loadId] },
        outboundTask: {
          assignLocationId: numericDockId(dockId),
          assigneeUserId,
          assigneeUserName,
          description: `Self-check-in window completion for load ${loadId}`
        }
      };

      try {
        await ymsPostRequest(ymsToken, "/entry-ticket/task-info-checkin", taskBody);
        console.log(`[YMS window] task-info-checkin accepted for ${etNumber}; verifying readback`);
      } catch (err) {
        console.log(`[YMS window] task-info-checkin failed for ${etNumber}: ${err.message}`);
        respondWithValidation(readbackContext(), { reason: "Window Check-In was not accepted. Guard review is required." });
        return;
      }

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
          const detail = await ymsGetRequest(ymsToken, "/entry-ticket/" + encodeURIComponent(etNumber) + "/window-checkin-detail");
          readback = extractYmsReadback(detail, loadId);
          const value = asObject(detail?.data || detail);
          loadTaskId = firstNonEmptyString(loadTaskId, value.loadTaskId, readback.loadTaskId);
          dockId = firstNonEmptyString(dockId, readback.dockId, value.dockId, value.locationId);
          console.log(`[YMS window] Readback #${attempt} ET=${etNumber} status=${readback.entryStatus || "unknown"} load=${readback.loadLinked} task=${readback.taskPresent} window=${readback.windowCheckinCompleted}`);
          if (readback.windowCheckinCompleted && readback.loadLinked && readback.taskPresent) break;
        } catch (err) {
          console.log(`[YMS window] Readback #${attempt} failed for ${etNumber}: ${err.message}`);
        }
      }

      const context = readbackContext();
      respondWithValidation(context, {
        reason: context.wiseSynced
          ? "Window Check-In and WISE/YMS synchronization confirmed."
          : "Window Check-In is still awaiting final WISE/YMS readback."
      });
    } catch (err) {
      console.log(`[YMS window] endpoint error: ${err.message}`);
      const validation = buildCheckinValidation({ qrCreated: false });
      logCheckinValidation("yms-window-checkin-error", "", validation);
      sendJson(res, { completed: false, reason: "Window Check-In could not be validated.", validation });
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
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onData = (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) {
        settle(reject, new Error("Request body too large"));
        req.destroy();
      }
    };
    const onEnd = () => settle(resolve, body);
    const onError = (err) => settle(reject, err);
    const onAborted = () => settle(reject, Object.assign(new Error("Request aborted by client"), { code: "ECONNRESET" }));
    function cleanup() {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
      req.off("close", onAborted);
    }
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
    req.on("close", () => {
      if (!req.complete) onAborted();
    });
  });
}

function sendJson(res, data, status = 200) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  } catch (err) {
    if (err && (err.code === "ECONNRESET" || err.message === "aborted")) {
      console.log(`[Server] Response skipped because client disconnected: ${err.code || err.message}`);
      return;
    }
    throw err;
  }
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

function ymsGetRequest(ymsToken, path) {
  return new Promise((resolve, reject) => {
    const reqUrl = new URL(`${YMS_BASE_URL}${path}`);
    const mod = reqUrl.protocol === "https:" ? https : http;
    const req = mod.request(reqUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ymsToken}`,
        "X-Tenant-ID": WMS_TENANT_ID,
        "X-Yard-ID": WMS_FACILITY_ID,
        "x-facility-id": WMS_FACILITY_ID,
        "Item-Time-Zone": TIMEZONE,
        Accept: "application/json"
      },
      timeout: 8000
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed?.data || parsed);
          else reject(new Error(`YMS GET ${path} status=${res.statusCode}`));
        } catch (err) { reject(new Error(`YMS GET parse: ${err.message}`)); }
      });
    });
    req.on("error", (err) => reject(err));
    req.on("timeout", () => { req.destroy(); reject(new Error("YMS GET timeout")); });
    req.end();
  });
}

function ymsPostRequest(ymsToken, path, body) {
  return new Promise((resolve, reject) => {
    const reqUrl = new URL(`${YMS_BASE_URL}${path}`);
    const postBody = JSON.stringify(body);
    const mod = reqUrl.protocol === "https:" ? https : http;
    const req = mod.request(reqUrl, {
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
        "Content-Length": String(Buffer.byteLength(postBody))
      },
      timeout: 8000
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed?.data || parsed);
          else reject(new Error(`YMS POST ${path} status=${res.statusCode}`));
        } catch (err) { reject(new Error(`YMS POST parse: ${err.message}`)); }
      });
    });
    req.on("error", (err) => reject(err));
    req.on("timeout", () => { req.destroy(); reject(new Error("YMS POST timeout")); });
    req.write(postBody);
    req.end();
  });
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
    appointmentTime: match.appointmentTime || "",
    dockId: match.dockId || match.dockLocationId || match.locationId || "",
    dockName: match.dockName || match.dockLocationName || match.locationName || ""
  };
}

function formatWmsOrderLookupResult(match, rawInput) {
  return {
    type: "outbound",
    matchType: "dn-order",
    matchedIdentifier: rawInput,
    customer: match.customerName || match.customer || "",
    customerCode: match.customerCode || "",
    customerId: match.customerId || "",
    loadNo: match.loadNo || match.wmsLoadNo || match.referenceNo || "",
    loadId: match.loadId || match.load_id || "",
    orderIds: [match.id || match.orderId || match.orderNo || match.dnNo].filter(Boolean),
    orderId: match.id || match.orderId || match.orderNo || match.dnNo || "",
    poNo: match.poNo || match.purchaseOrderNo || "",
    referenceNo: match.referenceNo || match.refNo || "",
    soNo: Array.isArray(match.soNos) ? match.soNos.join(",") : (match.soNo || match.soNos || ""),
    carrierName: match.carrierName || "",
    appointmentTime: match.appointmentTime || match.appointment || "",
    dockId: match.dockId || match.dockLocationId || match.locationId || "",
    dockName: match.dockName || match.dockLocationName || match.locationName || ""
  };
}

function isStrongOrderLookupMatch(input, record) {
  const normalized = String(input || "").trim().toUpperCase();
  const withoutDn = normalized.replace(/^DN[-\s]*/i, "");
  const candidates = [
    record.id,
    record.orderId,
    record.orderNo,
    record.dnNo,
    record.dnNumber,
    record.soNo,
    record.soNumber,
    record.referenceNo,
    record.refNo,
    record.poNo,
    record.purchaseOrderNo,
    record.loadNo,
    record.wmsLoadNo
  ];
  if (Array.isArray(record.soNos)) candidates.push(...record.soNos);
  const tokens = candidates
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean);
  return tokens.some((token) => token === normalized || token === withoutDn || token.replace(/^DN[-\s]*/i, "") === withoutDn);
}

function wmsOrderLookup(keyword, authHeader) {
  return new Promise((resolve) => {
    const rawInput = String(keyword || "").trim();
    if (isGenericLookupInput(rawInput)) {
      resolve({ customer: "" });
      return;
    }
    const lookupUrl = new URL(`${WMS_BASE_URL}/wms-bam/outbound/order/search-by-paging`);
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
          const raw = parsed?.data?.list || parsed?.data?.records || parsed?.data || [];
          const list = Array.isArray(raw) ? raw : [];
          const match = list.find((item) => (item?.customerName || item?.customer || item?.customerId) && isStrongOrderLookupMatch(rawInput, item));
          if (match) {
            const result = formatWmsOrderLookupResult(match, rawInput);
            console.log(`[WMS order lookup] identifier=${rawInput} -> order="${result.orderId}" loadNo="${result.loadNo}" customer="${result.customer}"`);
            resolve(result);
          } else {
            console.log(`[WMS order lookup] identifier=${rawInput} -> no exact DN/order/SO match (${list.length} results)`);
            resolve({ customer: "" });
          }
        } catch (err) {
          console.log(`[WMS order lookup] identifier=${rawInput} -> parse error: ${err.message}`);
          resolve({ customer: "" });
        }
      });
    });
    req.on("error", (err) => {
      console.log(`[WMS order lookup] identifier=${rawInput} -> network error: ${err.message}`);
      resolve({ customer: "" });
    });
    req.on("timeout", () => {
      console.log(`[WMS order lookup] identifier=${rawInput} -> timeout`);
      req.destroy();
      resolve({ customer: "" });
    });
    req.write(postBody);
    req.end();
  });
}

async function wmsLookupAny(identifier, authHeader) {
  const loadResult = await wmsLookup(identifier, authHeader);
  if (loadResult.customer) return loadResult;
  const orderResult = await wmsOrderLookup(identifier, authHeader);
  if (orderResult.customer) return orderResult;
  return { customer: "" };
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
          });
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
      statuses: OUTBOUND_INVENTORY_STATUSES,
      excludeStatuses: EXCLUDED_INVENTORY_STATUSES,
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
          const raw = parsed?.data?.inventories || parsed?.data?.list || parsed?.data?.records || parsed?.data || [];
          const rows = Array.isArray(raw) ? raw : [];
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

function wmsJsonRequest(authHeader, method, apiPath, payload) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(`${WMS_BASE_URL}${apiPath}`);
    const postBody = payload === undefined ? "" : JSON.stringify(payload);
    const headers = {
      Authorization: authHeader,
      "x-tenant-id": WMS_TENANT_ID,
      "x-facility-id": WMS_FACILITY_ID,
      "item-time-zone": TIMEZONE,
      Accept: "application/json"
    };
    if (postBody) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(postBody);
    }
    const mod = requestUrl.protocol === "https:" ? https : http;
    const req = mod.request(requestUrl, { method, headers, timeout: 8000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${method} ${apiPath} status=${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body || "{}"));
        } catch (err) {
          reject(new Error(`${method} ${apiPath} parse error: ${err.message}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`${method} ${apiPath} timeout`)));
    if (postBody) req.write(postBody);
    req.end();
  });
}

function extractWmsList(response) {
  const raw = response?.data?.list
    || response?.data?.records
    || response?.data?.tasks
    || response?.data?.locations
    || response?.data
    || [];
  return Array.isArray(raw) ? raw : [];
}

function extractDockCandidate(record) {
  const value = asObject(record);
  const dock = asObject(value.dock);
  const dockLocation = asObject(value.dockLocation);
  const location = asObject(value.location);
  const loadTask = asObject(value.loadTask);
  return {
    dockId: firstNonEmptyString(
      value.dockId,
      value.dockLocationId,
      value.locationId,
      dock.id,
      dockLocation.id,
      location.id,
      loadTask.dockId,
      loadTask.dockLocationId
    ),
    dockName: firstNonEmptyString(
      value.dockName,
      value.dockLocationName,
      value.locationName,
      dock.name,
      dockLocation.name,
      location.name,
      loadTask.dockName,
      loadTask.dockLocationName
    )
  };
}

function numericDockId(value) {
  const normalized = firstNonEmptyString(value);
  return /^\d+$/.test(normalized) ? normalized : "";
}

function normalizedDockName(value) {
  return firstNonEmptyString(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function extractDockNameToken(value) {
  const text = firstNonEmptyString(value);
  const match = text.match(/\bDOCK[\s_-]*\d+\b/i);
  return match ? match[0] : text;
}

function chooseDockCandidate(etNumber, source, candidate) {
  const rawId = firstNonEmptyString(candidate?.dockId);
  const dockName = firstNonEmptyString(candidate?.dockName);
  if (!rawId) {
    if (dockName) console.log(`[YMS ET] Dock candidate rejected for ${etNumber}: source=${source} reason=missing_numeric_id name=${dockName}`);
    return { dockId: "", dockName };
  }
  const dockId = numericDockId(rawId);
  if (!dockId) {
    console.log(`[YMS ET] Dock candidate rejected for ${etNumber}: source=${source} reason=non_numeric_id candidate=${rawId} name=${dockName || "none"}`);
    return { dockId: "", dockName };
  }
  console.log(`[YMS ET] Dock resolved for ${etNumber}: source=${source} dockId=${dockId} name=${dockName || "none"}`);
  return { dockId, dockName };
}

async function findExistingLoadTaskDock(loadId, authHeader) {
  const response = await wmsJsonRequest(authHeader, "POST", "/wms-bam/outbound/load-task/search-by-paging", {
    loadIds: [loadId],
    excludeStatuses: ["CANCELLED", "FORCE_CLOSED"],
    currentPage: 1,
    pageSize: 20
  });
  const tasks = extractWmsList(response);
  console.log(`[YMS ET] Load Task dock lookup: loadId=${loadId} tasks=${tasks.length}`);
  for (const task of tasks) {
    const taskId = firstNonEmptyString(task?.id, task?.taskId);
    const candidate = extractDockCandidate(task);
    if (candidate.dockId || candidate.dockName) return { ...candidate, taskId, source: "load_task_search" };
    if (!taskId) continue;
    try {
      const detail = await wmsJsonRequest(authHeader, "GET", `/wms-bam/outbound/load-task/${encodeURIComponent(taskId)}`);
      const detailCandidate = extractDockCandidate(detail?.data || detail);
      if (detailCandidate.dockId || detailCandidate.dockName) {
        return { ...detailCandidate, taskId, source: "load_task_detail" };
      }
    } catch (err) {
      console.log(`[YMS ET] Load Task detail lookup rejected: loadId=${loadId} taskId=${taskId} reason=${err.message}`);
    }
  }
  return { dockId: "", dockName: "", taskId: firstNonEmptyString(tasks[0]?.id, tasks[0]?.taskId), source: "load_task_search" };
}

async function findLoadDetailDock(loadId, authHeader) {
  const response = await wmsJsonRequest(authHeader, "GET", `/wms-bam/outbound/load/${encodeURIComponent(loadId)}`);
  return { ...extractDockCandidate(response?.data || response), source: "load_detail" };
}

async function resolveDockNameLocation(etNumber, dockName, authHeader, source) {
  const dockNameToken = extractDockNameToken(dockName);
  const normalizedName = normalizedDockName(dockNameToken);
  if (!/^DOCK\d+$/.test(normalizedName)) {
    console.log(`[YMS ET] Dock name candidate rejected for ${etNumber}: source=${source} reason=not_dock_name name=${dockName}`);
    return { dockId: "", dockName };
  }
  const response = await wmsJsonRequest(authHeader, "POST", "/wms-bam/wms-location/search", {
    keyword: dockNameToken,
    types: ["DOCK"],
    statuses: ["USABLE"],
    currentPage: 1,
    pageSize: 20
  });
  const locations = extractWmsList(response);
  for (const location of locations) {
    const locationName = firstNonEmptyString(location?.name, location?.akaName);
    const locationType = firstNonEmptyString(location?.type, location?.category).toUpperCase();
    if (normalizedDockName(locationName) !== normalizedName) {
      console.log(`[YMS ET] Dock location candidate rejected for ${etNumber}: source=${source} reason=name_mismatch candidate=${locationName || "none"}`);
      continue;
    }
    if (locationType !== "DOCK") {
      console.log(`[YMS ET] Dock location candidate rejected for ${etNumber}: source=${source} reason=not_dock_type type=${locationType || "none"}`);
      continue;
    }
    const chosen = chooseDockCandidate(etNumber, `${source}_location_lookup`, { dockId: location?.id, dockName: locationName });
    if (chosen.dockId) return chosen;
  }
  console.log(`[YMS ET] Dock name resolution failed for ${etNumber}: source=${source} name=${dockName} matches=${locations.length}`);
  return { dockId: "", dockName };
}

async function resolveEtDock(etNumber, tripInfo, authHeader) {
  let selected = chooseDockCandidate(etNumber, "trip_info", { dockId: tripInfo.dockId, dockName: tripInfo.dockName });
  let existingLoadTaskId = firstNonEmptyString(tripInfo.loadTaskId);
  const dockNames = [];
  if (selected.dockName) dockNames.push({ name: selected.dockName, source: "trip_info" });

  if (!selected.dockId) {
    const stagedResult = await lookupStagedDoor(tripInfo.loadId, authHeader);
    const stagedIsDock = stagedResult?.source === "dock_location"
      || firstNonEmptyString(stagedResult?.locationType, stagedResult?.locationCategory).toUpperCase() === "DOCK";
    if (stagedIsDock) {
      selected = chooseDockCandidate(etNumber, "staged_inventory", {
        dockId: stagedResult.locationId || stagedResult.dockId,
        dockName: stagedResult.locationName || stagedResult.door
      });
    } else if (stagedResult?.locationId || stagedResult?.locationName) {
      console.log(`[YMS ET] Dock candidate rejected for ${etNumber}: source=staged_inventory reason=location_is_not_dock locationId=${stagedResult.locationId || "none"} type=${stagedResult.locationType || stagedResult.locationCategory || "none"} name=${stagedResult.locationName || "none"}`);
    }
    if (stagedResult?.locationName) dockNames.push({ name: stagedResult.locationName, source: "staged_inventory" });
    if (stagedResult?.door) dockNames.push({ name: stagedResult.door, source: "staged_inventory_door" });
  }

  try {
    const loadTaskResult = await findExistingLoadTaskDock(tripInfo.loadId, authHeader);
    if (loadTaskResult.taskId) {
      existingLoadTaskId = loadTaskResult.taskId;
      console.log(`[YMS ET] Existing WMS Load Task found for ${etNumber}: taskId=${existingLoadTaskId}`);
    }
    if (!selected.dockId) selected = chooseDockCandidate(etNumber, loadTaskResult.source, loadTaskResult);
    if (loadTaskResult.dockName) dockNames.push({ name: loadTaskResult.dockName, source: loadTaskResult.source });
  } catch (err) {
    console.log(`[YMS ET] Load Task dock lookup failed for ${etNumber}: ${err.message}`);
  }

  if (!selected.dockId) {
    try {
      const loadDetailResult = await findLoadDetailDock(tripInfo.loadId, authHeader);
      selected = chooseDockCandidate(etNumber, loadDetailResult.source, loadDetailResult);
      if (loadDetailResult.dockName) dockNames.push({ name: loadDetailResult.dockName, source: loadDetailResult.source });
    } catch (err) {
      console.log(`[YMS ET] Load detail dock lookup failed for ${etNumber}: ${err.message}`);
    }
  }

  if (!selected.dockId) {
    const uniqueNames = [...new Map(dockNames.filter((item) => item.name).map((item) => [normalizedDockName(item.name), item])).values()];
    for (const candidate of uniqueNames) {
      try {
        const resolved = await resolveDockNameLocation(etNumber, candidate.name, authHeader, candidate.source);
        if (resolved.dockId) {
          selected = resolved;
          break;
        }
      } catch (err) {
        console.log(`[YMS ET] Dock name lookup failed for ${etNumber}: source=${candidate.source} name=${candidate.name} reason=${err.message}`);
      }
    }
  }

  if (!selected.dockId) console.log(`[YMS ET] Dock unresolved for ${etNumber}: loadId=${tripInfo.loadId} no verified numeric dock/location ID found`);
  return { ...selected, loadTaskId: existingLoadTaskId };
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

async function fetchWiseOperators(authHeader) {
  const allRows = [];
  const pageSize = 200;
  for (let currentPage = 1; currentPage <= 10; currentPage += 1) {
    const pageRows = await fetchWiseOperatorsPage(authHeader, currentPage, pageSize);
    allRows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }
  const seen = new Set();
  const operators = allRows
    .filter((u) => {
      const status = String(u.status || u.userStatus || u.accountStatus || "").toUpperCase();
      return !status || status === "ACTIVE" || status === "ENABLE" || status === "ENABLED";
    })
    .map((u) => {
      const id = String(u.userId || u.id || u.user_id || "");
      const fullName = u.fullName || u.displayName || [u.firstName, u.lastName].filter(Boolean).join(" ") || "";
      const username = u.userName || u.name || u.username || "";
      const name = fullName || username;
      return { id, name, userName: username, fullName, email: u.email || "" };
    })
    .filter((o) => {
      if (!o.id || !o.name || seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  console.log(`[WISE users] Found ${operators.length} active Valley View users`);
  return operators;
}

function fetchWiseOperatorsPage(authHeader, currentPage, pageSize) {
  return new Promise((resolve) => {
    const searchUrl = new URL(`${WMS_BASE_URL}/wms-bam/user/facility/search-by-paging`);
    const postBody = JSON.stringify({ facilityIds: [WMS_FACILITY_ID], currentPage, pageNo: currentPage, pageSize });
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
    }, (resHttp) => {
      let body = "";
      resHttp.on("data", (chunk) => { body += chunk; });
      resHttp.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const raw = parsed?.data?.list || parsed?.data?.records || parsed?.data?.rows || parsed?.data || [];
          const rows = Array.isArray(raw) ? raw : [];
          resolve(rows);
        } catch (err) {
          console.log(`[WISE users] parse error: ${err.message}`);
          resolve([]);
        }
      });
    });
    req.on("error", (err) => {
      console.log(`[WISE users] network error: ${err.message}`);
      resolve([]);
    });
    req.on("timeout", () => {
      console.log(`[WISE users] timeout`);
      req.destroy();
      resolve([]);
    });
    req.write(postBody);
    req.end();
  });
}

function createWmsLoadTask(authHeader, params) {
  return new Promise((resolve) => {
    const dockId = numericDockId(params.dockId);
    if (!dockId) {
      const rejectedDockId = firstNonEmptyString(params.dockId) || "missing";
      console.log(`[Load task] Creation rejected: reason=non_numeric_dock_id candidate=${rejectedDockId}`);
      resolve({ taskId: null, error: "A verified numeric dock/location ID is required." });
      return;
    }
    const taskUrl = new URL(`${WMS_BASE_URL}/wms/outbound/load-task/create`);
    const postBody = JSON.stringify({
      dockId,
      loadIds: params.loadIds,
      assigneeUserId: params.assigneeUserId,
      entryId: params.entryId || undefined,
      loadMode: params.loadMode || "LIVE_LOAD",
      equipmentType: params.equipmentType || undefined,
      note: params.note || ""
    });
    const mod = taskUrl.protocol === "https:" ? https : http;
    const req = mod.request(taskUrl, {
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
      timeout: 10000
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const taskId = parsed?.data?.id || parsed?.data || "";
          if (taskId && res.statusCode < 300) {
            console.log(`[Load task] Created: ${taskId}`);
            resolve({ taskId: String(taskId) });
          } else {
            const errMsg = parsed?.msg || parsed?.message || `Status ${res.statusCode}`;
            console.log(`[Load task] Creation failed: ${errMsg}`);
            resolve({ taskId: null, error: errMsg });
          }
        } catch (err) {
          console.log(`[Load task] parse error: ${err.message}`);
          resolve({ taskId: null, error: "Response parse error" });
        }
      });
    });
    req.on("error", (err) => {
      console.log(`[Load task] network error: ${err.message}`);
      resolve({ taskId: null, error: "Network error" });
    });
    req.on("timeout", () => {
      console.log(`[Load task] timeout`);
      req.destroy();
      resolve({ taskId: null, error: "Request timeout" });
    });
    req.write(postBody);
    req.end();
  });
}

// --- Automatic post-check-in workflow ---
// For outbound check-ins: create WMS load task assigned to RMorales, then send ops email.
const AUTO_OPERATOR_ID = "1853651235951439312";
const AUTO_OPERATOR_NAME = "Ryan Morales";
const OPS_EMAIL_RECIPIENT = "Juan.barragan@unisco.com";

async function autoPostCheckinWorkflow(checkinId, record) {
  const direction = record.direction || "";
  const isOutbound = direction !== "inbound";
  let loadTaskResult = { status: "not_applicable", taskId: null, error: null };

  if (isOutbound) {
    loadTaskResult = await autoCreateLoadTask(checkinId, record);
  } else {
    loadTaskResult = { status: "not_applicable", taskId: null, error: "Inbound receipt — load task not applicable." };
    try {
      await db.updateLoadTask(checkinId, { loadTaskStatus: "not_applicable", loadTaskError: loadTaskResult.error });
    } catch (e) { console.log(`[Auto workflow] DB update failed: ${e.message}`); }
  }

  await autoSendOpsEmail(checkinId, record, loadTaskResult);
}

async function autoCreateLoadTask(checkinId, record) {
  const loadId = record.loadId || record.load_id || record.wmsLoadNo || record.wms_load_no || "";
  if (!loadId) {
    const msg = "No WMS load ID available. Automatic load task creation requires a confirmed load ID.";
    console.log(`[Auto load task] checkin #${checkinId}: ${msg}`);
    try { await db.updateLoadTask(checkinId, { wiseOperatorId: AUTO_OPERATOR_ID, wiseOperatorName: AUTO_OPERATOR_NAME, loadTaskStatus: "blocked", loadTaskError: msg }); } catch (e) {}
    return { status: "blocked", taskId: null, error: msg };
  }

  const dockId = record.dockId || record.dock_id || "";
  if (!dockId) {
    const msg = "No dock ID available. A numeric dock/location ID is required for load task creation. Door assignment text alone is not sufficient.";
    console.log(`[Auto load task] checkin #${checkinId}: ${msg}`);
    try { await db.updateLoadTask(checkinId, { wiseOperatorId: AUTO_OPERATOR_ID, wiseOperatorName: AUTO_OPERATOR_NAME, loadTaskStatus: "blocked", loadTaskError: msg }); } catch (e) {}
    return { status: "blocked", taskId: null, error: msg };
  }

  let wmsToken;
  try { wmsToken = await getWmsBearerToken(); } catch (e) {}
  if (!wmsToken) {
    const msg = "WMS authentication unavailable. Load task will need to be created manually.";
    console.log(`[Auto load task] checkin #${checkinId}: ${msg}`);
    try { await db.updateLoadTask(checkinId, { wiseOperatorId: AUTO_OPERATOR_ID, wiseOperatorName: AUTO_OPERATOR_NAME, loadTaskStatus: "blocked", loadTaskError: msg }); } catch (e) {}
    return { status: "blocked", taskId: null, error: msg };
  }

  const entryTask = (record.entryTask || record.entry_task || "").toLowerCase();
  const loadMode = entryTask.includes("preload") ? "PRE_LOAD" : "LIVE_LOAD";
  const driverName = record.driverName || record.driver_name || "";
  const etNumber = record.etNumber || record.et_number || "";

  console.log(`[Auto load task] checkin #${checkinId}: Creating load task for loadId=${loadId}, dockId=${dockId}, operator=${AUTO_OPERATOR_NAME}`);
  const taskResult = await createWmsLoadTask(`Bearer ${wmsToken}`, {
    dockId,
    loadIds: [loadId],
    assigneeUserId: AUTO_OPERATOR_ID,
    entryId: etNumber,
    loadMode,
    equipmentType: record.equipmentType || record.equipment_type || "",
    note: `Auto-assigned Valley View check-in #${checkinId}. Driver: ${driverName}. ET: ${etNumber}.`
  });

  if (taskResult.taskId) {
    console.log(`[Auto load task] checkin #${checkinId}: Task created successfully: ${taskResult.taskId}`);
    try { await db.updateLoadTask(checkinId, { wiseOperatorId: AUTO_OPERATOR_ID, wiseOperatorName: AUTO_OPERATOR_NAME, loadTaskId: taskResult.taskId, loadTaskStatus: "created", loadTaskError: null, dockId }); } catch (e) {}
    return { status: "created", taskId: taskResult.taskId, error: null };
  } else {
    const errMsg = taskResult.error || "Task creation failed";
    console.log(`[Auto load task] checkin #${checkinId}: Task creation failed: ${errMsg}`);
    try { await db.updateLoadTask(checkinId, { wiseOperatorId: AUTO_OPERATOR_ID, wiseOperatorName: AUTO_OPERATOR_NAME, loadTaskStatus: "failed", loadTaskError: errMsg, dockId }); } catch (e) {}
    return { status: "failed", taskId: null, error: errMsg };
  }
}

async function autoSendOpsEmail(checkinId, record, loadTaskResult) {
  if (!isEmailEnabled()) {
    console.log(`[Auto ops email] SMTP not configured; ops email for checkin #${checkinId} not sent.`);
    return;
  }

  const driverName = record.driverName || record.driver_name || [record.driverFirstName, record.driverLastName].filter(Boolean).join(" ") || "";
  const etNumber = record.etNumber || record.et_number || "";
  const doorAssignment = record.doorAssignment || record.door_assignment || "Not assigned";
  const direction = record.direction || "outbound";
  const customer = record.customer || "";
  const loadNo = record.loadNo || record.load_no || record.wmsLoadNo || record.wms_load_no || "";
  const referenceNo = record.referenceNo || record.reference_no || "";
  const poNo = record.poNo || record.po_no || "";
  const receiptId = record.receiptId || record.receipt_id || "";
  const carrier = record.carrierName || record.carrier_name || "";
  const equipment = record.equipmentNo || record.equipment_no || "";
  const entryTask = record.entryTask || record.entry_task || "";
  const phone = record.driverPhone || record.driver_phone || "";

  let taskLine;
  if (loadTaskResult.status === "created") {
    taskLine = `Load task created and assigned to ${AUTO_OPERATOR_NAME}. Task ID: ${loadTaskResult.taskId}`;
  } else if (loadTaskResult.status === "not_applicable") {
    taskLine = `Load task: Not applicable (${loadTaskResult.error || "inbound"})`;
  } else {
    taskLine = `Load task: ${loadTaskResult.status}. ${loadTaskResult.error || ""}`;
  }

  const subject = `Valley View Check-In ${etNumber ? "ET " + etNumber : "#" + checkinId} - ${driverName || "Driver"} - ${direction}`;
  const lines = [
    `Driver check-in completed at Valley View (LT_F1).`,
    ``,
    `ET#: ${etNumber || "N/A"}`,
    `Direction: ${direction}`,
    `Entry task: ${entryTask}`,
    `Dock door: ${doorAssignment}`,
    ``,
    `Driver: ${driverName}`,
    `Phone: ${phone}`,
    `Carrier: ${carrier}`,
    `Equipment: ${equipment}`,
    ``,
    `Customer: ${customer}`,
    `Load / RN: ${loadNo || receiptId || "N/A"}`,
    `PO: ${poNo || "N/A"}`,
    `Reference: ${referenceNo || "N/A"}`,
    ``,
    `--- Task Assignment ---`,
    taskLine,
    `Assigned operator: ${AUTO_OPERATOR_NAME}`,
    ``,
    `Dashboard: ${process.env.COOLIFY_URL || "https://driver-checkin-4178-49c078.coolify.item.pub"}/dashboard.html`,
    `Time: ${new Date().toLocaleString("en-US", { timeZone: TIMEZONE })} ${TIMEZONE}`
  ];

  const text = lines.join("\n");
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
    <h2 style="margin:0 0 8px">Valley View Driver Check-In</h2>
    <pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtmlServer(text)}</pre>
  </div>`;

  const recipients = new Set(ALERT_RECIPIENTS.map(e => e.toLowerCase()));
  recipients.add(OPS_EMAIL_RECIPIENT.toLowerCase());
  const toList = [...recipients];

  try {
    const transporter = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, auth: { user: SMTP_USER, pass: SMTP_PASS } });
    const info = await transporter.sendMail({ from: SMTP_FROM, to: toList, subject, text, html });
    console.log(`[Auto ops email] Sent for checkin #${checkinId} to ${toList.join(", ")} messageId=${info.messageId || ""}`);
  } catch (err) {
    console.log(`[Auto ops email] Send failed for checkin #${checkinId}: ${err.message}`);
  }
}
