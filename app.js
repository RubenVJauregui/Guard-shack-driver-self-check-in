// Door assignment rules from latest "Door asignment.xlsx" only
// Column B: "Go to the door between docks 165 & 166"
const doorBetween165_166Customers = [
  "RST",
  "KING'S HAWAIIAN",
  "MAMMA CHIA",
  "MELOGRANO DRINKS LLC",
  "MUSE ORGANIC LLC",
  "NATURAL DECADENCE LLC",
  "ORGAIN, LLC",
  "OVERSEAS FOOD TRADING",
  "POMPEIAN INC",
  "PREFERRED BRANDS",
  "RECOVERY SPORTS LLC",
  "RISE BEVERAGES LLC DBA",
  "SANS WINE & SPIRITS",
  "UPTIME ENERGY INC",
  "WATER PLUS LLC",
  "ZEN BEVERAGE LLC",
  "TCL - Solar Cell"
];

// Column D: "Go to the door at dock 144"
const door144Customers = [
  "ALL MARKET INC / VITA COCO",
  "COME READY FOODS",
  "HINT INC",
  "SOURCE86",
  "KACE TEA LLC",
  "PLEASS GLOBAL LIMITED",
  "PREFERRED BRANDS",
  "RITUAL BEVERAGE COMPANY",
  "ROAR BEVERAGES INC",
  "SOUTHERN GLAZER'S WINE AND SPIRITS, LLC",
  "SPLENDOR WATER LLC",
  "WISMETTAC ASIAN FOODS"
];

// Column F: "Go to the door at Dock 40"
const door45Customers = [
  "TCL NORTH AMERICA",
  "LENNOX INDUSTRIES INC.",
  "AMIEE LYNN, LNC.",
  "KARAKA, LLC",
  "NZXT",
  "CMPC USA (Cut Paper and Rolls)",
  "WOODY FLAW CREST INC",
  "North Star",
  "CMPC USA",
  "La Jolla",
  "ESI",
  "TPV USA",
  "Gurunanda",
  "the only bean"
];

// Column H: "Go to Dock 94"
const door70Customers = [
  "Euromarket / Crate & Barrel"
];

// LOCKED DRIVER-FACING INSTRUCTIONS — do not source these messages from WMS/YMS responses.
const DRIVER_INSTRUCTIONS = Object.freeze({
  DEFAULT_165_166: "Go to the door between docks 165 & 166.",
  FALLBACK_DETAIL_165_166: "Go to the door between docks 165 & 166.",
  DOCK_144: "Go to the door at dock 144",
  DOCK_45: "Go to the door at Dock 40",
  DOCK_94: "Go to Dock 94",
  DROP_EMPTY: "Drop off container / trailer at any open spot in the yard",
  PICKUP_EMPTY: "Please proceed to pick up your empty",
  UNIS_DRIVER_DOCK_93: "Please proceed to dock 93"
});

const APP_BUILD_VERSION = "strictet55";
const CHECKIN_VALIDATION_STEPS = Object.freeze([
  { key: "etCreated", label: { es: "ET creado", en: "ET created" } },
  { key: "dnLinked", label: { es: "DN vinculado", en: "DN linked" } },
  { key: "loadLinked", label: { es: "LOAD vinculado", en: "LOAD linked" } },
  { key: "validDock", label: { es: "Dock válido", en: "Valid dock" } },
  { key: "loadTaskCreated", label: { es: "Load Task creado", en: "Load Task created" } },
  { key: "windowCheckinCompleted", label: { es: "Window Check-In terminado", en: "Window Check-In completed" } },
  { key: "qrCreated", label: { es: "QR creado", en: "QR created" } },
  { key: "wiseSynced", label: { es: "WISE sincronizado", en: "WISE synced" } }
]);
const EXCEL_DEFAULT_DOOR = DRIVER_INSTRUCTIONS.DEFAULT_165_166;
const ASSISTANCE_DOOR_INSTRUCTION = DRIVER_INSTRUCTIONS.FALLBACK_DETAIL_165_166;

const rnToCustomerMap = {};

const screenTitles = [
  "Driver Portal",
  "Driver Information",
  "Vehicle Information",
  "Choose Entry Task",
  "Load Details",
  "Verify Information",
  "Check in complete"
];

