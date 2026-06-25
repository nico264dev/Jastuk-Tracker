const LAYOUT_DEFAULT_ADMIN_DISCORD_IDS = [
  "1496983353037951167",
  "1496920531721650428",
  "1496983823953428520"
];

async function loadPartialInto(placeholder) {
  const partialName = placeholder.dataset.partial;
  placeholder.outerHTML = await window.jastuk.loadPartial(partialName);
}

function parseLayoutAdminIdList(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return source.map((entry) => String(entry).trim()).filter(Boolean);
}

function isSidebarAdminUser(user, adminIds) {
  if (!user) {
    return false;
  }

  const candidates = [
    user.id,
    user.discordId,
    user.discord_id,
    user.userId,
    user.user_id,
    ...parseLayoutAdminIdList(user.roles)
  ].map(String).filter(Boolean);

  return candidates.some((id) => adminIds.has(id));
}

async function configureSidebar() {
  const page = document.body.dataset.page || "dashboard";
  const dashboardOnlyNav = document.querySelector(".dashboard-only-nav");

  if (dashboardOnlyNav) {
    dashboardOnlyNav.hidden = false;
  }

  document.querySelectorAll("[data-page-link]").forEach((item) => {
    item.classList.toggle("active", item.dataset.pageLink === page);
  });

  document.querySelectorAll(".nav-item[data-tab]").forEach((item) => {
    item.classList.remove("active");
  });

  document.querySelectorAll("[data-admin-only]").forEach((item) => {
    item.hidden = true;
  });
}

let removeLayoutUpdaterStatusListener = null;

function ensureUpdatePopup() {
  let popup = document.getElementById("update-popup");
  if (popup) {
    return popup;
  }

  popup = document.createElement("div");
  popup.id = "update-popup";
  popup.className = "update-popup";
  popup.hidden = true;
  popup.innerHTML = `
    <div class="update-popup-panel" role="dialog" aria-modal="true" aria-labelledby="update-popup-title">
      <button id="update-popup-close" class="icon-button update-popup-close" type="button" title="Close" aria-label="Close">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div class="update-popup-icon"><i class="fa-solid fa-cloud-arrow-down"></i></div>
      <div>
        <h3 id="update-popup-title">Update available</h3>
        <p id="update-popup-message">A new Jastuk Tracker version is ready.</p>
      </div>
      <div class="update-popup-actions">
        <button id="update-popup-secondary" class="button button-secondary" type="button">Later</button>
        <button id="update-popup-primary" class="button button-primary" type="button">Download</button>
      </div>
    </div>
  `;
  document.body.appendChild(popup);
  return popup;
}

function hideUpdatePopup() {
  const popup = document.getElementById("update-popup");
  if (popup) {
    popup.hidden = true;
  }
}

function renderUpdatePopup(status) {
  if (!status || !["available", "downloaded"].includes(status.status)) {
    return;
  }

  const nextVersion = status.updateInfo?.version;
  const popupKey = `${status.status}:${nextVersion || "unknown"}`;
  if (status.status === "available" && sessionStorage.getItem("jastuk-update-popup-dismissed") === popupKey) {
    return;
  }

  const popup = ensureUpdatePopup();
  const title = document.getElementById("update-popup-title");
  const message = document.getElementById("update-popup-message");
  const primary = document.getElementById("update-popup-primary");
  const secondary = document.getElementById("update-popup-secondary");
  const close = document.getElementById("update-popup-close");

  title.textContent = status.status === "downloaded" ? "Update ready to install" : "Update available";
  message.textContent = status.status === "downloaded"
    ? `Jastuk Tracker ${nextVersion || ""} has been downloaded. Restart to install it.`
    : `Jastuk Tracker ${nextVersion || ""} is available. Download it now so you are ready to update.`;
  primary.textContent = status.status === "downloaded" ? "Restart & install" : "Download";
  secondary.textContent = "Later";

  primary.onclick = async () => {
    primary.disabled = true;
    if (status.status === "downloaded") {
      await window.jastuk.installUpdate();
      return;
    }

    const nextStatus = await window.jastuk.downloadUpdate();
    renderUpdatePopup(nextStatus);
  };
  secondary.onclick = () => {
    sessionStorage.setItem("jastuk-update-popup-dismissed", popupKey);
    hideUpdatePopup();
  };
  close.onclick = secondary.onclick;

  popup.hidden = false;
}

async function configureFooter() {
  document.querySelectorAll("[data-open-url]").forEach((button) => {
    button.addEventListener("click", () => {
      window.jastuk.openUrl(button.dataset.openUrl);
    });
  });

  try {
    const status = await window.jastuk.getUpdaterStatus();
    const versionLabel = document.getElementById("app-version-label");
    if (versionLabel) {
      versionLabel.textContent = `v${status.currentVersion || "-"}`;
    }
    renderUpdatePopup(status);
  } catch {
    // Footer version is helpful, not critical.
  }

  if (removeLayoutUpdaterStatusListener) {
    removeLayoutUpdaterStatusListener();
  }
  removeLayoutUpdaterStatusListener = window.jastuk.onUpdaterStatus((status) => {
    const versionLabel = document.getElementById("app-version-label");
    if (versionLabel) {
      versionLabel.textContent = `v${status.currentVersion || "-"}`;
    }
    renderUpdatePopup(status);
  });
}

async function loadLayoutPartials() {
  const placeholders = Array.from(document.querySelectorAll("[data-partial]"));
  await Promise.all(placeholders.map(loadPartialInto));
  await configureSidebar();
  await configureFooter();
  document.dispatchEvent(new CustomEvent("jastuk-layout-ready"));
}

window.addEventListener("beforeunload", () => {
  if (removeLayoutUpdaterStatusListener) {
    removeLayoutUpdaterStatusListener();
    removeLayoutUpdaterStatusListener = null;
  }
});

window.jastukLayout = {
  ready: new Promise((resolve, reject) => {
    document.addEventListener("DOMContentLoaded", () => {
      loadLayoutPartials().then(resolve).catch(reject);
    }, { once: true });
  })
};
