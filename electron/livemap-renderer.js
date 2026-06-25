let selectors = {};
let refreshTimer = null;
let refreshInFlight = false;
let cities = [];
let drivers = [];
let selectedDriverId = null;
let mapMode = "eut2";
let mapCamera = { x: 0, y: 0, scale: 1 };
let dragState = null;
let renderedTileMode = null;
let currentBounds = null;
let currentWorldSize = 4096;
let visibleCitiesCache = [];
let visibleDriversCache = [];
let animationFrame = null;
const driverMotion = new Map();

const HIGH_RES_WORLD_SIZE = 131072;
const DRIVER_MOVE_ANIMATION_MS = 480;
const DRIVER_MOVE_EPSILON = 0.5;

const TILE_SOURCES = {
  eut2: {
    minX: -113177.313,
    maxX: 97925.625,
    minZ: -122648.086,
    maxZ: 88454.85,
    maxZoom: 8,
    tileSize: 512,
    worldSize: HIGH_RES_WORLD_SIZE,
    sourceUrl: "https://map.truckershub.in/ets2/Tiles"
  },
  ats: {
    minX: -120098.891,
    maxX: 33419.875,
    minZ: -75265.26,
    maxZ: 78253.51,
    maxZoom: 8,
    tileSize: 512,
    worldSize: HIGH_RES_WORLD_SIZE,
    sourceUrl: "https://map.truckershub.in/ats/Tiles"
  },
  promods: {
    minX: -135110.156,
    maxX: 205684.1,
    minZ: -197653.719,
    maxZ: 143140.531,
    maxZoom: 8,
    tileSize: 512,
    worldSize: HIGH_RES_WORLD_SIZE,
    sourceUrl: "https://map.truckershub.in/ets2promods/Tiles"
  }
};

const gameAliases = {
  ets2: "eut2",
  eurotrucksimulator2: "eut2",
  eut2: "eut2",
  promods: "eut2",
  ats: "ats",
  amtrucks: "ats",
  americantrucksimulator: "ats"
};

function initializeSelectors() {
  selectors = {
    subtitle: document.getElementById("livemap-subtitle"),
    count: document.getElementById("livemap-driver-count"),
    updated: document.getElementById("livemap-updated"),
    canvas: document.getElementById("livemap-canvas"),
    layer: document.getElementById("livemap-layer"),
    tiles: document.getElementById("livemap-tiles"),
    svg: document.getElementById("livemap-svg"),
    empty: document.getElementById("livemap-empty"),
    detail: document.getElementById("livemap-detail"),
    controls: Array.from(document.querySelectorAll("[data-map-action]")),
    modeButtons: Array.from(document.querySelectorAll(".map-mode"))
  };
}

