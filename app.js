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

// Column F: "Go to the door at Dock 45"
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
  DOCK_45: "Go to the door at Dock 45",
  DOCK_94: "Go to Dock 94",
  DROP_EMPTY: "Drop off container / trailer at any open spot in the yard",
  PICKUP_EMPTY: "Please proceed to pick up your empty",
  UNIS_DRIVER_DOCK_93: "Please proceed to dock 93"
});

const APP_BUILD_VERSION = "strictet12";
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

document.querySelector("#loginMode").addEventListener("change", (event) => {
  const apptMode = event.target.value.includes("APPT");
  document.querySelector(".phone-row").style.display = apptMode ? "none" : "grid";
  document.querySelector(".login-alt").style.display = apptMode ? "grid" : "none";
});

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
  return isDropOffFull() || isDropOffEmpty() || isPickupEmpty();
}

function getImmediateTaskInstruction() {
  if (isPickupEmpty()) return DRIVER_INSTRUCTIONS.PICKUP_EMPTY;
  return DRIVER_INSTRUCTIONS.DROP_EMPTY;
}

// After 3 failed PO/RN/Load lookups, show this message
const FALLBACK_AFTER_MAX_ATTEMPTS = ASSISTANCE_DOOR_INSTRUCTION;
let rnLookupAttempts = 0;
let lastValidatedRn = "";
let lastValidatedRnResult = null;

nextBtn.addEventListener("click", async () => {
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
      showActionError("Please enter a PO / RN / Load # before continuing.");
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
      const tried = identifiers.join(", ");
      if (rnLookupAttempts >= 3) {
        showLargeInstructionScreen(FALLBACK_AFTER_MAX_ATTEMPTS, DRIVER_INSTRUCTIONS.FALLBACK_DETAIL_165_166);
      } else {
        showActionError(`PO / RN / Load "${tried}" was not found in the system. Please check the number and try again. (Attempt ${rnLookupAttempts}/3)`);
      }
    }
    return;
  }

  if (!validateScreen()) return;
  showScreen(currentScreen + 1);
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
  if (index === 6) setCompleteHeader("complete");
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
    if (!field.value.trim()) {
      showActionError(getRequiredFieldMessage(field));
      field.focus();
      return false;
    }
  }

  if (currentScreen === 1) {
    const driverPhotoInput = form.elements.driverPhoto;
    if (!driverPhotoInput.files || !driverPhotoInput.files.length) {
      const message = "Please upload a picture before continuing.";
      showLicenseValidation("error", message);
      showActionError(message);
      return false;
    }
    if (driverPhotoValidating || !driverPhotoValidated) {
      const message = "Please upload a picture before continuing.";
      showLicenseValidation(driverPhotoValidating ? "info" : "error", message);
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
    ["PO / RN / Load", data.loadNo || ""]
  ];

  review.innerHTML = rows
    .map(([label, value]) => {
      return `<div class="review-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value || "Not entered")}</span></div>`;
    })
    .join("");
}


async function completeCheckin() {
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

  // Do not recover by load alone; exact idempotency signature is required to reuse an ET.

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
    identityQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=190x190&margin=8&data=${encodeURIComponent(identityUrl)}`;
    identityQrLink.href = identityUrl;
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
    identityQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=190x190&margin=8&data=${encodeURIComponent(identityUrl)}`;
    identityQrLink.href = identityUrl;
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
  return EXCEL_DEFAULT_DOOR;
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
