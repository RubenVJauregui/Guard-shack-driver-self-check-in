const dock98_97Customers = [
  "UNIS TRANSPORTATION",
  "ALL MARKET INC / VITA COCO",
  "SAFE CATCH",
  "GALANZ",
  "TCL",
  "SPLENDOR",
  "STRON",
  "KING COFFEE",
  "ZURU",
  "DELMAR"
];

const dock75_74Customers = [
  "NATUS",
  "STRON",
  "FED EX UPS"
];

const dock56_55Customers = [
  "SCHINDLER",
  "LIPPERT",
  "NIAGARA BOTTLING LLC-RESIN",
  "MAMMC"
];

const rnToCustomerMap = {
  "4700011468": { customer: "ALL MARKET INC / VITA COCO", type: "inbound", receiptId: "RN-6380", poNo: "4700011468", referenceNo: "0080804544" },
  "RN-6380": { customer: "ALL MARKET INC / VITA COCO", type: "inbound", receiptId: "RN-6380", poNo: "4700011468", referenceNo: "0080804544" },
  "0080804544": { customer: "ALL MARKET INC / VITA COCO", type: "inbound", receiptId: "RN-6380", poNo: "4700011468", referenceNo: "0080804544" }
};

const screenTitles = [
  "Driver Portal",
  "Driver Information",
  "Vehicle Information",
  "Choose Entry Task",
  "Verify Information",
  "Check in complete"
];

const form = document.querySelector("#checkinForm");
const screens = [...document.querySelectorAll(".screen")];
const dots = [...document.querySelectorAll(".progress-dot")];
const nextBtn = document.querySelector("#nextBtn");
const backBtn = document.querySelector("#backBtn");
const saveDraftBtn = document.querySelector("#saveDraftBtn");
const startOverBtn = document.querySelector("#startOverBtn");
const languageBtn = document.querySelector("#languageBtn");
const languageOptions = document.querySelector("#languageOptions");
const title = document.querySelector("#screenTitle");
const review = document.querySelector("#review");
const customerList = document.querySelector("#customerList");
const actionError = document.querySelector("#actionError");
const doorInstruction = document.querySelector("#doorInstruction");
const completionDetails = document.querySelector("#completionDetails");
const identityQr = document.querySelector("#identityQr");
const identityQrLink = document.querySelector("#identityQrLink");
const etNumberEl = document.querySelector("#etNumber");
const rnNumberEl = document.querySelector("#rnNumber");
let currentScreen = 0;

const allCustomers = [...new Set([...dock98_97Customers, ...dock75_74Customers, ...dock56_55Customers])].sort((a, b) => a.localeCompare(b));
if (customerList) {
  customerList.innerHTML = allCustomers.map((customer) => `<option value="${escapeHtml(customer)}"></option>`).join("");
}

restoreDraft();
bindPhotoPreview("driverPhoto", "driverPreview");
bindPhotoPreview("equipmentPhoto", "equipmentPreview");
bindPhotoPreview("loadPhoto", "loadPreview");
showScreen(0);

languageBtn.addEventListener("click", () => {
  const isOpen = !languageOptions.hidden;
  languageOptions.hidden = isOpen;
  languageBtn.setAttribute("aria-expanded", String(!isOpen));
});

languageOptions.addEventListener("click", (event) => {
  const option = event.target.closest("[data-language]");
  if (!option) return;
  languageBtn.textContent = option.dataset.language;
  languageOptions.hidden = true;
  languageBtn.setAttribute("aria-expanded", "false");
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".language-menu")) return;
  languageOptions.hidden = true;
  languageBtn.setAttribute("aria-expanded", "false");
});

document.querySelector("#loginMode").addEventListener("change", (event) => {
  const apptMode = event.target.value.includes("APPT");
  document.querySelector(".phone-row").style.display = apptMode ? "none" : "grid";
  document.querySelector(".login-alt").style.display = apptMode ? "grid" : "none";
});

function isDropOffEmpty() {
  const task = (form.elements.entryTask?.value || "").trim().toLowerCase();
  return task === "drop off empty";
}

document.querySelector("#entryTaskSelect").addEventListener("change", () => {
  const loadFields = document.querySelector("#loadFieldsRow");
  if (loadFields) {
    loadFields.style.display = isDropOffEmpty() ? "none" : "grid";
  }
});

