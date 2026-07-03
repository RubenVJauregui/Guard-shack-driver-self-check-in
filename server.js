const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");

const root = __dirname;
const dataDir = path.join(root, "identity-records");
const port = Number(process.env.PORT || 4178);
const host = process.env.HOST || "0.0.0.0";

const WMS_BASE_URL = process.env.WMS_BASE_URL || "https://unis.item.com/api";
const WMS_AUTH_TOKEN = process.env.WMS_AUTH_TOKEN || "";
const WMS_USERNAME = process.env.WMS_USERNAME || "";
const WMS_PASSWORD_B64 = process.env.WMS_PASSWORD_B64 || "";
const WMS_PASSWORD_RAW = process.env.WMS_PASSWORD || "";
const WMS_TENANT_ID = process.env.WMS_TENANT_ID || "LT";
const WMS_FACILITY_ID = process.env.WMS_FACILITY_ID || "LT_F1";
const YMS_BASE_URL = process.env.YMS_BASE_URL || "https://traffic.item.com/api/yms";

function getWmsPassword() {
  if (WMS_PASSWORD_B64) return Buffer.from(WMS_PASSWORD_B64, "base64").toString("utf8");
  return WMS_PASSWORD_RAW;
}

function getUserIdFromJwt(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return "";
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return payload.userId || payload.user_id || payload.uid || payload.sub || payload.id || "";
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
            if (userId) cachedWmsUserId = userId;
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

    const exchangeUrl = new URL(`${YMS_BASE_URL}/auth/login-by-wms-token`);
    const postBody = JSON.stringify({ userId: cachedWmsUserId, wmsToken });
    const mod = exchangeUrl.protocol === "https:" ? https : http;
    console.log(`[YMS auth] exchange request: hasUserId=${Boolean(cachedWmsUserId)}, hasWmsToken=${Boolean(wmsToken)}, bodyLength=${postBody.length}`);
    const req = mod.request(exchangeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${wmsToken}`,
        "X-Tenant-ID": WMS_TENANT_ID,
        "X-Yard-ID": WMS_FACILITY_ID,
        "x-facility-id": WMS_FACILITY_ID,
        "Item-Time-Zone": "America/Los_Angeles",
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
        "Item-Time-Zone": "America/Los_Angeles",
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
        "Item-Time-Zone": "America/Los_Angeles",
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
    const loadIds = tripInfo.loadId ? [tripInfo.loadId] : (tripInfo.loadNo ? [tripInfo.loadNo] : []);

    const postBody = JSON.stringify({
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
        "Item-Time-Zone": "America/Los_Angeles",
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
      cachedTokenActive: Boolean(cachedWmsToken && Date.now() < cachedWmsTokenExpiry)
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
      if (tripInfo.loadId || tripInfo.customerId) {
        try {
          await attachTripInfo(ymsToken, etNumber, tripInfo);
          tripInfoAttached = true;
          console.log(`[YMS ET] Trip info attached to ${etNumber}`);
        } catch (err) {
          console.log(`[YMS ET] Trip info attach failed for ${etNumber}: ${err.message}`);
        }
      }

      sendJson(res, { etNumber, basicInfoAttached, tripInfoAttached });
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

  res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
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
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
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

function wmsLookup(rn, authHeader) {
  return new Promise((resolve) => {
    const lookupUrl = new URL(`${WMS_BASE_URL}/wms-bam/outbound/load/search-by-paging`);
    const postBody = JSON.stringify({ pageNo: 1, pageSize: 10, keyword: rn });
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
          const match = list[0];
          if (match && match.customerName) {
            console.log(`[WMS lookup] RN=${rn} -> customer="${match.customerName}" loadNo="${match.loadNo || ""}"`);
            resolve({
              customer: match.customerName,
              customerCode: match.customerCode || "",
              customerId: match.customerId || "",
              loadNo: match.loadNo || "",
              loadId: match.id || match.loadId || "",
              orderIds: match.orderIds || [],
              carrierName: match.carrierName || "",
              appointmentTime: match.appointmentTime || ""
            });
          } else {
            console.log(`[WMS lookup] RN=${rn} -> no match (${list.length} results)`);
            resolve({ customer: "" });
          }
        } catch (err) {
          console.log(`[WMS lookup] RN=${rn} -> parse error: ${err.message}`);
          resolve({ customer: "" });
        }
      });
    });
    req.on("error", (err) => {
      console.log(`[WMS lookup] RN=${rn} -> network error: ${err.message}`);
      resolve({ customer: "" });
    });
    req.on("timeout", () => {
      console.log(`[WMS lookup] RN=${rn} -> timeout`);
      req.destroy();
      resolve({ customer: "" });
    });
    req.write(postBody);
    req.end();
  });
}