function escapeHtml(value) {
  return String(value === undefined || value === null || value === "" ? "-" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatSpeed(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric)} KM/H` : value ? `${value} KM/H` : "-";
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

function getFriendlyLiveMapError(error) {
  const message = String(error || "");
  if (message.includes("ECONNREFUSED")) {
    return "Local tracker is offline. Start ETS2/ATS with the telemetry DLL loaded, then the map will reconnect automatically.";
  }

  if (message.toLowerCase().includes("timed out") || message.toLowerCase().includes("timeout")) {
    return "The live map request timed out. The local telemetry server or shared live API did not answer quickly enough.";
  }

  return `Unable to reach live map data: ${message || "Unknown error"}`;
}

function normalizeGame(value) {
  const normalized = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return gameAliases[normalized] || normalized;
}

function getModeGame() {
  return mapMode === "promods" ? "eut2" : mapMode;
}

function getTileSource() {
  return TILE_SOURCES[mapMode] || null;
}

function getCityCoordinate(name, game) {
  const normalizedName = String(name || "").toLowerCase();
  if (!normalizedName) {
    return null;
  }

  return cities.find((city) => {
    const cityGame = normalizeGame(city.game || city.game_id);
    const cityName = String(city.name || city.city || city.id || "").toLowerCase();
    return cityGame === game && cityName === normalizedName;
  }) || cities.find((city) => {
    const cityGame = normalizeGame(city.game || city.game_id);
    const cityName = String(city.name || city.city || city.id || "").toLowerCase();
    return cityGame === game && (cityName.includes(normalizedName) || normalizedName.includes(cityName));
  }) || null;
}

function getDriverPosition(driver) {
  if (driver.position && Number.isFinite(Number(driver.position.x)) && Number.isFinite(Number(driver.position.z))) {
    return {
      x: Number(driver.position.x),
      z: Number(driver.position.z),
      source: "telemetry"
    };
  }

  const game = normalizeGame(driver.game) || getModeGame();
  const city = getCityCoordinate(driver.city, game);
  if (!city) {
    return null;
  }

  return {
    x: Number(city.x),
    z: Number(city.z),
    source: "city"
  };
}

function getVisibleCities() {
  const modeGame = getModeGame();
  return cities.filter((city) => normalizeGame(city.game || city.game_id) === modeGame);
}

function getVisibleDrivers() {
  const modeGame = getModeGame();
  return drivers
    .map((driver) => ({ ...driver, mapPosition: getDriverPosition(driver) }))
    .filter((driver) => driver.telemetryAvailable && driver.mapPosition && (!normalizeGame(driver.game) || normalizeGame(driver.game) === modeGame));
}

function getBounds(points) {
  const tileSource = getTileSource();
  if (tileSource) {
    return {
      minX: tileSource.minX,
      maxX: tileSource.maxX,
      minZ: tileSource.minZ,
      maxZ: tileSource.maxZ,
      tiled: true,
      worldSize: tileSource.worldSize
    };
  }

  const xs = points.map((point) => Number(point.x)).filter(Number.isFinite);
  const zs = points.map((point) => Number(point.z)).filter(Number.isFinite);
  if (!xs.length || !zs.length) {
    return { minX: -100000, maxX: 100000, minZ: -100000, maxZ: 100000 };
  }

  const padX = Math.max((Math.max(...xs) - Math.min(...xs)) * 0.08, 10000);
  const padZ = Math.max((Math.max(...zs) - Math.min(...zs)) * 0.08, 10000);
  return {
    minX: Math.min(...xs) - padX,
    maxX: Math.max(...xs) + padX,
    minZ: Math.min(...zs) - padZ,
    maxZ: Math.max(...zs) + padZ,
    worldSize: 4096
  };
}

function project(point, bounds) {
  const worldSize = bounds.worldSize || currentWorldSize;
  const xRatio = (Number(point.x) - bounds.minX) / (bounds.maxX - bounds.minX || 1);
  const zRatio = (Number(point.z) - bounds.minZ) / (bounds.maxZ - bounds.minZ || 1);
  return {
    x: Math.max(0, Math.min(worldSize, xRatio * worldSize)),
    y: Math.max(0, Math.min(worldSize, zRatio * worldSize))
  };
}

function clampCamera() {
  const viewport = selectors.canvas.getBoundingClientRect();
  const scaledWidth = currentWorldSize * mapCamera.scale;
  const scaledHeight = currentWorldSize * mapCamera.scale;
  const minX = Math.min(0, viewport.width - scaledWidth);
  const minY = Math.min(0, viewport.height - scaledHeight);

  mapCamera.x = scaledWidth <= viewport.width
    ? (viewport.width - scaledWidth) / 2
    : Math.max(minX, Math.min(0, mapCamera.x));
  mapCamera.y = scaledHeight <= viewport.height
    ? (viewport.height - scaledHeight) / 2
    : Math.max(minY, Math.min(0, mapCamera.y));
}

function applyCamera() {
  followSelectedDriver();
  clampCamera();
  const viewport = selectors.canvas.getBoundingClientRect();
  selectors.layer.style.width = `${viewport.width}px`;
  selectors.layer.style.height = `${viewport.height}px`;
  selectors.layer.style.transform = "none";
  renderTiles();
  renderOverlay();
}

function resetCamera() {
  const viewport = selectors.canvas.getBoundingClientRect();
  const fitScale = Math.min(viewport.width / currentWorldSize, viewport.height / currentWorldSize);
  mapCamera = {
    x: (viewport.width - currentWorldSize * fitScale) / 2,
    y: (viewport.height - currentWorldSize * fitScale) / 2,
    scale: fitScale
  };
  applyCamera();
}

function zoomMap(nextScale, originX, originY) {
  const canvasRect = selectors.canvas.getBoundingClientRect();
  const fitScale = Math.min(canvasRect.width / currentWorldSize, canvasRect.height / currentWorldSize);
  const maxScale = getTileSource() ? 1 : 12;
  const clampedScale = Math.max(fitScale, Math.min(maxScale, nextScale));
  const localX = originX - canvasRect.left;
  const localY = originY - canvasRect.top;
  const worldX = (localX - mapCamera.x) / mapCamera.scale;
  const worldY = (localY - mapCamera.y) / mapCamera.scale;

  mapCamera.scale = clampedScale;
  mapCamera.x = localX - worldX * mapCamera.scale;
  mapCamera.y = localY - worldY * mapCamera.scale;
  applyCamera();
  updateZoomHint();
}

function zoomFromCenter(multiplier) {
  const rect = selectors.canvas.getBoundingClientRect();
  zoomMap(mapCamera.scale * multiplier, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function worldToScreen(point) {
  return {
    x: mapCamera.x + point.x * mapCamera.scale,
    y: mapCamera.y + point.y * mapCamera.scale
  };
}

function easeOutCubic(value) {
  return 1 - ((1 - value) ** 3);
}

function lerpPoint(from, to, progress) {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress
  };
}

function getDriverKey(driver) {
  return String(driver.id || driver.name || "");
}

function getSelectedDriver() {
  return selectedDriverId
    ? visibleDriversCache.find((driver) => getDriverKey(driver) === String(selectedDriverId))
    : null;
}

function getMotionPoint(motion, now = performance.now()) {
  const progress = Math.max(0, Math.min(1, (now - motion.startedAt) / motion.duration));
  return lerpPoint(motion.from, motion.to, easeOutCubic(progress));
}

function updateDriverMotionTargets(visibleDrivers, bounds) {
  const now = performance.now();
  const activeKeys = new Set();

  visibleDrivers.forEach((driver) => {
    const key = getDriverKey(driver);
    if (!key) {
      return;
    }

    activeKeys.add(key);
    const target = project(driver.mapPosition, bounds);
    const existing = driverMotion.get(key);
    if (!existing) {
      driverMotion.set(key, {
        from: target,
        to: target,
        startedAt: now,
        duration: DRIVER_MOVE_ANIMATION_MS
      });
      return;
    }

    const targetDistance = Math.hypot(existing.to.x - target.x, existing.to.y - target.y);
    if (targetDistance < DRIVER_MOVE_EPSILON) {
      return;
    }

    driverMotion.set(key, {
      from: getMotionPoint(existing, now),
      to: target,
      startedAt: now,
      duration: DRIVER_MOVE_ANIMATION_MS
    });
  });

  Array.from(driverMotion.keys()).forEach((key) => {
    if (!activeKeys.has(key)) {
      driverMotion.delete(key);
    }
  });
}

function getDriverMapPoint(driver) {
  const motion = driverMotion.get(getDriverKey(driver));
  return motion ? getMotionPoint(motion) : project(driver.mapPosition, currentBounds);
}

function followSelectedDriver() {
  const selectedDriver = getSelectedDriver();
  if (!selectedDriver || !currentBounds || !selectors.canvas) {
    return false;
  }

  const viewport = selectors.canvas.getBoundingClientRect();
  const point = getDriverMapPoint(selectedDriver);
  mapCamera.x = viewport.width / 2 - point.x * mapCamera.scale;
  mapCamera.y = viewport.height / 2 - point.y * mapCamera.scale;
  clampCamera();
  return true;
}

function getSelectedDriverZoomScale() {
  const viewport = selectors.canvas.getBoundingClientRect();
  const fitScale = Math.min(viewport.width / currentWorldSize, viewport.height / currentWorldSize);
  if (getTileSource()) {
    return Math.min(0.45, Math.max(fitScale * 18, 0.12));
  }

  return Math.min(12, Math.max(fitScale * 6, 2));
}

function zoomToSelectedDriver() {
  const selectedDriver = getSelectedDriver();
  if (!selectedDriver || !currentBounds || !selectors.canvas) {
    return false;
  }

  const viewport = selectors.canvas.getBoundingClientRect();
  const point = getDriverMapPoint(selectedDriver);
  mapCamera.scale = Math.max(mapCamera.scale, getSelectedDriverZoomScale());
  mapCamera.x = viewport.width / 2 - point.x * mapCamera.scale;
  mapCamera.y = viewport.height / 2 - point.y * mapCamera.scale;
  renderedTileMode = null;
  clampCamera();
  return true;
}

function clearSelectedDriver() {
  selectedDriverId = null;
  renderDetail(null);
  updateZoomHint();
  applyCamera();
}

function positionDetailPopup() {
  const selectedDriver = getSelectedDriver();
  if (!selectedDriver || selectors.detail.hidden || !currentBounds || !selectors.canvas) {
    return;
  }

  const viewport = selectors.canvas.getBoundingClientRect();
  const point = worldToScreen(getDriverMapPoint(selectedDriver));
  const gap = 16;
  const edge = 12;
  const popupWidth = selectors.detail.offsetWidth || 280;
  const popupHeight = selectors.detail.offsetHeight || 220;
  const left = Math.max(edge, point.x - popupWidth - gap);
  const top = Math.max(edge, Math.min(viewport.height - popupHeight - edge, point.y - popupHeight / 2));

  selectors.detail.style.left = `${left}px`;
  selectors.detail.style.top = `${top}px`;
}

function hasActiveDriverMotion() {
  const now = performance.now();
  return Array.from(driverMotion.values()).some((motion) => now - motion.startedAt < motion.duration);
}

function startDriverAnimation() {
  if (animationFrame) {
    return;
  }

  const animate = () => {
    if (followSelectedDriver()) {
      renderTiles();
    }
    renderOverlay();
    if (hasActiveDriverMotion()) {
      animationFrame = requestAnimationFrame(animate);
      return;
    }

    animationFrame = null;
    renderOverlay();
  };

  animationFrame = requestAnimationFrame(animate);
}

function renderTiles() {
  const tileSource = getTileSource();
  if (!tileSource) {
    selectors.tiles.innerHTML = "";
    selectors.tiles.hidden = true;
    renderedTileMode = mapMode;
    return;
  }

  const viewport = selectors.canvas.getBoundingClientRect();
  if (!viewport.width || !viewport.height || !mapCamera.scale) {
    return;
  }

  const wantedZoom = Math.ceil(Math.log2((mapCamera.scale * currentWorldSize) / tileSource.tileSize));
  const tileZoom = Math.max(0, Math.min(tileSource.maxZoom, wantedZoom));
  const tileCount = 2 ** tileZoom;
  const tileWorldSize = currentWorldSize / tileCount;
  const visible = {
    left: Math.max(0, (-mapCamera.x / mapCamera.scale) - tileWorldSize),
    top: Math.max(0, (-mapCamera.y / mapCamera.scale) - tileWorldSize),
    right: Math.min(currentWorldSize, ((viewport.width - mapCamera.x) / mapCamera.scale) + tileWorldSize),
    bottom: Math.min(currentWorldSize, ((viewport.height - mapCamera.y) / mapCamera.scale) + tileWorldSize)
  };
  const startX = Math.max(0, Math.floor(visible.left / tileWorldSize));
  const startY = Math.max(0, Math.floor(visible.top / tileWorldSize));
  const endX = Math.min(tileCount - 1, Math.floor(visible.right / tileWorldSize));
  const endY = Math.min(tileCount - 1, Math.floor(visible.bottom / tileWorldSize));
  const tileModeKey = [
    mapMode,
    tileZoom,
    startX,
    startY,
    endX,
    endY,
    Math.round(mapCamera.x),
    Math.round(mapCamera.y),
    mapCamera.scale.toFixed(4)
  ].join(":");
  if (renderedTileMode === tileModeKey) {
    selectors.tiles.hidden = false;
    return;
  }

  const tiles = [];
  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const screenX = mapCamera.x + x * tileWorldSize * mapCamera.scale;
      const screenY = mapCamera.y + y * tileWorldSize * mapCamera.scale;
      const screenSize = tileWorldSize * mapCamera.scale;
      tiles.push(`
        <img
          src="${tileSource.sourceUrl}/${tileZoom}/${x}/${y}.png"
          alt=""
          style="left:${screenX.toFixed(2)}px; top:${screenY.toFixed(2)}px; width:${screenSize.toFixed(2)}px; height:${screenSize.toFixed(2)}px;"
        />
      `);
    }
  }

  selectors.tiles.hidden = false;
  selectors.tiles.innerHTML = tiles.join("");
  renderedTileMode = tileModeKey;
}

function renderOverlay() {
  if (!selectors.svg || !currentBounds) {
    return;
  }

  const viewport = selectors.canvas.getBoundingClientRect();
  selectors.svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
  selectors.svg.style.width = `${viewport.width}px`;
  selectors.svg.style.height = `${viewport.height}px`;

  const cityStep = Math.max(1, Math.ceil(visibleCitiesCache.length / 130));
  const cityMarkup = visibleCitiesCache
    .filter((_, index) => index % cityStep === 0)
    .map((city) => {
      const point = worldToScreen(project(city, currentBounds));
      return `<circle class="map-city" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="2"><title>${escapeHtml(city.name)}</title></circle>`;
    }).join("");

  const routeMarkup = visibleDriversCache.map((driver) => {
    const fromCity = getCityCoordinate(driver.jobStops?.sourceCity, getModeGame());
    const toCity = getCityCoordinate(driver.jobStops?.destinationCity, getModeGame());
    if (!fromCity || !toCity) {
      return "";
    }
    const from = worldToScreen(project(fromCity, currentBounds));
    const to = worldToScreen(project(toCity, currentBounds));
    return `<line class="map-route" x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}"></line>`;
  }).join("");

  const driverMarkup = visibleDriversCache.map((driver) => {
    const point = worldToScreen(getDriverMapPoint(driver));
    const driverKey = getDriverKey(driver);
    const active = driverKey === String(selectedDriverId) ? " active" : "";
    return `
      <g class="map-driver${active}" data-driver-id="${escapeHtml(driverKey)}" tabindex="0" role="button" aria-label="${escapeHtml(driver.name)}">
        <circle class="map-driver-pulse" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="16"></circle>
        <circle class="map-driver-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="7"></circle>
      </g>
    `;
  }).join("");

  selectors.svg.innerHTML = `
    ${currentBounds.tiled ? "" : `<rect class="map-water" x="0" y="0" width="${viewport.width}" height="${viewport.height}"></rect>`}
    ${cityMarkup}
    ${routeMarkup}
    ${driverMarkup}
  `;
  positionDetailPopup();
}