// After 3 failed PO/RN/Load lookups, show this message (from Excel B1)
const FALLBACK_AFTER_MAX_ATTEMPTS = "Go to Dock 98";
let rnLookupAttempts = 0;
let lastValidatedRn = "";
let lastValidatedRnResult = null;

nextBtn.addEventListener("click", async () => {
  if (currentScreen === 4) {
    if (!validateScreen()) return;
    nextBtn.disabled = true;
    nextBtn.textContent = "Submitting...";
    clearActionError();
    let success = false;
    try {
      success = await completeCheckin();
    } catch {
      success = false;
    }
    nextBtn.disabled = false;
    if (success) {
      showScreen(5);
    } else {
      nextBtn.textContent = "Complete";
      showActionError("Go to Dock 98 and see the employee");
    }
    return;
  }

  // Step 3: validate PO/RN/Load # against WMS before proceeding
  if (currentScreen === 3) {
    if (!validateScreen()) return;

    // Drop Off Empty: skip PO/RN/Load validation entirely
    if (isDropOffEmpty()) {
      buildReview();
      showScreen(currentScreen + 1);
      return;
    }

    const data = getFormData();
    const identifiers = getLoadIdentifiers(data);

    if (!identifiers.length) {
      showActionError("Please enter a Reference / PO / RN / Load # before continuing.");
      return;
    }

    const validationKey = identifiers.join("|");
    if (validationKey === lastValidatedRn && lastValidatedRnResult && lastValidatedRnResult.customer) {
      buildReview();
      showScreen(currentScreen + 1);
      return;
    }

    nextBtn.disabled = true;
    nextBtn.textContent = "Verifying...";
    clearActionError();

    const wmsResult = await resolveCustomerFromIdentifiers(identifiers);

    nextBtn.disabled = false;
    nextBtn.textContent = "Continue";

    if (wmsResult.customer) {
      lastValidatedRn = validationKey;
      lastValidatedRnResult = wmsResult;
      rnLookupAttempts = 0;
      buildReview();
      showScreen(currentScreen + 1);
    } else {
      rnLookupAttempts++;
      const tried = identifiers.join(", ");
      if (rnLookupAttempts >= 3) {
        showActionError(`Reference / PO / RN / Load was not found after multiple attempts. ${FALLBACK_AFTER_MAX_ATTEMPTS}`);
      } else {
        showActionError(`Reference / PO / RN / Load "${tried}" was not found in the system. Please check the number and try again. (Attempt ${rnLookupAttempts}/3)`);
      }
    }
    return;
  }

  if (!validateScreen()) return;
  showScreen(currentScreen + 1);
});

backBtn.addEventListener("click", () => {
  if (currentScreen > 0 && currentScreen < 5) showScreen(currentScreen - 1);
});

saveDraftBtn.addEventListener("click", () => {
  localStorage.setItem("driverCheckinDraft", JSON.stringify(getFormData()));
  saveDraftBtn.textContent = "Saved";
  setTimeout(() => (saveDraftBtn.textContent = "Save Draft"), 1300);
});

startOverBtn.addEventListener("click", () => {
  localStorage.removeItem("driverCheckinDraft");
  form.reset();
  document.querySelectorAll(".preview-grid").forEach((grid) => (grid.innerHTML = ""));
  showScreen(0);
});

function showScreen(index) {
  clearActionError();
  currentScreen = index;
  screens.forEach((screen, screenIndex) => screen.classList.toggle("active", screenIndex === index));
  dots.forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex <= Math.min(index, 4)));
  title.textContent = screenTitles[index];
  backBtn.style.visibility = index > 0 && index < 5 ? "visible" : "hidden";
  document.querySelector(".actions").style.display = index === 5 ? "none" : "grid";
  nextBtn.textContent = index === 4 ? "Complete" : "Continue";
  nextBtn.disabled = false;
}