const form = document.querySelector("#checkinForm");
const screens = [...document.querySelectorAll(".screen")];
const completeScreen = document.querySelector(".complete-screen");
const completeEyebrow = completeScreen?.querySelector(".eyebrow");
const completeHeading = completeScreen?.querySelector("h2");
const completeSuccessMark = completeScreen?.querySelector(".success-mark");
const dots = [...document.querySelectorAll(".progress-dot")];
const nextBtn = document.querySelector("#nextBtn");
const backBtn = document.querySelector("#backBtn");
const saveDraftBtn = document.querySelector("#saveDraftBtn");
const startOverBtn = document.querySelector("#startOverBtn");
const refreshPortalBtn = document.querySelector("#refreshPortalBtn");
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
const validationPanel = document.querySelector("#validationPanel");
const validationSummary = document.querySelector("#validationSummary");
const validationChecklist = document.querySelector("#validationChecklist");
let currentScreen = 0;
let portalRefreshInProgress = false;

function forceRefreshPortal() {
  if (portalRefreshInProgress) return;
  portalRefreshInProgress = true;
  if (refreshPortalBtn) {
    refreshPortalBtn.disabled = true;
    refreshPortalBtn.textContent = "Refreshing...";
  }
  const refreshUrl = new URL(window.location.href);
  refreshUrl.searchParams.set("refresh", `${APP_BUILD_VERSION}-${Date.now()}`);
  window.location.replace(refreshUrl.toString());
}

window.addEventListener("keydown", (event) => {
  const isPortalRefresh = event.ctrlKey
    && event.shiftKey
    && !event.altKey
    && !event.metaKey
    && String(event.key || "").toLowerCase() === "s";
  if (!isPortalRefresh) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat) return;
  forceRefreshPortal();
}, true);

refreshPortalBtn?.addEventListener("click", forceRefreshPortal);

const allCustomers = [...new Set([...doorBetween165_166Customers, ...door144Customers, ...door45Customers, ...door70Customers])].sort((a, b) => a.localeCompare(b));
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

function updateLoginModeRequirements() {
  const loginMode = document.querySelector("#loginMode");
  const apptMode = loginMode && loginMode.value.includes("APPT");
  const phoneRow = document.querySelector(".phone-row");
  const loginAlt = document.querySelector(".login-alt");
  const phoneInput = form.elements.phone;
  const appointmentInput = form.elements.appointment;
  const passcodeInput = form.elements.passcode;

  if (phoneRow) phoneRow.style.display = apptMode ? "none" : "grid";
  if (loginAlt) loginAlt.style.display = apptMode ? "grid" : "none";

  if (phoneInput) phoneInput.required = !apptMode;
  if (appointmentInput) appointmentInput.required = Boolean(apptMode);
  if (passcodeInput) passcodeInput.required = Boolean(apptMode);
}

document.querySelector("#loginMode").addEventListener("change", updateLoginModeRequirements);
updateLoginModeRequirements();
function validateLoginScreen() {
  updateLoginModeRequirements();
  const loginMode = document.querySelector("#loginMode");
  const apptMode = loginMode && loginMode.value.includes("APPT");
  const phoneInput = form.elements.phone;
  const appointmentInput = form.elements.appointment;
  const passcodeInput = form.elements.passcode;

  if (apptMode) {
    if (!String(appointmentInput?.value || "").trim()) {
      showActionError("Please enter your appointment number before continuing.");
      appointmentInput?.focus();
      return false;
    }
    if (!String(passcodeInput?.value || "").trim()) {
      showActionError("Please enter your passcode before continuing.");
      passcodeInput?.focus();
      return false;
    }
    return true;
  }

  if (!String(phoneInput?.value || "").trim()) {
    showActionError("Please enter your phone number before continuing.");
    phoneInput?.focus();
    return false;
  }
  return true;
}


function isDropOffEmpty() {
  const task = (form.elements.entryTask?.value || "").trim().toLowerCase();
  return task === "drop off empty";
}

function isDropOffFull() {
  const task = (form.elements.entryTask?.value || "").trim().toLowerCase();
  return task === "drop off full";
}

function isPickupEmpty() {
  const task = (form.elements.entryTask?.value || "").trim().toLowerCase();
  return task === "pickup empty";
}

function isImmediateInstructionTask() {
  // Drop Off Full must collect RN/load details and create an ET before showing the final message.
  return isDropOffEmpty() || isPickupEmpty();
}