function routeCity(driver, key) {
  const city = driver.jobStops?.[`${key}City`];
  const company = driver.jobStops?.[`${key}Company`];
  if (city && company) {
    return `${city} (${company})`;
  }
  return city || company || null;
}

function renderDetail(driver) {
  if (!driver) {
    selectors.detail.hidden = true;
    selectors.detail.innerHTML = "";
    selectors.detail.removeAttribute("style");
    return;
  }

  selectors.detail.hidden = false;
  selectors.detail.innerHTML = `
    <div class="livemap-popup-head">
      <div>
        <h3><i class="fa-solid fa-location-crosshairs"></i> ${escapeHtml(driver.name)}</h3>
        <div class="online-driver-meta">${escapeHtml(driver.status)} - ${escapeHtml(driver.game || "Unknown game")}</div>
      </div>
      <button class="livemap-popup-close" type="button" data-detail-close title="Unselect driver" aria-label="Unselect driver">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div class="online-driver-stats livemap-detail-stats">
      <div class="online-driver-stat"><span>Speed</span><strong>${escapeHtml(formatSpeed(driver.speed))}</strong></div>
      <div class="online-driver-stat"><span>Truck</span><strong>${escapeHtml(driver.truck)}</strong></div>
      <div class="online-driver-stat"><span>Location</span><strong>${escapeHtml(driver.city)}</strong></div>
      <div class="online-driver-stat"><span>Cargo</span><strong>${escapeHtml(driver.cargo)}</strong></div>
      <div class="online-driver-stat"><span>Route</span><strong>${escapeHtml(driver.route)}</strong></div>
      <div class="online-driver-stat"><span>Distance</span><strong>${escapeHtml(driver.distance)}</strong></div>
      <div class="online-driver-stat"><span>From</span><strong>${escapeHtml(routeCity(driver, "source"))}</strong></div>
      <div class="online-driver-stat"><span>To</span><strong>${escapeHtml(routeCity(driver, "destination"))}</strong></div>
      <div class="online-driver-stat"><span>Damage</span><strong>${escapeHtml(driver.damage)}</strong></div>
    </div>
    <div class="help-text">Updated ${escapeHtml(formatDate(driver.updatedAt))}</div>
  `;
  positionDetailPopup();
}