function validateScreen() {
  const active = screens[currentScreen];
  const requiredFields = [...active.querySelectorAll("[required]")];

  // Clear previous custom errors
  active.querySelectorAll(".field-error").forEach((el) => (el.hidden = true));
  clearActionError();

  for (const field of requiredFields) {
    if (field.type === "checkbox" && !field.checked) {
      const message = getRequiredFieldMessage(field);
      const errorEl = active.querySelector(`#${field.name}Error`);
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.hidden = false;
        errorEl.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        showActionError(message);
      }
      return false;
    }
    if (field.type === "file") {
      if (!field.files || field.files.length === 0) {
        const message = getRequiredFieldMessage(field);
        const errorEl = active.querySelector(`#${field.name}Error`);
        if (errorEl) {
          errorEl.textContent = message;
          errorEl.hidden = false;
          errorEl.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          showActionError(message);
        }
        return false;
      }
      continue;
    }
    if (!field.value.trim()) {
      showActionError(getRequiredFieldMessage(field));
      field.focus();
      return false;
    }
  }

  if (currentScreen === 1) {
    const driverPhotoInput = form.elements.driverPhoto;
    if (!driverPhotoInput.files || !driverPhotoInput.files.length) {
      const message = "Please upload a picture of your driver license before continuing.";
      showLicenseValidation("error", message);
      showActionError(message);
      return false;
    }
    if (driverPhotoValidating) {
      const message = "Still checking your driver license photo, please wait.";
      showLicenseValidation("info", message);
      showActionError(message);
      return false;
    }
  }

  return true;
}

function showActionError(message) {
  if (!actionError) return;
  actionError.textContent = message;
  actionError.hidden = false;
  actionError.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearActionError() {
  if (!actionError) return;
  actionError.textContent = "";
  actionError.hidden = true;
}

function getRequiredFieldMessage(field) {
  const messages = {
    phone: "Please enter your phone number before continuing.",
    firstName: "Please enter your first name before continuing.",
    lastName: "Please enter your last name before continuing.",
    license: "Please enter your driver license number before continuing.",
    driverPhoto: "Please upload a picture of your driver license before continuing.",
    carrierName: "Please enter the carrier name before continuing.",
    plate: "Please enter the license plate number before continuing.",
    equipmentNo: "Please enter the container or trailer number before continuing.",
    privacy: "Please check the acknowledgement box before completing check-in."
  };
  return messages[field.name] || "Please complete the required information before continuing.";
}

function getFormData() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.privacy = Boolean(form.elements.privacy.checked);
  return data;
}

function buildReview() {
  const data = getFormData();
  const rows = [
    ["Driver", `${data.firstName || ""} ${data.lastName || ""}`.trim()],
    ["Phone", data.driverPhone || data.phone || ""],
    ["License", data.license || ""],
    ["Carrier", data.carrierName || ""],
    ["Vehicle", `${data.vehicleType || ""} ${data.plate || ""}`.trim()],
    ["Equipment", `${data.equipmentType || ""} ${data.equipmentNo || ""}`.trim()],
    ["Entry Task", data.entryTask || ""],
    ["Reference", data.referenceNo || data.loadNo || ""]
  ];

  review.innerHTML = rows
    .map(([label, value]) => {
      return `<div class="review-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value || "Not entered")}</span></div>`;
    })
    .join("");
}