function getImmediateTaskInstruction() {
  if (isPickupEmpty()) return DRIVER_INSTRUCTIONS.PICKUP_EMPTY;
  return DRIVER_INSTRUCTIONS.DROP_EMPTY;
}

// If the load, RN, DN, PO, or pickup number is not found in WISE, show this locked message.
const WISE_NOT_FOUND_INSTRUCTION = DRIVER_INSTRUCTIONS.DEFAULT_165_166;
const FALLBACK_AFTER_MAX_ATTEMPTS = WISE_NOT_FOUND_INSTRUCTION;
let rnLookupAttempts = 0;
let lastValidatedRn = "";
let lastValidatedRnResult = null;

nextBtn.addEventListener("click", async () => {
  try {
  if (currentScreen === 0) {
    if (!validateLoginScreen()) return;
    showScreen(1);
    return;
  }

  if (currentScreen === 5) {
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
      showScreen(6);
    } else {
      nextBtn.textContent = "Complete";
      showLargeInstructionScreen(FALLBACK_AFTER_MAX_ATTEMPTS, DRIVER_INSTRUCTIONS.FALLBACK_DETAIL_165_166);
    }
    return;
  }

  // Step 3: only choose the entry task. Immediate yard tasks show their hardcoded message next.
  if (currentScreen === 3) {
    if (!validateScreen()) return;
    if (isImmediateInstructionTask()) {
      showImmediateTaskInstructionScreen(getImmediateTaskInstruction());
      return;
    }
    showScreen(4);
    return;
  }

  // Step 4: for all other tasks, collect and validate PO/RN/Load details against WMS.
  if (currentScreen === 4) {
    if (!validateScreen()) return;

    const data = getFormData();
    const identifiers = getLoadIdentifiers(data);

    if (!identifiers.length) {
      showActionError("Please enter a PO / RN / Load # / DN before continuing.");
      return;
    }

    const validationKey = identifiers.join("|");
    if (validationKey === lastValidatedRn && lastValidatedRnResult && lastValidatedRnResult.customer) {
      buildReview();
      showScreen(5);
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
      showScreen(5);
    } else {
      rnLookupAttempts++;
      showLargeInstructionScreen(WISE_NOT_FOUND_INSTRUCTION, DRIVER_INSTRUCTIONS.FALLBACK_DETAIL_165_166);
    }
    return;
  }

  if (!validateScreen()) return;
  showScreen(currentScreen + 1);
  } catch (err) {
    console.error("Continue failed", err);
    nextBtn.disabled = false;
    nextBtn.textContent = currentScreen === 5 ? "Complete" : "Continue";
    showActionError("Please complete the required fields above, then press Continue again.");
  }
});

backBtn.addEventListener("click", () => {
  if (currentScreen > 0 && currentScreen < 6) showScreen(currentScreen - 1);
});

saveDraftBtn.addEventListener("click", () => {
  localStorage.setItem("driverCheckinDraft", JSON.stringify(getFormData()));
  saveDraftBtn.textContent = "Saved";
  setTimeout(() => (saveDraftBtn.textContent = "Save Draft"), 1300);
});

startOverBtn.addEventListener("click", () => {
  localStorage.removeItem("driverCheckinDraft");
  resetCheckinValidation();
  form.reset();
  document.querySelectorAll(".preview-grid").forEach((grid) => (grid.innerHTML = ""));
  showScreen(0);
});


const unisDriversBtn = document.querySelector("#unisDriversBtn");
if (unisDriversBtn) {
  unisDriversBtn.addEventListener("click", () => {
    showImmediateTaskInstructionScreen(DRIVER_INSTRUCTIONS.UNIS_DRIVER_DOCK_93);
  });
}

// --- Already Pre-Checked In flow ---
const preCheckedInBtn = document.querySelector("#preCheckedInBtn");
const preCheckinLookup = document.querySelector("#preCheckinLookup");
const preCheckinTicket = document.querySelector("#preCheckinTicket");
const preCheckinSearchBtn = document.querySelector("#preCheckinSearchBtn");
const preCheckinError = document.querySelector("#preCheckinError");

if (preCheckedInBtn) {
  preCheckedInBtn.addEventListener("click", () => {
    preCheckinLookup.hidden = !preCheckinLookup.hidden;
    if (!preCheckinLookup.hidden) preCheckinTicket.focus();
  });
}

