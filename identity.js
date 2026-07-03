const photo = document.querySelector("#licensePhoto");
const missingPhoto = document.querySelector("#missingPhoto");
const meta = document.querySelector("#identityMeta");
const confirmedBtn = document.querySelector("#identityConfirmedBtn");
const confirmedMessage = document.querySelector("#confirmedMessage");

let storedPhoto = localStorage.getItem("driverLicensePhoto");
let identityData = JSON.parse(localStorage.getItem("driverIdentityData") || "{}");

loadIdentity();

async function loadIdentity() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (id) {
    try {
      const response = await fetch(`/api/identity/${encodeURIComponent(id)}`);
      if (response.ok) {
        identityData = await response.json();
        storedPhoto = identityData.photo || "";
      }
    } catch {
      // Static-file fallback keeps using local browser storage.
    }
  }

  renderIdentity();
}

function renderIdentity() {
  if (storedPhoto) {
    photo.src = storedPhoto;
    photo.hidden = false;
    missingPhoto.hidden = true;
  } else {
    photo.hidden = true;
    missingPhoto.hidden = false;
  }

  const driverName = `${identityData.firstName || ""} ${identityData.lastName || ""}`.trim() || "Driver";
  meta.innerHTML = [
    ["ET#", identityData.etNumber || "Pending"],
    ["RN / Load", identityData.rnNumber || "Not provided"],
    ["Driver", driverName],
    ["License", identityData.license || "Not entered"],
    ["Customer", identityData.customer || "Not entered"],
    ["Door Assignment", identityData.assignment || "Not assigned"]
  ]
    .map(([label, value]) => `<div class="review-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`)
    .join("");
}

confirmedBtn.addEventListener("click", () => {
  confirmedBtn.textContent = "Confirmed";
  confirmedBtn.disabled = true;
  confirmedMessage.hidden = false;
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}