async function completeCheckin() {
  const data = getFormData();
  const rnValue = getLoadIdentifiers(data)[0] || "";

  // Check if ET was already created in this session (prevent duplicates)
  const existingEt = sessionStorage.getItem("lastCreatedET");
  const existingRn = sessionStorage.getItem("lastCreatedET_rn");
  let etNumber = "";
  let etStatus = {};
  if (existingEt && existingRn === rnValue) {
    etNumber = existingEt;
  }

  // Resolve customer from RN/load lookup (WMS primary, local fallback)
  const wmsResult = await resolveCustomerFromIdentifiers(getLoadIdentifiers(data));
  const resolvedCustomer = wmsResult.customer || data.customer || "";
  const assignment = getDoorAssignment(resolvedCustomer);

  // Create real YMS ET with driver data attached if not already created
  if (!etNumber) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const etRes = await fetch("/api/yms-entry-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverInfo: {
            driverPhone: data.driverPhone || data.phone || "",
            firstName: data.firstName || "",
            lastName: data.lastName || "",
            driverName: `${data.firstName || ""} ${data.lastName || ""}`.trim(),
            licenseNumber: data.license || ""
          },
          carrierInfo: {
            carrierName: data.carrierName || "",
            usdotNumber: data.usdot || ""
          },
          vehicleInfo: {
            licensePlate: data.plate || "",
            vehicleType: data.vehicleType || "Tractor"
          },
          equipmentInfo: {
            equipmentNo: data.equipmentNo || "",
            equipmentType: data.equipmentType || "Trailer",
            sealNumber: ""
          },
          tripInfo: {
            direction: wmsResult.type === "inbound" ? "inbound" : "outbound",
            customerId: wmsResult.customerId || "",
            loadId: wmsResult.loadId || "",
            loadNo: wmsResult.loadNo || "",
            receiptId: wmsResult.receiptId || "",
            poNo: wmsResult.poNo || "",
            referenceNo: wmsResult.referenceNo || data.referenceNo || "",
            customer: resolvedCustomer
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (etRes.ok) {
        const etData = await etRes.json();
        if (etData.etNumber) {
          etNumber = etData.etNumber;
          etStatus = etData;
          sessionStorage.setItem("lastCreatedET", etNumber);
          sessionStorage.setItem("lastCreatedET_rn", rnValue);
        }
      }
    } catch {
      // ET creation failed
    }
  }

  // Block completion if no confirmed ET
  if (!etNumber) {
    return false;
  }

  // Strip large photo from identity payload to prevent request hang/failure
  const photoThumb = thumbnailDataUrl(localStorage.getItem("driverLicensePhoto") || "", 300);

  const identityRecord = {
    firstName: data.firstName || "",
    lastName: data.lastName || "",
    license: data.license || "",
    customer: resolvedCustomer,
    assignment,
    rnNumber: rnValue,
    etNumber: etNumber,
    etStatus: etStatus,
    photo: photoThumb,
    savedAt: new Date().toISOString()
  };

  const identityUrl = await saveIdentityRecord(identityRecord);

  try {
    await fetch("/api/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        etNumber,
        driverFirstName: data.firstName || "",
        driverLastName: data.lastName || "",
        driverName: `${data.firstName || ""} ${data.lastName || ""}`.trim(),
        driverPhone: data.driverPhone || data.phone || "",
        driverLicense: data.license || "",
        driverEmail: data.email || "",
        carrierName: data.carrierName || "",
        usdot: data.usdot || "",
        vehicleType: data.vehicleType || "",
        licensePlate: data.plate || "",
        equipmentType: data.equipmentType || "",
        equipmentNo: data.equipmentNo || "",
        entryTask: data.entryTask || "",
        referenceNo: data.referenceNo || "",
        loadNo: data.loadNo || "",
        comments: data.comments || "",
        customer: resolvedCustomer,
        customerId: wmsResult.customerId || "",
        customerCode: wmsResult.customerCode || "",
        direction: wmsResult.type === "inbound" ? "inbound" : "outbound",
        receiptId: wmsResult.receiptId || "",
        poNo: wmsResult.poNo || "",
        loadId: wmsResult.loadId || "",
        wmsLoadNo: wmsResult.loadNo || "",
        doorAssignment: assignment,
        hasDriverPhoto: Boolean(form.elements.driverPhoto?.files?.length),
        hasEquipmentPhoto: Boolean(form.elements.equipmentPhoto?.files?.length),
        hasLoadPhoto: Boolean(form.elements.loadPhoto?.files?.length),
        photoCount: (form.elements.driverPhoto?.files?.length || 0) + (form.elements.equipmentPhoto?.files?.length || 0) + (form.elements.loadPhoto?.files?.length || 0),
        identityUrl,
        basicInfoAttached: Boolean(etStatus.basicInfoAttached),
        tripInfoAttached: Boolean(etStatus.tripInfoAttached),
        emailNotificationSent: Boolean(etStatus.emailNotificationSent),
        raw: { etStatus }
      })
    });
  } catch {
    // Dashboard storage should never block driver check-in.
  }

  // Drop Off Empty: show ET, drop-off message, hide QR
  if (isDropOffEmpty()) {
    doorInstruction.textContent = "Please drop off the container and see the employee for further instructions.";
    identityQr.style.display = "none";
    identityQrLink.style.display = "none";
    const qrHelp = document.querySelector(".qr-help");
    if (qrHelp) qrHelp.style.display = "none";
    etNumberEl.textContent = `ET# ${etNumber}`;
    rnNumberEl.textContent = "";
    completionDetails.textContent = `${data.firstName || "Driver"}, your drop-off has been recorded.`;
  } else {
    doorInstruction.textContent = assignment;
    identityQr.style.display = "";
    identityQrLink.style.display = "";
    const qrHelp = document.querySelector(".qr-help");
    if (qrHelp) qrHelp.style.display = "";
    identityQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=190x190&margin=8&data=${encodeURIComponent(identityUrl)}`;
    identityQrLink.href = identityUrl;
    etNumberEl.textContent = `ET# ${etNumber}`;
    rnNumberEl.textContent = rnValue ? `RN# ${rnValue}` : "RN# Not provided";
    completionDetails.textContent = `${data.firstName || "Driver"}, your ${data.entryTask || "check-in"} has been recorded.`;
  }

  localStorage.setItem("driverCheckinDraft", JSON.stringify(data));
  localStorage.setItem("driverIdentityData", JSON.stringify(identityRecord));
  return true;
}