function renderMap() {
  const visibleCities = getVisibleCities();
  const visibleDrivers = getVisibleDrivers();
  const points = [
    ...visibleCities.map((city) => ({ x: city.x, z: city.z })),
    ...visibleDrivers.map((driver) => driver.mapPosition)
  ];
  const bounds = getBounds(points);
  const previousWorldSize = currentWorldSize;
  currentBounds = bounds;
  currentWorldSize = bounds.worldSize || 4096;
  visibleCitiesCache = visibleCities;
  visibleDriversCache = visibleDrivers;
  updateDriverMotionTargets(visibleDrivers, bounds);
  if (selectedDriverId && !getSelectedDriver()) {
    selectedDriverId = null;
  }
  if (previousWorldSize !== currentWorldSize) {
    renderedTileMode = null;
    resetCamera();
  }

  selectors.empty.hidden = visibleDrivers.length > 0;
  selectors.count.textContent = visibleDrivers.length;
  if (selectors.subtitle) {
    selectors.subtitle.textContent = visibleDrivers.length
      ? "Live dots refresh every 0.5 seconds on high-resolution map tiles."
      : "No shared live coordinates found. Configure LIVE_PUSH_URL and LIVE_DRIVERS_URL so drivers can appear for everyone.";
  }
  if (visibleDrivers.length) {
    updateZoomHint();
  }
  renderDetail(getSelectedDriver());
  applyCamera();
  startDriverAnimation();
}

