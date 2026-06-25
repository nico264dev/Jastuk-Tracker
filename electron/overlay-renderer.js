let refreshTimer = null;
let lastSuccessfulUpdate = 0;
let refreshInFlight = false;
let pendingRenderData = null;
let renderFrame = null;
const STALE_OVERLAY_MS = 8000;
let overlaySettings = {
  requireGameFocus: false,
  fields: []
};

const selectors = {
  bar: document.getElementById("overlay-bar"),
  driver: document.getElementById("overlay-driver"),
  status: document.getElementById("overlay-status"),
  speed: document.getElementById("overlay-speed"),
  rpm: document.getElementById("overlay-rpm"),
  gear: document.getElementById("overlay-gear"),
  truck: document.getElementById("overlay-truck"),
  route: document.getElementById("overlay-route"),
  fuel: document.getElementById("overlay-fuel"),
  damage: document.getElementById("overlay-damage"),
  odometer: document.getElementById("overlay-odometer"),
  speedLimit: document.getElementById("overlay-speed-limit"),
  cruise: document.getElementById("overlay-cruise"),
  systems: document.getElementById("overlay-systems"),
  lights: document.getElementById("overlay-lights"),
  warnings: document.getElementById("overlay-warnings"),
  temps: document.getElementById("overlay-temps"),
  pressure: document.getElementById("overlay-pressure")
};

function formatValue(value) {
  return value === undefined || value === null || value === "" ? "-" : value;
}

function formatSpeed(value) {
  const speed = Number(value);
  return Number.isFinite(speed) ? `${Math.round(speed)} KM/H` : formatValue(value);
}

function formatFuel(fuel) {
  if (!fuel) {
    return "-";
  }

  return [fuel.percent, fuel.range].filter(Boolean).join(" / ") || "-";
}

function compactText(value, maxLength = 64) {
  const text = formatValue(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function setText(element, value) {
  if (element) {
    const text = formatValue(value);
    if (element.textContent !== text) {
      element.textContent = text;
    }
  }
}

function joinParts(parts) {
  return parts.filter((part) => part !== undefined && part !== null && part !== "").join(" / ") || "-";
}

function renderOffline(message) {
  setText(selectors.driver, "Jastuk Tracker");
  setText(selectors.status, message || "Waiting for local telemetry...");
  setText(selectors.speed, "-");
  setText(selectors.rpm, "-");
  setText(selectors.gear, "-");
  setText(selectors.truck, "-");
  setText(selectors.route, "-");
  setText(selectors.fuel, "-");
  setText(selectors.damage, "-");
  setText(selectors.odometer, "-");
  setText(selectors.speedLimit, "-");
  setText(selectors.cruise, "-");
  setText(selectors.systems, "-");
  setText(selectors.lights, "-");
  setText(selectors.warnings, "-");
  setText(selectors.temps, "-");
  setText(selectors.pressure, "-");
}

function renderOverlay(data) {
  if (data?.hideOverlay) {
    document.body.dataset.visible = "false";
    renderOffline(data.error || "Overlay paused");
    return;
  }

  if (overlaySettings.requireGameFocus && data?.foregroundGame?.isGame === false) {
    document.body.dataset.visible = "false";
    renderOffline("Overlay paused");
    return;
  }

  if (!data?.success) {
    if (Date.now() - lastSuccessfulUpdate <= STALE_OVERLAY_MS) {
      document.body.dataset.visible = "true";
      return;
    }

    document.body.dataset.visible = "false";
    renderOffline(data?.error?.includes("ECONNREFUSED")
      ? "Local tracker offline"
      : data?.error || "Waiting for telemetry...");
    return;
  }

  lastSuccessfulUpdate = Date.now();
  document.body.dataset.visible = "true";
  setText(selectors.driver, data.name || "Local Driver");
  setText(selectors.status, `${formatValue(data.status)} - ${formatValue(data.city)}`);
  setText(selectors.speed, formatSpeed(data.speed));
  setText(selectors.rpm, data.rpm);
  setText(selectors.gear, data.gear);
  setText(selectors.truck, data.truck);
  setText(selectors.route, compactText(data.route || data.cargo || data.distance || data.navigation?.distance, 72));
  setText(selectors.fuel, formatFuel(data.fuel));
  setText(selectors.damage, data.damage);
  setText(selectors.odometer, data.odometer);
  setText(selectors.speedLimit, data.navigation?.speedLimit);
  setText(selectors.cruise, data.systems?.cruise);
  setText(selectors.systems, compactText(data.systems?.controls, 58));
  setText(selectors.lights, compactText(data.systems?.lights, 48));
  setText(selectors.warnings, compactText(data.systems?.warnings, 48));
  setText(selectors.temps, joinParts([
    data.systems?.oilTemperature ? `Oil ${data.systems.oilTemperature}` : null,
    data.systems?.waterTemperature ? `Water ${data.systems.waterTemperature}` : null,
    data.systems?.wear ? `Wear ${data.systems.wear}` : null
  ]));
  setText(selectors.pressure, joinParts([
    data.systems?.brakeAirPressure ? `Air ${data.systems.brakeAirPressure}` : null,
    data.systems?.batteryVoltage ? `Batt ${data.systems.batteryVoltage}` : null,
    data.systems?.oilPressure ? `Oil ${data.systems.oilPressure}` : null
  ]));
}

async function refreshOverlay() {
  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;
  try {
    pendingRenderData = await window.jastuk.fetchOverlayData();
    if (!renderFrame) {
      renderFrame = requestAnimationFrame(() => {
        renderFrame = null;
        renderOverlay(pendingRenderData);
      });
    }
  } finally {
    refreshInFlight = false;
  }
}

function applySettings(settings) {
  overlaySettings = {
    ...overlaySettings,
    ...settings,
    fields: Array.isArray(settings?.fields) ? settings.fields : overlaySettings.fields
  };
  document.body.dataset.position = settings?.position || "top";
  const opacity = Number(settings?.opacity);
  if (Number.isFinite(opacity)) {
    const backgroundColor = `rgba(38, 58, 45, ${Math.max(0.36, Math.min(1, opacity))})`;
    if (selectors.bar.style.backgroundColor !== backgroundColor) {
      selectors.bar.style.backgroundColor = backgroundColor;
    }
  }

  const visibleFields = new Set(overlaySettings.fields);
  let visibleCount = 0;
  document.querySelectorAll("[data-overlay-field]").forEach((element) => {
    const field = element.dataset.overlayField;
    const isVisible = visibleFields.size === 0 || visibleFields.has(field);
    if (element.hidden === isVisible) {
      element.hidden = !isVisible;
    }
    if (isVisible) {
      visibleCount += 1;
    }
  });
  const density = visibleCount > 12 ? "packed" : "comfortable";
  if (document.body.dataset.density !== density) {
    document.body.dataset.density = density;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.jastuk.onOverlaySettings(applySettings);
  refreshOverlay();
  refreshTimer = setInterval(refreshOverlay, 1000);
});

window.addEventListener("beforeunload", () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});