function getLoadIdentifiers(data) {
  return [...new Set([data.loadNo, data.referenceNo].map((value) => (value || "").trim()).filter(Boolean))];
}

async function resolveCustomerFromIdentifiers(identifiers) {
  for (const identifier of identifiers) {
    const result = await resolveCustomerFromRn(identifier);
    if (result.customer) return { ...result, matchedIdentifier: identifier };
  }
  return { customer: "" };
}

async function resolveCustomerFromRn(rnValue) {
  if (!rnValue) return { customer: "" };
  const trimmed = rnValue.trim();
  const local = rnToCustomerMap[trimmed.toUpperCase()] || rnToCustomerMap[trimmed];
  if (local) return { ...local };

  // Try outbound first.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`/api/wms-lookup?rn=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data.customer) {
        return {
          type: data.type || "outbound",
          customer: data.customer || "",
          customerId: data.customerId || "",
          loadId: data.loadId || "",
          loadNo: data.loadNo || "",
          customerCode: data.customerCode || ""
        };
      }
    }
  } catch {}

  // Then try inbound receipt lookup by Receipt/RN, PO, BOL/reference, or container number.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`/api/wms-inbound-lookup?keyword=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { customer: "" };
    const data = await res.json();
    if (!data.customer) return { customer: "" };
    return {
      type: "inbound",
      customer: data.customer || "",
      customerId: data.customerId || "",
      customerCode: data.customerCode || "",
      receiptId: data.receiptId || "",
      poNo: data.poNo || "",
      referenceNo: data.referenceNo || data.bolNo || data.containerNo || ""
    };
  } catch {
    return { customer: "" };
  }
}

function thumbnailDataUrl(dataUrl, maxDim) {
  if (!dataUrl || !dataUrl.startsWith("data:image")) return dataUrl;
  try {
    const canvas = document.createElement("canvas");
    const img = new Image();
    img.src = dataUrl;
    if (!img.width || !img.height) return dataUrl;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return "";
  }
}

async function saveIdentityRecord(identityRecord) {
  const fallbackUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}identity.html`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch("/api/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(identityRecord),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error("Identity save failed");
    const saved = await response.json();
    return saved.url || `${fallbackUrl}?id=${encodeURIComponent(saved.id)}`;
  } catch {
    clearTimeout(timeout);
    return fallbackUrl;
  }
}

function getDoorAssignment(customerValue) {
  const normalized = normalize(customerValue);
  if (!normalized) return "Go to Dock 98";
  if (dock98_97Customers.some((customer) => normalize(customer) === normalized)) {
    return "Go to the door between docks 98 & 97";
  }
  if (dock75_74Customers.some((customer) => normalize(customer) === normalized)) {
    return "Go to the door between docks 75 & 74";
  }
  if (dock56_55Customers.some((customer) => normalize(customer) === normalized)) {
    return "Go to the door between docks 56 & 55";
  }
  return "Go to Dock 98";
}

function normalize(value = "") {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function bindPhotoPreview(fieldName, previewId) {
  const input = form.elements[fieldName];
  const preview = document.querySelector(`#${previewId}`);
  input.addEventListener("change", () => {
    preview.innerHTML = "";
    [...input.files].slice(0, 6).forEach((file) => {
      const img = document.createElement("img");
      img.alt = file.name;
      img.src = URL.createObjectURL(file);
      preview.appendChild(img);
    });

    // Clear error when file is selected
    const errorEl = document.querySelector(`#${fieldName}Error`);
    if (errorEl && input.files.length > 0) errorEl.hidden = true;

    if (fieldName === "driverPhoto" && input.files[0]) {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        localStorage.setItem("driverLicensePhoto", String(reader.result));
      });
      reader.readAsDataURL(input.files[0]);
      validateDriverLicenseImage(input.files[0]);
    }
  });
}