function updateZoomHint() {
  if (!selectors.subtitle || !getTileSource()) {
    return;
  }

  selectors.subtitle.textContent = selectedDriverId
    ? "Following selected driver. Close the popup or click the dot again to stop following."
    : "High-resolution tiles stay sharp up to their native zoom level.";
}

async function refreshLiveMap() {
  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;
  try {
    const response = await window.jastuk.fetchLiveDrivers();
    if (!response.success) {
      drivers = [];
      if (selectors.subtitle) {
        selectors.subtitle.textContent = getFriendlyLiveMapError(response.error);
      }
      selectors.updated.textContent = new Date().toLocaleString();
      renderMap();
      return;
    }

    drivers = Array.isArray(response.drivers) ? response.drivers : [];
    selectors.updated.textContent = drivers[0]?.updatedAt ? formatDate(drivers[0].updatedAt) : new Date().toLocaleString();
    renderMap();
  } finally {
    refreshInFlight = false;
  }
}

async function initialize() {
  await window.jastukLayout.ready;
  initializeSelectors();
  const cityResponse = await window.jastuk.loadCities();
  cities = Array.isArray(cityResponse.cities) ? cityResponse.cities : [];
  resetCamera();

  selectors.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      mapMode = button.dataset.mapMode;
      selectors.modeButtons.forEach((item) => item.classList.toggle("active", item === button));
      selectedDriverId = null;
      resetCamera();
      renderMap();
    });
  });

  selectors.controls.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.mapAction;
      if (action === "zoom-in") {
        zoomFromCenter(1.25);
      } else if (action === "zoom-out") {
        zoomFromCenter(0.8);
      } else {
        resetCamera();
      }
    });
  });

  selectors.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomMap(mapCamera.scale * (event.deltaY < 0 ? 1.12 : 0.88), event.clientX, event.clientY);
  }, { passive: false });

  selectors.canvas.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".map-driver") || event.target.closest(".livemap-popup")) {
      return;
    }

    selectors.canvas.setPointerCapture(event.pointerId);
    selectors.canvas.classList.add("dragging");
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cameraX: mapCamera.x,
      cameraY: mapCamera.y
    };
  });

  selectors.canvas.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    mapCamera.x = dragState.cameraX + event.clientX - dragState.startX;
    mapCamera.y = dragState.cameraY + event.clientY - dragState.startY;
    applyCamera();
  });

  selectors.canvas.addEventListener("pointerup", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragState = null;
    selectors.canvas.classList.remove("dragging");
  });

  selectors.canvas.addEventListener("pointercancel", () => {
    dragState = null;
    selectors.canvas.classList.remove("dragging");
  });

  selectors.svg.addEventListener("click", (event) => {
    const target = event.target.closest(".map-driver");
    if (!target) {
      return;
    }

    if (selectedDriverId === target.dataset.driverId) {
      clearSelectedDriver();
      return;
    }

    selectedDriverId = target.dataset.driverId;
    zoomToSelectedDriver();
    renderDetail(getSelectedDriver());
    updateZoomHint();
    applyCamera();
  });

  selectors.detail.addEventListener("click", (event) => {
    if (!event.target.closest("[data-detail-close]")) {
      return;
    }

    clearSelectedDriver();
  });

  await refreshLiveMap();
  refreshTimer = setInterval(refreshLiveMap, 1500);
}

window.addEventListener("beforeunload", () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }
});

window.addEventListener("resize", () => {
  resetCamera();
});

document.addEventListener("DOMContentLoaded", initialize);