if (preCheckinSearchBtn) {
  preCheckinSearchBtn.addEventListener("click", async () => {
    const ticket = (preCheckinTicket.value || "").trim();
    preCheckinError.hidden = true;

    if (!ticket) {
      preCheckinError.textContent = "Please enter your ticket number.";
      preCheckinError.hidden = false;
      return;
    }

    preCheckinSearchBtn.disabled = true;
    preCheckinSearchBtn.textContent = "Looking up...";

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`/api/ticket-lookup?ticket=${encodeURIComponent(ticket)}`, {
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) throw new Error("Lookup failed");
      const data = await res.json();

      if (data.found && data.customer) {
        resetCheckinValidation();
        setYardInstructionMode(false);
        const doorResult = await getDoorAssignmentWithStaging(data.loadId || "", data.customer);
        doorInstruction.textContent = doorResult.assignment;
        etNumberEl.textContent = `ET# ${data.etNumber || ticket}`;
        rnNumberEl.textContent = data.loadNo ? `RN# ${data.loadNo}` : "RN# Not provided";
        identityQr.style.display = "none";
        identityQrLink.style.display = "none";
        const qrHelp = document.querySelector(".qr-help");
        if (qrHelp) qrHelp.style.display = "none";
        completionDetails.textContent = "Pre-checked in ticket found. Please proceed to your assigned door.";
        showScreen(6);
      } else {
        preCheckinError.textContent = data.error || "Ticket not found. Please check the number and try again.";
        preCheckinError.hidden = false;
      }
    } catch {
      preCheckinError.textContent = "Could not look up the ticket. Please try again.";
      preCheckinError.hidden = false;
    } finally {
      preCheckinSearchBtn.disabled = false;
      preCheckinSearchBtn.textContent = "Look Up Ticket";
    }
  });
}

function setYardInstructionMode(enabled) {
  if (!completeScreen) return;
  completeScreen.classList.toggle("yard-instruction-mode", Boolean(enabled));
}

function setCompleteHeader(mode = "complete") {
  if (mode === "instruction") {
    if (completeEyebrow) completeEyebrow.textContent = "Proceed to Door";
    if (completeHeading) completeHeading.textContent = DRIVER_INSTRUCTIONS.FALLBACK_DETAIL_165_166;
    if (completeSuccessMark) completeSuccessMark.textContent = "✓";
  } else {
    if (completeEyebrow) completeEyebrow.textContent = "Complete Check-in";
    if (completeHeading) completeHeading.textContent = "Check in complete";
    if (completeSuccessMark) completeSuccessMark.textContent = "✓";
  }
}

function showImmediateTaskInstructionScreen(message) {
  resetCheckinValidation();
  setYardInstructionMode(true);
  doorInstruction.textContent = message;
  identityQr.style.display = "none";
  identityQrLink.style.display = "none";
  const qrHelp = document.querySelector(".qr-help");
  if (qrHelp) qrHelp.style.display = "none";
  etNumberEl.textContent = "";
  rnNumberEl.textContent = "";
  completionDetails.textContent = "";
  showScreen(6);
  setCompleteHeader("complete");
}

function showLargeInstructionScreen(message, details = DRIVER_INSTRUCTIONS.FALLBACK_DETAIL_165_166) {
  resetCheckinValidation();
  setYardInstructionMode(true);
  doorInstruction.textContent = message;
  identityQr.style.display = "none";
  identityQrLink.style.display = "none";
  const qrHelp = document.querySelector(".qr-help");
  if (qrHelp) qrHelp.style.display = "none";
  etNumberEl.textContent = "";
  rnNumberEl.textContent = "";
  completionDetails.textContent = details;
  showScreen(6);
  setCompleteHeader("instruction");
}