let driverPhotoValidated = false;
let driverPhotoValidating = false;
let driverPhotoValidationTimer = null;

function finishValidation(accepted, message) {
  driverPhotoValidating = false;
  driverPhotoValidated = accepted;
  nextBtn.disabled = false;
  if (driverPhotoValidationTimer) {
    clearTimeout(driverPhotoValidationTimer);
    driverPhotoValidationTimer = null;
  }
  if (accepted) {
    showLicenseValidation("success", message || "Driver license photo accepted.");
  } else {
    showLicenseValidation("error", message || "Please upload a clear picture of your driver license.");
  }
}

function validateDriverLicenseImage(file) {
  driverPhotoValidated = false;
  driverPhotoValidating = true;
  clearLicenseValidation();
  showLicenseValidation("info", "Checking driver license photo...");
  nextBtn.disabled = true;

  // Safety timeout: never leave button stuck longer than 4 seconds
  driverPhotoValidationTimer = setTimeout(() => {
    if (driverPhotoValidating) {
      finishValidation(true, "Driver license photo accepted.");
    }
  }, 4000);

  if (!file || !file.type.startsWith("image/")) {
    finishValidation(false, "Please upload an image file.");
    return;
  }

  // Extremely small files (< 5KB) are unlikely to be real photos
  if (file.size < 5000) {
    finishValidation(false, "Please upload a clear picture of your driver license.");
    return;
  }

  // If file is a normal camera image (> 30KB), accept it immediately
  // Real phone camera photos are typically 500KB-5MB
  if (file.size > 30000) {
    // Still verify it's a loadable image
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      if (img.width < 100 || img.height < 100) {
        finishValidation(false, "Please upload a clear picture of your driver license.");
      } else {
        finishValidation(true, "Driver license photo accepted.");
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      finishValidation(false, "Could not read image. Please try again with a different photo.");
    };
    img.src = URL.createObjectURL(file);
    return;
  }

  // Small-ish image (5-30KB): verify it loads and has reasonable dimensions
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(img.src);
    if (img.width < 100 || img.height < 100) {
      finishValidation(false, "Please upload a clear picture of your driver license.");
    } else {
      finishValidation(true, "Driver license photo accepted.");
    }
  };
  img.onerror = () => {
    URL.revokeObjectURL(img.src);
    finishValidation(false, "Could not read image. Please try again with a different photo.");
  };
  img.src = URL.createObjectURL(file);
}

function showLicenseValidation(type, message) {
  clearLicenseValidation();
  const el = document.createElement("p");
  el.className = "license-validation-msg";
  if (type === "error") {
    el.style.cssText = "color:#b91c1c;font-size:0.82rem;margin:0.4rem 0 0;padding:0.45rem 0.7rem;background:#fef2f2;border-radius:0.5rem;border:1px solid #fecaca;";
  } else if (type === "info") {
    el.style.cssText = "color:#1d4ed8;font-size:0.82rem;margin:0.4rem 0 0;padding:0.45rem 0.7rem;background:#eff6ff;border-radius:0.5rem;border:1px solid #bfdbfe;";
  } else {
    el.style.cssText = "color:#15803d;font-size:0.82rem;margin:0.4rem 0 0;padding:0.45rem 0.7rem;background:#f0fdf4;border-radius:0.5rem;border:1px solid #bbf7d0;";
  }
  el.textContent = message;
  const preview = document.querySelector("#driverPreview");
  preview.parentElement.insertBefore(el, preview.nextSibling);
}

function clearLicenseValidation() {
  document.querySelectorAll(".license-validation-msg").forEach((el) => el.remove());
}

function restoreDraft() {
  const saved = localStorage.getItem("driverCheckinDraft");
  if (!saved) return;
  const data = JSON.parse(saved);
  Object.entries(data).forEach(([name, value]) => {
    const field = form.elements[name];
    if (!field || field.type === "file") return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value;
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}
