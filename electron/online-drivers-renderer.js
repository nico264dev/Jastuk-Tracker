let selectors = {};

let refreshTimer = null;
let onlineDrivers = [];
let refreshInFlight = false;
let driverGridHovered = false;
let currentLocalDiagnostic = null;
let lastDriverGridMarkup = "";

function initializeSelectors() {
  selectors = {
    apiUrlLabel: document.getElementById("sidebar-api-url"),
    subtitle: document.getElementById("online-subtitle"),
    status: document.getElementById("live-status"),
    updated: document.getElementById("live-updated"),
    driverCount: document.getElementById("live-driver-count"),
    driverGrid: document.getElementById("online-driver-grid")
  };
}

function formatValue(value) {
  return value === undefined || value === null || value === "" ? "-" : value;
}

function formatSpeed(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric)} KM/H` : `${value} KM/H`;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function parseTrackerPayload(data) {
  let parsed = data;
  for (let index = 0; index < 3; index += 1) {
    if (typeof parsed !== "string") {
      return parsed;
    }

    const trimmed = parsed.trim();
    if (!trimmed) {
      return parsed;
    }

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return parsed;
    }
  }

  return parsed;
}

function isMissingText(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return !text || text === "-" || text === "unknown" || text === "unknown game" || text === "unknown city" || text === "unknown truck";
}

function firstUseful(...values) {
  return values.find((value) => !isMissingText(value));
}

function textFromObject(value) {
  if (isMissingText(value)) {
    return null;
  }

  if (typeof value !== "object") {
    return value;
  }

  return firstUseful(
    value.display_name,
    value.displayName,
    value.game_name,
    value.gameName,
    value.name,
    value.id,
    value.city,
    value.company
  ) || null;
}

function truckFromRaw(raw) {
  const truck = raw?.telemetryApi?.live?.truck || raw?.telemetryApi?.telemetry?.truck || raw?.truck || raw?.live?.truck || raw?.telemetry?.truck;
  if (!truck || typeof truck !== "object") {
    return null;
  }

  const display = firstUseful(truck.display_name, truck.displayName);
  if (display) {
    return display;
  }

  const brand = firstUseful(truck.brand, truck.make, truck.manufacturer);
  const model = firstUseful(truck.name, truck.model, truck.truckName, truck.truckModel);
  return [brand, model].filter((part, index, parts) => !isMissingText(part) && parts.indexOf(part) === index).join(" ") || null;
}

async function fetchLocalTelemetryDriver(baseDriver) {
  try {
    const apiUrl = await window.jastuk.getApiUrl();
    const response = await fetch(`${apiUrl}/api/live`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    const live = parseTrackerPayload(await response.text());
    const truck = live?.truck || {};
    const job = live?.navigation?.current_job || {};
    const truckName = firstUseful(truck.display_name, truck.displayName, [truck.brand, truck.name].filter(Boolean).join(" "));
    const speed = firstUseful(truck.speed_kmh, truck.speedKmh, truck.speed?.kmh, truck.speed?.kph);
    const speedMps = firstUseful(truck.speed_mps, truck.speedMps);
    const speedKmh = speed !== undefined ? speed : speedMps !== undefined ? Number(speedMps) * 3.6 : undefined;
    const sourceStop = [job.source?.city, job.source?.company].filter(Boolean).join(" (").replace(/\(([^)]*)$/, "($1)");
    const destinationStop = [job.destination?.city, job.destination?.company].filter(Boolean).join(" (").replace(/\(([^)]*)$/, "($1)");

    return {
      ...baseDriver,
      id: baseDriver?.id || "local-driver",
      name: baseDriver?.name || "Local Driver",
      status: Number(speedKmh) > 0 ? "Driving" : job.cargo_loaded ? "On job" : baseDriver?.status || "Connected",
      telemetryAvailable: true,
      source: "local",
      game: firstUseful(job.game_name, job.gameName, live.game?.name, job.game_id, live.game?.id, baseDriver?.game),
      truck: firstUseful(truckName, baseDriver?.truck),
      speed: speedKmh,
      city: firstUseful(live.location?.city, job.source?.city, baseDriver?.city),
      cargo: firstUseful(job.cargo_name, job.cargoName, job.cargo, baseDriver?.cargo),
      route: sourceStop || destinationStop
        ? `${sourceStop || "?"} -> ${destinationStop || "?"}`
        : baseDriver?.route,
      distance: firstUseful(job.planned_distance_km ? `${Math.round(Number(job.planned_distance_km))} KM` : null, baseDriver?.distance),
      damage: firstUseful(job.cargo_damage !== undefined ? `${Math.round(Number(job.cargo_damage) * 100)}%` : null, baseDriver?.damage),
      updatedAt: live.updated_at_utc || baseDriver?.updatedAt || new Date().toISOString(),
      jobStops: {
        ...baseDriver?.jobStops,
        source: sourceStop || baseDriver?.jobStops?.source,
        destination: destinationStop || baseDriver?.jobStops?.destination,
        sourceCity: job.source?.city || baseDriver?.jobStops?.sourceCity,
        sourceCompany: job.source?.company || baseDriver?.jobStops?.sourceCompany,
        destinationCity: job.destination?.city || baseDriver?.jobStops?.destinationCity,
        destinationCompany: job.destination?.company || baseDriver?.jobStops?.destinationCompany
      },
      raw: {
        ...baseDriver?.raw,
        telemetryApi: {
          ...baseDriver?.raw?.telemetryApi,
          live
        }
      }
    };
  } catch {
    return null;
  }
}

function normalizeDriverForDisplay(driver) {
  const raw = driver?.raw || {};
  const currentJob = raw?.jobsApi?.current_job ||
    raw?.jobsApi?.currentJob ||
    raw?.telemetryApi?.live?.navigation?.current_job ||
    raw?.telemetryApi?.telemetry?.navigation?.current_job ||
    raw?.navigation?.current_job ||
    {};

  return {
    ...driver,
    game: firstUseful(
      driver.game,
      textFromObject(currentJob.game),
      currentJob.game_name,
      currentJob.gameName,
      currentJob.game_id,
      raw?.jobsApi?.game_name,
      raw?.jobsApi?.game_id,
      textFromObject(raw?.telemetryApi?.live?.game),
      textFromObject(raw?.telemetryApi?.telemetry?.game),
      textFromObject(raw?.game)
    ),
    truck: firstUseful(driver.truck, truckFromRaw(raw)),
    city: firstUseful(
      driver.city,
      driver.jobStops?.sourceCity,
      driver.jobStops?.destinationCity,
      currentJob.source?.city,
      currentJob.destination?.city,
      raw?.location?.city,
      raw?.telemetryApi?.live?.location?.city,
      raw?.telemetryApi?.telemetry?.location?.city
    ),
    cargo: firstUseful(driver.cargo, currentJob.cargo_name, currentJob.cargoName, currentJob.cargo),
    route: firstUseful(driver.route) || (
      firstUseful(driver.jobStops?.source, currentJob.source?.city) || firstUseful(driver.jobStops?.destination, currentJob.destination?.city)
        ? `${firstUseful(driver.jobStops?.source, currentJob.source?.city) || "?"} -> ${firstUseful(driver.jobStops?.destination, currentJob.destination?.city) || "?"}`
        : null
    ),
    distance: firstUseful(driver.distance, currentJob.planned_distance_km ? `${Math.round(Number(currentJob.planned_distance_km))} KM` : null),
    damage: firstUseful(driver.damage, currentJob.cargo_damage !== undefined ? `${Math.round(Number(currentJob.cargo_damage) * 100)}%` : null)
  };
}

function getLocalDiagnostic(response, telemetryDrivers) {
  const localError = response?.errors?.local;
  const pushError = response?.errors?.push;

  if (localError) {
    const message = String(localError);
    if (message.includes("ECONNREFUSED")) {
      return "Shared live is connected. Local telemetry is offline, so you can view other online drivers but your own truck will not be published.";
    }

    if (message.toLowerCase().includes("timed out") || message.toLowerCase().includes("timeout")) {
      return "Shared live is connected. Local telemetry is not answering fast enough, so only shared online drivers are shown.";
    }

    return `Shared live is connected. Local telemetry failed, so only shared online drivers are shown: ${message}`;
  }

  if (pushError) {
    return `Local telemetry was found, but publishing this driver failed: ${pushError}`;
  }

  if (!response?.localDriver && telemetryDrivers.length) {
    return "Shared live map is connected. This PC has not reported local telemetry yet.";
  }

  return null;
}

function escapeHtml(value) {
  return String(formatValue(value))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderDriver(driver) {
  return `
    <article class="card online-driver-card">
      <div class="online-driver-head">
        <div>
          <div class="online-driver-name">${escapeHtml(driver.name)}</div>
          <div class="online-driver-meta">${escapeHtml(driver.status)} - ${escapeHtml(driver.game || "Unknown game")}</div>
        </div>
        <div class="online-driver-speed">${escapeHtml(formatSpeed(driver.speed))}</div>
      </div>
      <div class="online-driver-brief">
        <span><i class="fa-solid fa-truck"></i>${escapeHtml(driver.truck)}</span>
        <span><i class="fa-solid fa-location-dot"></i>${escapeHtml(driver.city)}</span>
      </div>
    </article>
  `;
}

function getDriverGridMarkup(telemetryDrivers, localDiagnostic) {
  const diagnosticCard = localDiagnostic
    ? `<article class="card online-driver-card">
        <div class="help-text">${escapeHtml(localDiagnostic)}</div>
      </article>`
    : "";

  return telemetryDrivers.length
    ? `${diagnosticCard}${telemetryDrivers.map(renderDriver).join("")}`
    : `<article class="card online-driver-card">
        <div class="help-text">
          No shared online drivers found right now. You do not need to run the game to check this page.
        </div>
      </article>`;
}

function renderDriverGrid(telemetryDrivers, localDiagnostic, force = false) {
  const markup = getDriverGridMarkup(telemetryDrivers, localDiagnostic);
  if (!force && driverGridHovered && selectors.driverGrid.children.length) {
    return;
  }

  if (force || markup !== lastDriverGridMarkup) {
    selectors.driverGrid.innerHTML = markup;
    lastDriverGridMarkup = markup;
  }
}

async function renderLiveData(response) {
  const drivers = Array.isArray(response.drivers) ? response.drivers : [];
  const directLocalDriver = await fetchLocalTelemetryDriver(response.localDriver);
  const localDriver = directLocalDriver || (response.localDriver?.telemetryAvailable ? response.localDriver : null);
  const mergedDrivers = localDriver
    ? [
      localDriver,
      ...drivers.filter((driver) =>
        String(driver.id) !== String(localDriver.id) &&
        String(driver.name || "").toLowerCase() !== String(localDriver.name || "").toLowerCase())
    ]
    : drivers;
  const telemetryDrivers = mergedDrivers.filter((driver) => driver.telemetryAvailable).map(normalizeDriverForDisplay);
  const localDiagnostic = getLocalDiagnostic(response, telemetryDrivers);
  currentLocalDiagnostic = localDiagnostic;
  onlineDrivers = telemetryDrivers;

  selectors.status.textContent = localDiagnostic ? "Shared online" : "Connected";
  selectors.status.classList.add("connected");
  selectors.updated.textContent = drivers[0]?.updatedAt ? formatDate(drivers[0].updatedAt) : new Date().toLocaleString();
  selectors.driverCount.textContent = telemetryDrivers.length;
  if (selectors.subtitle) {
    selectors.subtitle.textContent = localDiagnostic || (telemetryDrivers.length
      ? "Live data refreshes every 0.5 seconds from local telemetry and the shared live endpoint."
      : "No shared online drivers found right now. You do not need to run the game to check this page.");
  }

  renderDriverGrid(telemetryDrivers, localDiagnostic);
}

function renderOffline(error) {
  const message = String(error || "");
  const friendlyMessage = message.includes("ECONNREFUSED")
    ? "Local tracker is offline. Start ETS2/ATS with the Jastuk tracker plugin running, then this page will reconnect automatically."
    : message.toLowerCase().includes("timed out") || message.toLowerCase().includes("timeout")
      ? "The tracker request timed out. Start ETS2/ATS with the telemetry DLL loaded, and check that https://api.jastukvtc.com/live/drivers is reachable."
      : message.includes("telemetryAvailable is false")
        ? "The local tracker answered, but did not report game telemetry yet. Open ETS2/ATS, load into your truck, and make sure the DLL is in the game's win_x64/plugins folder."
    : `Unable to reach live tracker data: ${message || "Unknown error"}`;

  selectors.status.textContent = "Offline";
  selectors.status.classList.remove("connected");
  selectors.updated.textContent = new Date().toLocaleString();
  selectors.driverCount.textContent = "0";
  if (selectors.subtitle) {
    selectors.subtitle.textContent = "Start the game/plugin so the local tracker can stream live telemetry.";
  }
  selectors.driverGrid.innerHTML = `<article class="card online-driver-card"><div class="help-text">${escapeHtml(friendlyMessage)}</div></article>`;
  lastDriverGridMarkup = selectors.driverGrid.innerHTML;
  currentLocalDiagnostic = null;
  onlineDrivers = [];
}

async function refreshLiveDrivers() {
  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;
  try {
    const response = await window.jastuk.fetchLiveDrivers();
    if (!response.success) {
      renderOffline(response.error || "Unknown error");
      return;
    }

    await renderLiveData(response);
  } finally {
    refreshInFlight = false;
  }
}

async function initialize() {
  await window.jastukLayout.ready;
  initializeSelectors();
  if (selectors.apiUrlLabel) {
    selectors.apiUrlLabel.textContent = await window.jastuk.getApiUrl();
  }

  selectors.driverGrid.addEventListener("pointerenter", () => {
    driverGridHovered = true;
  });

  selectors.driverGrid.addEventListener("pointerleave", () => {
    driverGridHovered = false;
    renderDriverGrid(onlineDrivers, currentLocalDiagnostic, true);
  });

  await refreshLiveDrivers();
  refreshTimer = setInterval(refreshLiveDrivers, 1500);
}

window.addEventListener("beforeunload", () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});

document.addEventListener("DOMContentLoaded", initialize);