function showScreen(index) {
  clearActionError();
  if (index !== 6) setYardInstructionMode(false);
  if (index === 6 && validationPanel?.hidden !== false) setCompleteHeader("complete");
  currentScreen = index;
  screens.forEach((screen, screenIndex) => screen.classList.toggle("active", screenIndex === index));
  dots.forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex <= Math.min(index, 4)));
  title.textContent = screenTitles[index];
  backBtn.style.visibility = index > 0 && index < 6 ? "visible" : "hidden";
  document.querySelector(".actions").style.display = index === 6 ? "none" : "grid";
  nextBtn.textContent = index === 5 ? "Complete" : "Continue";
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
    if (!String(field.value || "").trim()) {
      const message = getRequiredFieldMessage(field);
      const errorEl = active.querySelector(`#${field.name}Error`);
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.hidden = false;
        errorEl.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        showActionError(message);
      }
      field.focus();
      return false;
    }
  }

  if (currentScreen === 1) {
    const driverPhotoInput = form.elements.driverPhoto;
    if (!driverPhotoInput.files || !driverPhotoInput.files.length) {
      const message = "Please upload a picture before continuing.";
      const errorEl = active.querySelector("#driverPhotoError");
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.hidden = false;
        errorEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      showLicenseValidation("error", message);
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
    driverPhoto: "Please upload a picture before continuing.",
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
    ["Reference #", data.referenceNo || ""],
    ["PO / RN / Load / DN", data.loadNo || ""]
  ];

  review.innerHTML = rows
    .map(([label, value]) => {
      return `<div class="review-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value || "Not entered")}</span></div>`;
    })
    .join("");
}


async function completeCheckin() {
  resetCheckinValidation();
  const data = getFormData();
  const identifiers = getLoadIdentifiers(data);
  const rnValue = identifiers[0] || "";
  const duplicateEtSignature = getDuplicateEtSignature(data);

  // Check if ET was already created in this session (prevent duplicates)
  const existingEt = sessionStorage.getItem("lastCreatedET");
  const existingSignature = sessionStorage.getItem("lastCreatedET_signature");
  let etNumber = "";
  let etStatus = {};
  if (existingEt && existingSignature === duplicateEtSignature) {
    etNumber = existingEt;
  }

  // Resolve customer from RN/load lookup (WMS primary, local fallback)
  const wmsResult = await resolveCustomerFromIdentifiers(identifiers);
  const resolvedCustomer = wmsResult.customer || data.customer || "";
  const orderIds = [...new Set([
    ...(Array.isArray(wmsResult.orderIds) ? wmsResult.orderIds : []),
    wmsResult.orderId
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  const orderId = orderIds[0] || "";

  // Create and confirm the YMS ET before computing or showing any door/dock assignment.
  if (!etNumber) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const etRes = await fetch("/api/yms-entry-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: duplicateEtSignature,
          entryTask: data.entryTask || "",
          entryTaskTag: data.entryTask || "",
          orderId,
          orderIds,
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
            entryTask: data.entryTask || "",
            entryTaskTag: data.entryTask || "",
            direction: wmsResult.type === "inbound" ? "inbound" : "outbound",
            customerId: wmsResult.customerId || "",
            orderId,
            orderIds,
            loadId: wmsResult.loadId || "",
            loadNo: wmsResult.loadNo || "",
            dockId: wmsResult.dockId || "",
            dockName: wmsResult.dockName || "",
            receiptId: wmsResult.receiptId || "",
            poNo: wmsResult.poNo || "",
            referenceNo: wmsResult.referenceNo || data.referenceNo || "",
            customer: resolvedCustomer
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      const etData = await etRes.json().catch(() => ({}));
      if (etRes.ok && etData.ok === true && etData.etNumber) {
        etNumber = etData.etNumber;
        etStatus = etData;
        sessionStorage.setItem("lastCreatedET", etNumber);
        sessionStorage.setItem("lastCreatedET_signature", duplicateEtSignature);
      }
    } catch {
      // ET creation failed or timed out. Do not advance without a confirmed ET number.
    }
  }

  // Exact idempotency signature is required to reuse an ET.

  // Block completion if no confirmed ET. No final screen or door/dock assignment may show without this.
  if (!etNumber) {
    return false;
  }

  const doorResult = await getDoorAssignmentWithStaging(wmsResult.loadId || "", resolvedCustomer);
  const assignment = doorResult.assignment;

  // Strip large photo from identity payload to prevent request hang/failure
  const photoThumb = await thumbnailDataUrl(localStorage.getItem("driverLicensePhoto") || "", 300);

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

  const identityResult = await saveIdentityRecord(identityRecord);
  const identityUrl = identityResult.url;

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
        doorSource: doorResult.source || "",
        stagedLocation: doorResult.stagedLocation || "",
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

  let qrRendered = false;

  // Drop Off Empty: show ET, drop-off message, hide QR
  if (isDropOffEmpty()) {
    setYardInstructionMode(true);
    doorInstruction.textContent = DRIVER_INSTRUCTIONS.DROP_EMPTY;
    identityQr.style.display = "none";
    identityQrLink.style.display = "none";
    const qrHelp = document.querySelector(".qr-help");
    if (qrHelp) qrHelp.style.display = "none";
    etNumberEl.textContent = `ET# ${etNumber}`;
    rnNumberEl.textContent = "";
    completionDetails.textContent = `${data.firstName || "Driver"}, your drop-off has been recorded.`;
  } else if (isDropOffFull()) {
    setYardInstructionMode(true);
    doorInstruction.textContent = DRIVER_INSTRUCTIONS.DROP_EMPTY;
    identityQr.style.display = "";
    identityQrLink.style.display = "";
    const qrHelp = document.querySelector(".qr-help");
    if (qrHelp) qrHelp.style.display = "";
    qrRendered = setIdentityQr(identityUrl);
    etNumberEl.textContent = `ET# ${etNumber}`;
    rnNumberEl.textContent = rnValue ? `RN# ${rnValue}` : "RN# Not provided";
    completionDetails.textContent = `${data.firstName || "Driver"}, your drop-off has been recorded.`;
  } else if (isPickupEmpty()) {
    setYardInstructionMode(true);
    doorInstruction.textContent = DRIVER_INSTRUCTIONS.PICKUP_EMPTY;
    identityQr.style.display = "";
    identityQrLink.style.display = "";
    const qrHelp = document.querySelector(".qr-help");
    if (qrHelp) qrHelp.style.display = "";
    qrRendered = setIdentityQr(identityUrl);
    etNumberEl.textContent = `ET# ${etNumber}`;
    rnNumberEl.textContent = rnValue ? `RN# ${rnValue}` : "RN# Not provided";
    completionDetails.textContent = `${data.firstName || "Driver"}, your pickup has been recorded.`;
  } else {
    setYardInstructionMode(false);
    doorInstruction.textContent = assignment;
    identityQr.style.display = "";
    identityQrLink.style.display = "";
    const qrHelp = document.querySelector(".qr-help");
    if (qrHelp) qrHelp.style.display = "";
    qrRendered = setIdentityQr(identityUrl);
    etNumberEl.textContent = `ET# ${etNumber}`;
    rnNumberEl.textContent = rnValue ? `RN# ${rnValue}` : "RN# Not provided";
    completionDetails.textContent = `${data.firstName || "Driver"}, your ${data.entryTask || "check-in"} has been recorded.`;
  }

  // Attempt YMS window check-in completion if WMS loadId exists
  let windowCheckinResult = null;
  if (wmsResult.loadId && etNumber && !isDropOffEmpty() && !isPickupEmpty()) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const wcRes = await fetch("/api/yms-window-checkin-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          etNumber,
          orderId,
          orderIds,
          loadId: wmsResult.loadId || "",
          loadNo: wmsResult.loadNo || "",
          customerId: wmsResult.customerId || "",
          direction: wmsResult.type === "inbound" ? "inbound" : "outbound",
          receiptId: wmsResult.receiptId || "",
          poNo: wmsResult.poNo || "",
          referenceNo: wmsResult.referenceNo || data.referenceNo || "",
          dockId: etStatus.assignedDockId || wmsResult.dockId || doorResult.stagedLocation || "",
          loadTaskId: etStatus.loadTaskId || "",
          assigneeUserId: "",
          assigneeUserName: "",
          driverInfo: {
            driverPhone: data.driverPhone || data.phone || "",
            firstName: data.firstName || "",
            lastName: data.lastName || "",
            driverName: `${data.firstName || ""} ${data.lastName || ""}`.trim(),
            licenseNumber: data.license || ""
          },
          carrierInfo: { carrierName: data.carrierName || "", usdotNumber: data.usdot || "" },
          vehicleInfo: { licensePlate: data.plate || "", vehicleType: data.vehicleType || "Tractor" },
          equipmentInfo: { equipmentNo: data.equipmentNo || "", equipmentType: data.equipmentType || "Trailer" }
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      windowCheckinResult = await wcRes.json().catch(() => null);
    } catch {
      // Window completion is best-effort; do not block driver.
    }
  }

  const qrCreated = Boolean(identityResult.saved && identityUrl && qrRendered);
  const validation = mergeCheckinValidation(etStatus.validation, windowCheckinResult?.validation, {
    qrCreated,
    identityUrl
  });
  renderCheckinValidation(validation);

  localStorage.setItem("driverCheckinDraft", JSON.stringify(data));
  localStorage.setItem("driverIdentityData", JSON.stringify(identityRecord));
  return true;
}

function getLoadIdentifiers(data) {
  return [...new Set([data.referenceNo, data.loadNo].map((value) => (value || "").trim()).filter(Boolean))];
}

function getDuplicateEtSignature(data) {
  return [
    data.referenceNo || "",
    data.loadNo || "",
    data.driverPhone || data.phone || "",
    data.license || "",
    data.equipmentNo || "",
    data.plate || "",
    data.entryTask || ""
  ].map((value) => String(value).trim().toUpperCase()).join("|");
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
          customerCode: data.customerCode || "",
          orderId: data.orderId || "",
          orderIds: Array.isArray(data.orderIds) ? data.orderIds : []
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

async function thumbnailDataUrl(dataUrl, maxDim) {
  if (!dataUrl || !dataUrl.startsWith("data:image")) return dataUrl;
  try {
    const img = await loadImageElement(dataUrl);
    if (!img.width || !img.height) return "";
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return "";
  }
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function setIdentityQr(identityUrl) {
  if (!identityQr || !identityQrLink || !identityUrl) return false;
  const safeUrl = identityUrl;
  identityQr.src = `/api/qr?data=${encodeURIComponent(safeUrl)}&v=${encodeURIComponent(APP_BUILD_VERSION)}`;
  identityQrLink.href = safeUrl;
  identityQr.alt = "Driver identity QR code";
  return Boolean(identityQr.src && identityQrLink.href);
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
    return {
      url: saved.url || `${fallbackUrl}?id=${encodeURIComponent(saved.id)}`,
      saved: saved.saved === true
    };
  } catch {
    clearTimeout(timeout);
    return { url: fallbackUrl, saved: false };
  }
}

function resetCheckinValidation() {
  if (validationPanel) validationPanel.hidden = true;
  if (validationSummary) validationSummary.textContent = "";
  if (validationChecklist) validationChecklist.innerHTML = "";
  completeScreen?.classList.remove("validation-incomplete");
  validationPanel?.classList.remove("validation-panel--success", "validation-panel--warning", "validation-panel--danger");
}

function mergeCheckinValidation(...sources) {
  const qrResult = sources.pop() || {};
  const stepMap = new Map(CHECKIN_VALIDATION_STEPS.map((definition) => [definition.key, {
    ...definition,
    passed: false,
    details: `Pendiente: ${definition.label.es}.`,
    evidence: {}
  }]));

  for (const validation of sources) {
    if (!validation || !Array.isArray(validation.steps)) continue;
    validation.steps.forEach((step) => {
      if (!stepMap.has(step.key)) return;
      const current = stepMap.get(step.key);
      stepMap.set(step.key, {
        ...current,
        ...step,
        label: { ...current.label, ...(step.label || {}) },
        evidence: { ...(current.evidence || {}), ...(step.evidence || {}) }
      });
    });
  }

  const qrStep = stepMap.get("qrCreated");
  stepMap.set("qrCreated", {
    ...qrStep,
    passed: qrResult.qrCreated === true,
    details: qrResult.qrCreated
      ? "Identidad guardada y QR preparado."
      : "No se pudo confirmar el guardado de identidad y la creación del QR.",
    evidence: { ...(qrStep.evidence || {}), identityUrl: qrResult.qrCreated ? qrResult.identityUrl || "" : "" }
  });

  const steps = CHECKIN_VALIDATION_STEPS.map(({ key }) => stepMap.get(key));
  return {
    passed: steps.every((step) => step.passed === true),
    steps,
    evidence: Object.assign({}, ...sources.map((validation) => validation?.evidence || {}), {
      identityUrl: qrResult.qrCreated ? qrResult.identityUrl || "" : ""
    })
  };
}

function renderCheckinValidation(validation) {
  if (!validationPanel || !validationSummary || !validationChecklist) return;
  const steps = Array.isArray(validation?.steps) ? validation.steps : [];
  const failedSteps = steps.filter((step) => step.passed !== true);
  const etCreated = steps.find((step) => step.key === "etCreated")?.passed === true;
  const qrCreated = steps.find((step) => step.key === "qrCreated")?.passed === true;
  const passed = validation?.passed === true && failedSteps.length === 0;

  validationPanel.hidden = false;
  validationPanel.classList.toggle("validation-panel--success", passed);
  validationPanel.classList.toggle("validation-panel--warning", !passed && etCreated && qrCreated);
  validationPanel.classList.toggle("validation-panel--danger", !passed && (!etCreated || !qrCreated));
  validationChecklist.innerHTML = steps.map((step) => {
    const label = step.label?.es || step.label?.en || step.key;
    const status = step.passed === true ? "✅" : "❌";
    return `<li class="${step.passed === true ? "passed" : "failed"}" title="${escapeHtml(step.details || "")}"><span aria-hidden="true">${status}</span><span>${escapeHtml(label)}</span></li>`;
  }).join("");

  if (passed) {
    validationSummary.textContent = "Check-in completado y validado: ET, DN, LOAD, Dock, Load Task, Window Check-In, QR y WISE sincronizados.";
    if (completeEyebrow) completeEyebrow.textContent = "Check-in validado";
    if (completeHeading) completeHeading.textContent = "Check in complete";
    if (completeSuccessMark) completeSuccessMark.textContent = "✓";
    completeScreen?.classList.remove("validation-incomplete");
    return;
  }

  validationSummary.textContent = `Check-in pendiente de validación: ${failedSteps.length} paso${failedSteps.length === 1 ? "" : "s"} requiere${failedSteps.length === 1 ? "" : "n"} atención. Muestre esta pantalla al personal del almacén.`;
  if (completeEyebrow) completeEyebrow.textContent = "Validación pendiente";
  if (completeHeading) completeHeading.textContent = "Check-in requires review";
  if (completeSuccessMark) completeSuccessMark.textContent = "!";
  completeScreen?.classList.add("validation-incomplete");
}


async function getDoorAssignmentWithStaging(loadId, customerValue) {
  return { assignment: getDoorAssignment(customerValue), source: "excel", stagedLocation: "" };
}

function isRealDoorAssignment(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/see the employee/i.test(text)) return false;
  return /door|dock/i.test(text);
}

function getDoorAssignment(customerValue) {
  const normalized = normalizeForDoorMatch(customerValue);
  if (!normalized) return EXCEL_DEFAULT_DOOR;

  if (doorBetween165_166Customers.some((customer) => isDoorCustomerMatch(normalized, customer))) {
    return DRIVER_INSTRUCTIONS.DEFAULT_165_166;
  }
  if (door144Customers.some((customer) => isDoorCustomerMatch(normalized, customer))) {
    return DRIVER_INSTRUCTIONS.DOCK_144;
  }
  if (door45Customers.some((customer) => isDoorCustomerMatch(normalized, customer))) {
    return DRIVER_INSTRUCTIONS.DOCK_45;
  }
  if (door70Customers.some((customer) => isDoorCustomerMatch(normalized, customer))) {
    return DRIVER_INSTRUCTIONS.DOCK_94;
  }
  // If WISE finds the customer but the customer is not on the Excel door sheet, route to Dock 40.
  return DRIVER_INSTRUCTIONS.DOCK_45;
}

function normalizeForDoorMatch(value = "") {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function compactDoorValue(value = "") {
  return normalizeForDoorMatch(value).replace(/\s+/g, "");
}

function isDoorCustomerMatch(normalizedCustomer, mappedCustomer) {
  const mapped = normalizeForDoorMatch(mappedCustomer);
  const compactCustomer = compactDoorValue(normalizedCustomer);
  const compactMapped = compactDoorValue(mapped);
  if (!mapped || !compactMapped) return false;
  if (compactCustomer === compactMapped) return true;
  if (compactMapped.length >= 8 && compactCustomer.includes(compactMapped)) return true;
  if (compactCustomer.length >= 8 && compactMapped.includes(compactCustomer)) return true;
  return false;
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
    showLicenseValidation("success", message || "Picture accepted.");
  } else {
    showLicenseValidation("error", message || "Please upload a picture before continuing.");
  }
}

function validateDriverLicenseImage(file) {
  driverPhotoValidated = false;
  driverPhotoValidating = false;
  if (driverPhotoValidationTimer) {
    clearTimeout(driverPhotoValidationTimer);
    driverPhotoValidationTimer = null;
  }

  if (!file) {
    finishValidation(false, "Please upload a picture before continuing.");
    return;
  }

  finishValidation(true, "Picture accepted.");
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
