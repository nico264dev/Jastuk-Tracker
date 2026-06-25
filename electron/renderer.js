let selectors = {};
let tabs = [];
let panels = [];
let currentSnapshot = null;
let discordAuthorized = false;
let currentUserIsAdmin = false;
let localUsers = [];
let storedJobs = [];
let jobDeliveries = [];
let members = [];
let liveMembers = [];
let membersPage = 1;
let hubPersonalDriver = null;
let cityList = [];
let routePreferences = null;
let snapshotRefreshTimer = null;
let snapshotRefreshInFlight = false;
let removeUpdaterStatusListener = null;
let removeDiscordPresenceStatusListener = null;
let loginInFlight = false;
const ROUTE_PREFERENCES_KEY = "jastuk-route-preferences";
const DEFAULT_ROUTE_PREFERENCES = {
  game: "eut2",
  dlc: ["ets2-base", "ats-base"]
};
const ROUTE_DLC_OPTIONS = [
  {
    id: "ets2-base",
    game: "eut2",
    label: "ETS2 base map",
    countries: ["austria", "belgium", "czech", "france", "germany", "italy", "luxembourg", "netherlands", "poland", "slovakia", "switzerland", "uk"]
  },
  {
    id: "ets2-going-east",
    game: "eut2",
    label: "Going East",
    countries: ["hungary", "poland", "slovakia", "czech"]
  },
  {
    id: "ets2-scandinavia",
    game: "eut2",
    label: "Scandinavia",
    countries: ["denmark", "norway", "sweden"]
  },
  {
    id: "ets2-france",
    game: "eut2",
    label: "Vive la France",
    countries: ["france"]
  },
  {
    id: "ets2-italia",
    game: "eut2",
    label: "Italia",
    countries: ["italy"]
  },
  {
    id: "ets2-baltic",
    game: "eut2",
    label: "Beyond the Baltic Sea",
    countries: ["estonia", "finland", "latvia", "lithuania", "russia"]
  },
  {
    id: "ets2-black-sea",
    game: "eut2",
    label: "Road to the Black Sea",
    countries: ["bulgaria", "romania", "turkey"]
  },
  {
    id: "ets2-iberia",
    game: "eut2",
    label: "Iberia",
    countries: ["spain", "portugal", "andorra"]
  },
  {
    id: "ets2-west-balkans",
    game: "eut2",
    label: "West Balkans",
    countries: ["albania", "bosnia", "croatia", "kosovo", "montenegro", "north_macedonia", "serbia", "slovenia"]
  },
  {
    id: "ets2-expanded",
    game: "eut2",
    label: "Expanded map towns",
    countries: ["faroe", "iceland", "iom", "liecht", "moldova", "ukraine"]
  },
  {
    id: "ats-base",
    game: "ats",
    label: "ATS base map",
    countries: ["california", "nevada", "arizona"]
  },
  {
    id: "ats-pacific",
    game: "ats",
    label: "Pacific Northwest",
    countries: ["oregon", "washington", "idaho", "montana", "wyoming"]
  },
  {
    id: "ats-southwest",
    game: "ats",
    label: "Southwest",
    countries: ["new_mexico", "colorado", "utah"]
  },
  {
    id: "ats-texas",
    game: "ats",
    label: "Texas and Oklahoma",
    countries: ["texas", "oklahoma"]
  },
  {
    id: "ats-midwest",
    game: "ats",
    label: "Midwest",
    countries: ["kansas", "nebraska", "arkansas", "missouri", "iowa"]
  }
];
const DEFAULT_OVERLAY_FIELDS = [
  "logo",
  "driver",
  "speed",
  "rpm",
  "gear",
  "truck",
  "route",
  "fuel",
  "damage",
  "odometer",
  "speedLimit",
  "cruise"
];
const DEFAULT_ADMIN_DISCORD_IDS = [
  "1496983353037951167",
  "1496920531721650428",
  "1496983823953428520"
];
const MEMBERS_PAGE_SIZE = 25;
let adminDiscordIds = new Set(DEFAULT_ADMIN_DISCORD_IDS);
const OVERLAY_FIELD_OPTIONS = [
  { id: "logo", label: "Center logo", icon: "fa-image" },
  { id: "driver", label: "Driver status", icon: "fa-id-badge" },
  { id: "speed", label: "Speed", icon: "fa-gauge-high" },
  { id: "rpm", label: "RPM", icon: "fa-rotate-right" },
  { id: "gear", label: "Gear", icon: "fa-gears" },
  { id: "truck", label: "Truck", icon: "fa-truck" },
  { id: "route", label: "Route", icon: "fa-route" },
  { id: "fuel", label: "Fuel", icon: "fa-gas-pump" },
  { id: "damage", label: "Damage", icon: "fa-screwdriver-wrench" },
  { id: "odometer", label: "Odometer", icon: "fa-road" },
  { id: "speedLimit", label: "Speed limit", icon: "fa-signs-post" },
  { id: "cruise", label: "Cruise", icon: "fa-gauge" },
  { id: "systems", label: "Systems", icon: "fa-power-off" },
  { id: "lights", label: "Lights", icon: "fa-lightbulb" },
  { id: "warnings", label: "Warnings", icon: "fa-triangle-exclamation" },
  { id: "temps", label: "Temperatures", icon: "fa-temperature-half" },
  { id: "pressure", label: "Pressure", icon: "fa-car-battery" }
];

function initializeSelectors() {
  selectors = {
    jobGame: document.getElementById("job-game"),
    jobCargo: document.getElementById("job-cargo"),
    jobRoute: document.getElementById("job-route"),
    jobDistance: document.getElementById("job-distance"),
    jobIncome: document.getElementById("job-income"),
    jobDamage: document.getElementById("job-damage"),
    summaryEvents: document.getElementById("summary-events"),
    summaryLastEvent: document.getElementById("summary-last-event"),
    summaryUpdated: document.getElementById("summary-updated"),
    summarySession: document.getElementById("summary-session"),
    eventList: document.getElementById("event-list"),
    historyList: document.getElementById("history-list"),
    rawJson: document.getElementById("raw-json"),
    pageSubtitle: document.getElementById("page-subtitle"),
    apiUrlLabel: document.getElementById("sidebar-api-url"),
    saveConfigButton: document.getElementById("save-config-button"),
    openDiscordButton: document.getElementById("open-discord-button"),
    loginDiscordButton: document.getElementById("login-discord-button"),
    loginPageButton: document.getElementById("login-page-button"),
    loginStatusMessage: document.getElementById("login-status-message"),
    goToAccountButton: document.getElementById("go-to-account-button"),
    discordUser: document.getElementById("discord-user"),
    discordStatus: document.getElementById("discord-status"),
    clientIdInput: document.getElementById("discord-client-id"),
    clientSecretInput: document.getElementById("discord-client-secret"),
    guildIdInput: document.getElementById("discord-guild-id"),
    requiredRoleIdInput: document.getElementById("discord-required-role-id"),
    driverSteamIdInput: document.getElementById("driver-steam-id"),
    hubJobs: document.getElementById("hub-stats-jobs"),
    hubDistance: document.getElementById("hub-stats-distance"),
    hubEarnings: document.getElementById("hub-stats-earnings"),
    hubFuel: document.getElementById("hub-stats-fuel"),
    personalJobs: document.getElementById("personal-stats-jobs"),
    personalDistance: document.getElementById("personal-stats-distance"),
    personalEarnings: document.getElementById("personal-stats-earnings"),
    personalDamage: document.getElementById("personal-stats-damage"),
    recentJobsTable: document.getElementById("recent-jobs-table"),
    membersTable: document.getElementById("members-table"),
    membersSummary: document.getElementById("members-summary"),
    membersRefreshButton: document.getElementById("members-refresh-button"),
    membersPrevPageButton: document.getElementById("members-prev-page"),
    membersNextPageButton: document.getElementById("members-next-page"),
    membersPageStatus: document.getElementById("members-page-status"),
    adminDeliveriesTable: document.getElementById("admin-deliveries-table"),
    adminDeliverySummary: document.getElementById("admin-delivery-summary"),
    adminRefreshDeliveriesButton: document.getElementById("admin-refresh-deliveries"),
    localUsersStatus: document.getElementById("local-users-status"),
    localUsersList: document.getElementById("local-users-list"),
    updateStatus: document.getElementById("update-status"),
    updateVersion: document.getElementById("update-version"),
    discordPresenceStatus: document.getElementById("discord-presence-status"),
    discordPresenceClient: document.getElementById("discord-presence-client"),
    testRichPresenceButton: document.getElementById("test-rich-presence-button"),
    showRichPresenceLogButton: document.getElementById("show-rich-presence-log-button"),
    discordPresenceLog: document.getElementById("discord-presence-log"),
    checkUpdatesButton: document.getElementById("check-updates-button"),
    downloadUpdateButton: document.getElementById("download-update-button"),
    installUpdateButton: document.getElementById("install-update-button"),
    overlayEnabledInput: document.getElementById("overlay-enabled"),
    overlayRequireGameFocusInput: document.getElementById("overlay-require-game-focus"),
    overlayPositionInput: document.getElementById("overlay-position"),
    overlayOpacityInput: document.getElementById("overlay-opacity"),
    overlayFieldGrid: document.getElementById("overlay-field-grid"),
    overlayResetFieldsButton: document.getElementById("overlay-reset-fields"),
    routeGameSelect: document.getElementById("route-game-select"),
    routeRandomButton: document.getElementById("route-random-button"),
    routeFromCity: document.getElementById("route-from-city"),
    routeFromMeta: document.getElementById("route-from-meta"),
    routeToCity: document.getElementById("route-to-city"),
    routeToMeta: document.getElementById("route-to-meta"),
    routeDistance: document.getElementById("route-distance"),
    routeDlcSummary: document.getElementById("route-dlc-summary"),
    routeDefaultGame: document.getElementById("route-default-game"),
    routeDlcGrid: document.getElementById("route-dlc-grid"),
    steamIdPrompt: document.getElementById("steam-id-prompt"),
    steamIdPromptInput: document.getElementById("steam-id-prompt-input"),
    steamIdPromptError: document.getElementById("steam-id-prompt-error"),
    steamIdPromptSave: document.getElementById("steam-id-prompt-save"),
    steamIdPromptLater: document.getElementById("steam-id-prompt-later")
  };
  tabs = Array.from(document.querySelectorAll(".nav-item[data-tab]"));
  panels = Array.from(document.querySelectorAll(".panel"));
}

function updateAccessControls() {
  tabs.forEach((button) => {
    if (button.dataset.tab === "admin") {
      button.hidden = !currentUserIsAdmin;
      button.disabled = !currentUserIsAdmin;
      button.classList.toggle("disabled", !currentUserIsAdmin);
      return;
    }

    if (button.dataset.tab !== "account") {
      button.disabled = !discordAuthorized;
      button.classList.toggle("disabled", !discordAuthorized);
    }
  });

  const adminPanel = document.getElementById("admin-tab");
  if (adminPanel) {
    adminPanel.hidden = !currentUserIsAdmin;
  }
}

function setActiveTab(tabName) {
  const hasSavedUser = localUsers.some((user) => user.enabled !== false);
  if (!discordAuthorized && hasSavedUser) {
    const activeUser = localUsers.find((user) => user.enabled !== false);
    setDiscordStatus(activeUser, "Authorized from saved local profile", true);
  }

  if (!discordAuthorized && tabName !== "account" && tabName !== "login-page") {
    tabName = "login-page";
  }

  if (tabName === "admin" && !currentUserIsAdmin) {
    tabName = discordAuthorized ? "dashboard" : "login-page";
  }

  tabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });

  panels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${tabName}-tab`);
  });
}

async function unlockFromSavedUser() {
  try {
    const enabledUsers = await getEnabledLocalUsers();
    const activeUser = enabledUsers[0] || null;
    if (!activeUser) {
      return false;
    }

    setDiscordStatus(activeUser, "Authorized from saved local profile", true);
    refreshDashboardData().catch(() => {});
    return true;
  } catch (error) {
    setText(selectors.loginStatusMessage, `Saved login check failed: ${error.message}`);
    return false;
  }
}

async function openAuthorizedTab(tabName) {
  if (!discordAuthorized) {
    await unlockFromSavedUser();
  }

  setActiveTab(tabName);
}

function getRequestedTab() {
  const requested = window.location.hash.replace(/^#/, "");
  return panels.some((panel) => panel.id === `${requested}-tab`) ? requested : null;
}

function formatValue(value) {
  return value === undefined || value === null || value === "" ? "-" : value;
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function setHtml(element, value) {
  if (element) {
    element.innerHTML = value;
  }
}

function setInputValue(element, value) {
  if (element) {
    element.value = value || "";
  }
}

function parseOverlayFields(value) {
  const rawFields = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((field) => field.trim());
  const fields = rawFields.filter((field) => OVERLAY_FIELD_OPTIONS.some((option) => option.id === field));

  return fields.length ? fields : DEFAULT_OVERLAY_FIELDS;
}

function getUserOverlaySettings(config, user) {
  const userSettings = user?.overlaySettings || {};
  return {
    enabled: userSettings.enabled ?? String(config.values.OVERLAY_ENABLED ?? "true").toLowerCase() !== "false",
    requireGameFocus: userSettings.requireGameFocus ?? String(config.values.OVERLAY_REQUIRE_GAME_FOCUS ?? "false").toLowerCase() === "true",
    position: userSettings.position || config.values.OVERLAY_POSITION || "top",
    opacity: userSettings.opacity ?? config.values.OVERLAY_OPACITY ?? "0.72",
    fields: parseOverlayFields(userSettings.fields ?? config.values.OVERLAY_FIELDS)
  };
}

function renderOverlayFieldOptions(selectedFields = DEFAULT_OVERLAY_FIELDS) {
  const selected = new Set(selectedFields);
  selectors.overlayFieldGrid.innerHTML = OVERLAY_FIELD_OPTIONS.map((option) => `
    <label class="overlay-field-option" for="overlay-field-${escapeHtml(option.id)}">
      <input id="overlay-field-${escapeHtml(option.id)}" type="checkbox" value="${escapeHtml(option.id)}" ${selected.has(option.id) ? "checked" : ""} />
      <span class="overlay-field-icon"><i class="fa-solid ${escapeHtml(option.icon)}"></i></span>
      <span>${escapeHtml(option.label)}</span>
    </label>
  `).join("");
}

function getSelectedOverlayFields() {
  const fields = Array.from(selectors.overlayFieldGrid.querySelectorAll("input[type='checkbox']:checked"))
    .map((input) => input.value);
  return fields.length ? fields : ["driver", "speed"];
}

function normalizeRouteKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeRouteGame(value) {
  const game = String(value || "").toLowerCase();
  return ["ats", "amtrucks"].includes(game) ? "ats" : "eut2";
}

function getRouteOption(optionId) {
  return ROUTE_DLC_OPTIONS.find((option) => option.id === optionId) || null;
}

function loadRoutePreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(ROUTE_PREFERENCES_KEY) || "{}");
    return {
      game: normalizeRouteGame(saved.game || DEFAULT_ROUTE_PREFERENCES.game),
      dlc: Array.isArray(saved.dlc) && saved.dlc.length ? saved.dlc : DEFAULT_ROUTE_PREFERENCES.dlc
    };
  } catch (error) {
    return { ...DEFAULT_ROUTE_PREFERENCES };
  }
}

function saveRoutePreferences(preferences) {
  routePreferences = {
    game: normalizeRouteGame(preferences.game),
    dlc: Array.isArray(preferences.dlc) && preferences.dlc.length ? preferences.dlc : DEFAULT_ROUTE_PREFERENCES.dlc
  };
  localStorage.setItem(ROUTE_PREFERENCES_KEY, JSON.stringify(routePreferences));
}

function getSelectedRouteDlc() {
  const checked = Array.from(selectors.routeDlcGrid.querySelectorAll("input[type='checkbox']:checked"))
    .map((input) => input.value);
  return checked.length ? checked : DEFAULT_ROUTE_PREFERENCES.dlc;
}

function renderRouteDlcOptions(preferences = DEFAULT_ROUTE_PREFERENCES) {
  const selected = new Set(preferences.dlc);
  selectors.routeDlcGrid.innerHTML = ROUTE_DLC_OPTIONS.map((option) => `
    <label class="route-dlc-option" for="route-dlc-${escapeHtml(option.id)}">
      <input id="route-dlc-${escapeHtml(option.id)}" type="checkbox" value="${escapeHtml(option.id)}" ${selected.has(option.id) ? "checked" : ""} />
      <span>
        <strong>${escapeHtml(option.label)}</strong>
        <small>${option.game === "ats" ? "ATS" : "ETS2"}</small>
      </span>
    </label>
  `).join("");
}

function getCityCountry(city) {
  return normalizeRouteKey(city.country || city.state || city.region);
}

function getAvailableRouteCities(game = routePreferences?.game || DEFAULT_ROUTE_PREFERENCES.game) {
  const targetGame = normalizeRouteGame(game);
  const selectedOptions = (routePreferences?.dlc || DEFAULT_ROUTE_PREFERENCES.dlc)
    .map(getRouteOption)
    .filter((option) => option && option.game === targetGame);
  const allowedCountries = new Set(selectedOptions.flatMap((option) => option.countries.map(normalizeRouteKey)));

  const gameCities = cityList
    .filter((city) => normalizeRouteGame(city.game || city.game_id) === targetGame)
    .filter((city) => city.name && Number.isFinite(Number(city.x)) && Number.isFinite(Number(city.z)));
  const filteredCities = gameCities
    .filter((city) => {
      const country = getCityCountry(city);
      return !allowedCountries.size || allowedCountries.has(country);
    });

  return filteredCities.length >= 2 ? filteredCities : gameCities;
}

function estimateRouteDistance(fromCity, toCity) {
  const deltaX = Number(fromCity.x) - Number(toCity.x);
  const deltaZ = Number(fromCity.z) - Number(toCity.z);
  return Math.max(1, Math.round(Math.hypot(deltaX, deltaZ) / 20));
}

function formatCityMeta(city) {
  return [city.country, city.game === "ats" ? "ATS" : "ETS2"].filter(Boolean).join(" - ");
}

function pickRandomRoute(game = routePreferences?.game || DEFAULT_ROUTE_PREFERENCES.game) {
  const cities = getAvailableRouteCities(game);
  if (cities.length < 2) {
    setText(selectors.routeFromCity, "-");
    setText(selectors.routeFromMeta, "Not enough cities selected");
    setText(selectors.routeToCity, "-");
    setText(selectors.routeToMeta, "Add more DLC in Account settings");
    setText(selectors.routeDistance, "Estimated distance: -");
    setText(selectors.routeDlcSummary, `Available cities: ${cities.length}`);
    return;
  }

  const fromCity = cities[Math.floor(Math.random() * cities.length)];
  let toCity = cities[Math.floor(Math.random() * cities.length)];
  while (toCity.id === fromCity.id && cities.length > 1) {
    toCity = cities[Math.floor(Math.random() * cities.length)];
  }

  setText(selectors.routeFromCity, fromCity.name);
  setText(selectors.routeFromMeta, formatCityMeta(fromCity));
  setText(selectors.routeToCity, toCity.name);
  setText(selectors.routeToMeta, formatCityMeta(toCity));
  setText(selectors.routeDistance, `Estimated distance: ${formatDistance(estimateRouteDistance(fromCity, toCity))}`);
  setText(selectors.routeDlcSummary, `Available cities: ${cities.length}`);
}

async function loadRouteData() {
  const response = await window.jastuk.loadCities();
  cityList = Array.isArray(response.cities) ? response.cities : [];
  routePreferences = loadRoutePreferences();
  if (selectors.routeGameSelect) {
    selectors.routeGameSelect.value = routePreferences.game;
  }
  if (selectors.routeDefaultGame) {
    selectors.routeDefaultGame.value = routePreferences.game;
  }
  if (selectors.routeDlcGrid) {
    renderRouteDlcOptions(routePreferences);
  }
  pickRandomRoute(routePreferences.game);
}

function formatNumber(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${formatNumber(numeric)} €` : `${value} €`;
}

function formatDamage(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value).includes("%") ? String(value) : `${value}%`;
  }

  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return `${Math.round(percent)}%`;
}

function formatDistance(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  const text = String(value);
  if (text.toLowerCase().includes("km")) {
    return text;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${formatNumber(numeric)} KM` : `${text} KM`;
}

function numericValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function optionalNumericValue(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function damagePercentValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return numeric <= 1 ? numeric * 100 : numeric;
}

function getJobDamageValue(job) {
  return firstValue(
    job.damage,
    job.cargo?.damage,
    job.cargo_damage,
    job.cargoDamage,
    job.cargoDamagePercent,
    job.cargo_damage_percent,
    job.damage_percent,
    job.damagePercent,
    job.damagePercentage,
    job.damage_percentage,
    job.cargo?.damage_percent,
    job.cargo?.damagePercent,
    job.cargo?.damagePercentage,
    job.cargo?.damage_percentage
  );
}

function escapeHtml(value) {
  return String(formatValue(value))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function textFromValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(textFromValue).filter(Boolean).join(", ") || null;
  }

  return firstValue(
    value.display_name,
    value.displayName,
    value.game_name,
    value.gameName,
    value.name,
    value.city,
    value.cityName,
    value.country,
    value.value,
    value.label,
    value.title,
    value.id
  ) || null;
}

function isTruthyFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return ["true", "1", "yes", "loaded", "active"].includes(String(value || "").toLowerCase());
}

function isActiveCurrentJob(job) {
  if (!job || typeof job !== "object") {
    return false;
  }

  const state = String(firstValue(job.event, job.type, job.status, job.state) || "").toLowerCase();
  if (state.includes("finish") || state.includes("complete") || state.includes("deliver") || state.includes("cancel")) {
    return false;
  }

  const loadedFlag = firstValue(job.cargo_loaded, job.cargoLoaded, job.loaded, job.active);
  if (loadedFlag !== undefined) {
    return isTruthyFlag(loadedFlag);
  }

  const cargo = textFromValue(firstValue(job.cargo, job.cargoName, job.cargo_name, job.description, job.title));
  const hasStarted = Boolean(firstValue(job.started_at_utc, job.started_at, job.start_time, job.startTime));
  return Boolean(cargo && (hasStarted || state.includes("start") || state.includes("active")));
}

function getEntryTime(entry) {
  return entry.timestamp || entry.time || entry.completed_at || entry.finished_at || entry.finished_at_utc || entry.created_at || entry.started_at_utc || entry.date || entry.storedAt || "unknown time";
}

function renderCompactTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    return `<span class="recent-time-main">${escapeHtml(value || "-")}</span>`;
  }

  return `
    <span class="recent-time-main">${escapeHtml(date.toLocaleDateString("en-US", { month: "short", day: "numeric" }))}</span>
    <span class="recent-time-sub">${escapeHtml(date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }))}</span>
  `;
}

function getEntryRoute(entry) {
  const sourceStop = getRouteStop(
    firstValue(entry.source?.city, entry.source_city, entry.sourceCity, entry.from, entry.origin, entry.start),
    firstValue(entry.source?.company, entry.source_company, entry.sourceCompany, entry.originCompany)
  );
  const destinationStop = getRouteStop(
    firstValue(entry.destination?.city, entry.destination_city, entry.destinationCity, entry.to, entry.target, entry.end),
    firstValue(entry.destination?.company, entry.destination_company, entry.destinationCompany, entry.targetCompany)
  );

  if (sourceStop || destinationStop) {
    return `${sourceStop || "?"} -> ${destinationStop || "?"}`;
  }

  return textFromValue(entry.route) || "-";
}

function getRouteStop(city, company) {
  const cityText = textFromValue(city);
  const companyText = textFromValue(company);

  if (cityText && companyText) {
    return `${cityText} (${companyText})`;
  }

  return cityText || companyText || null;
}

function getEntryGame(entry) {
  return textFromValue(firstValue(entry.game, entry.gameName, entry.game_name, entry.game_id));
}

function getActiveDriver() {
  return localUsers.find((user) => user.enabled !== false) || null;
}

function hasSteamIdentity(user) {
  return Boolean(firstValue(user?.steamid, user?.steamId, user?.steamID));
}

function hasDiscordIdentity(user) {
  return Boolean(firstValue(user?.id, user?.discordId, user?.discord_id));
}

function getDiscordAvatarUrl(user) {
  if (!user?.avatar || !user?.id) {
    return "../public/img/logo.png";
  }

  const extension = String(user.avatar).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.${extension}?size=64`;
}

function getEntryDriver(entry) {
  const activeDriver = getActiveDriver();
  const name = firstValue(
    entry.driverName,
    entry.driver_name,
    entry.driver?.displayName,
    entry.driver?.username,
    activeDriver?.displayName,
    activeDriver?.username,
    activeDriver?.id,
    "Local Driver"
  );

  return {
    name,
    avatar: firstValue(entry.driverAvatar, entry.driver_avatar, entry.driver?.avatarUrl, getDiscordAvatarUrl(activeDriver))
  };
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function getDriverUsers(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.users)) {
    return payload.users;
  }

  if (Array.isArray(payload?.drivers)) {
    return payload.drivers;
  }

  return [];
}

function getLiveDrivers(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.drivers)) {
    return payload.drivers;
  }

  if (Array.isArray(payload?.users)) {
    return payload.users;
  }

  return [];
}

function findHubDriver(users) {
  const activeDriver = getActiveDriver();
  const candidates = [
    activeDriver?.displayName,
    activeDriver?.username,
    activeDriver?.steamName,
    activeDriver?.steamname,
    activeDriver?.name,
    activeDriver?.id
  ].map(normalizeName).filter(Boolean);

  if (!candidates.length) {
    return users[0] || null;
  }

  return users.find((user) => {
    const names = [
      user.id,
      user.discordId,
      user.discord_id,
      user.name,
      user.username,
      user.discordUsername,
      user.displayName,
      user.steamName,
      user.steamname
    ].map(normalizeName);

    return candidates.some((candidate) => names.includes(candidate));
  }) || users[0] || null;
}

function getHubJobs(driver) {
  return Array.isArray(driver?.jobs) ? driver.jobs : [];
}

function getHubPersonalJobs(driver) {
  const jobs = getHubJobs(driver);
  return optionalNumericValue(driver?.totalJobs, driver?.total_jobs, driver?.jobsCount, driver?.jobs_count) ?? jobs.length;
}

function getHubPersonalDistance(driver) {
  const jobs = getHubJobs(driver);
  return optionalNumericValue(driver?.distance, driver?.totalDistance, driver?.total_distance, driver?.distanceKm, driver?.distance_km)
    ?? jobs.reduce((total, job) => total + numericValue(firstValue(job.distance, job.distance_km, job.distanceKm, job.km)), 0);
}

function getHubPersonalEarnings(driver) {
  const jobs = getHubJobs(driver);
  return optionalNumericValue(driver?.earnings, driver?.totalEarnings, driver?.total_earnings, driver?.income, driver?.revenue)
    ?? jobs.reduce((total, job) => total + numericValue(firstValue(job.income, job.revenue, job.earnings, job.money)), 0);
}

function renderDriverCell(entry) {
  const driver = getEntryDriver(entry);
  return `
    <div class="recent-driver">
      <img class="recent-driver-avatar" src="${escapeHtml(driver.avatar)}" alt="" onerror="this.src='../public/img/logo.png'" />
      <span>${escapeHtml(driver.name)}</span>
    </div>
  `;
}

async function ensureLocalUsersLoaded() {
  if (localUsers.length) {
    return;
  }

  const response = await window.jastuk.loadUsers();
  localUsers = Array.isArray(response.users) ? response.users : [];
}

function isCompletedJob(entry) {
  const type = String(firstValue(entry.type, entry.status, entry.event) || "").toLowerCase();
  return type.includes("complete") || type.includes("deliver") || type.includes("finish") || type.includes("job");
}

function renderRecentJobs(snapshot) {
  const jobs = Array.isArray(snapshot?.jobs) ? snapshot.jobs : [];
  const completedJobs = jobs.filter(isCompletedJob);
  const source = completedJobs.length ? completedJobs : jobs;
  const recentJobs = source.slice(-20).reverse();

  selectors.recentJobsTable.innerHTML = recentJobs.length
    ? recentJobs.map((entry) => `
      <tr>
        <td class="recent-time">${renderCompactTime(getEntryTime(entry))}</td>
        <td>${renderDriverCell(entry)}</td>
        <td>${escapeHtml(getEntryGame(entry))}</td>
        <td>${escapeHtml(textFromValue(firstValue(entry.cargo, entry.cargoName, entry.cargo_name, entry.description, entry.title)))}</td>
        <td>${escapeHtml(getEntryRoute(entry))}</td>
        <td>${escapeHtml(formatDistance(firstValue(entry.distance, entry.distance_km, entry.distanceKm, entry.planned_distance_km, entry.km)))}</td>
        <td>${escapeHtml(formatCurrency(firstValue(entry.income, entry.revenue, entry.earnings, entry.money)))}</td>
        <td>${escapeHtml(formatDamage(getJobDamageValue(entry)))}</td>
      </tr>
    `).join("")
    : "<tr><td colspan=\"8\">No completed jobs captured yet.</td></tr>";
}

function parseAdminIdList(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return source.map((entry) => String(entry).trim()).filter(Boolean);
}

function getAdminIdentityCandidates(user) {
  return [
    user.id,
    user.discordId,
    user.discord_id,
    user.userId,
    user.user_id,
    ...parseAdminIdList(user.roles)
  ].map(String).filter(Boolean);
}

function isAdminIdentity(user) {
  if (!user) {
    return false;
  }

  return getAdminIdentityCandidates(user).some((id) => adminDiscordIds.has(id));
}

function getJobKey(entry) {
  return String(firstValue(entry._trackerKey, entry.id, entry.job_id, entry.jobId, entry.uuid, ""));
}

function getDeliveryForJob(entry) {
  const key = getJobKey(entry);
  return jobDeliveries.find((delivery) => String(firstValue(delivery.jobKey, delivery.id, delivery.jobId)) === key) || null;
}

function renderDeliveryStatus(delivery) {
  const status = delivery?.status || "not queued";
  return `<span class="delivery-status delivery-status-${escapeHtml(String(status).replace(/\s+/g, "-"))}">${escapeHtml(status)}</span>`;
}

function getDeliveryMessage(delivery) {
  if (!delivery) {
    return "No delivery attempt has been logged yet.";
  }

  if (delivery.lastError) {
    return delivery.lastError;
  }

  if (delivery.status === "sent") {
    return `Sent${delivery.responseStatus ? ` (${delivery.responseStatus})` : ""}`;
  }

  return delivery.lastAttemptAt ? `Last attempt ${new Date(delivery.lastAttemptAt).toLocaleString()}` : "Waiting to send";
}

function getMemberName(member) {
  return textFromValue(firstValue(
    member.displayName,
    member.display_name,
    member.name,
    member.username,
    member.discordUsername,
    member.steamName,
    member.steamname,
    member.id
  ));
}

function getMemberId(member) {
  return String(firstValue(
    member.id,
    member.discordId,
    member.discord_id,
    member.userId,
    member.user_id,
    member.steamId,
    member.steamID,
    member.steamid,
    ""
  ));
}

function compareMemberIds(left, right) {
  const leftId = getMemberId(left);
  const rightId = getMemberId(right);
  const leftNumeric = /^\d+$/.test(leftId);
  const rightNumeric = /^\d+$/.test(rightId);

  if (leftNumeric && rightNumeric) {
    const leftBigInt = BigInt(leftId);
    const rightBigInt = BigInt(rightId);
    return leftBigInt < rightBigInt ? -1 : leftBigInt > rightBigInt ? 1 : 0;
  }

  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }

  return leftId.localeCompare(rightId, undefined, { numeric: true });
}

function getMemberAvatar(member) {
  const direct = firstValue(member.avatarUrl, member.avatar_url, member.image, member.photo);
  if (direct) {
    return direct;
  }

  if (member.avatar && member.id) {
    return getDiscordAvatarUrl(member);
  }

  return "../public/img/logo.png";
}

function getMemberIdentityCandidates(member) {
  return [
    member.id,
    member.discordId,
    member.discord_id,
    member.userId,
    member.user_id,
    member.steamId,
    member.steamID,
    member.steamid,
    member.name,
    member.username,
    member.displayName,
    member.display_name
  ].map(normalizeName).filter(Boolean);
}

function findLiveMember(member) {
  const candidates = getMemberIdentityCandidates(member);
  return liveMembers.find((live) => {
    const liveCandidates = getMemberIdentityCandidates(live);
    return candidates.some((candidate) => liveCandidates.includes(candidate));
  }) || null;
}

function getMemberJobs(member) {
  return optionalNumericValue(member.totalJobs, member.total_jobs, member.jobsCount, member.jobs_count) ?? (Array.isArray(member.jobs) ? member.jobs.length : 0);
}

function getMemberDistance(member) {
  return optionalNumericValue(member.distance, member.totalDistance, member.total_distance, member.distanceKm, member.distance_km)
    ?? (Array.isArray(member.jobs) ? member.jobs.reduce((total, job) => total + numericValue(firstValue(job.distance, job.distance_km, job.distanceKm, job.km)), 0) : 0);
}

function getMemberEarnings(member) {
  return optionalNumericValue(member.earnings, member.totalEarnings, member.total_earnings, member.income, member.revenue)
    ?? (Array.isArray(member.jobs) ? member.jobs.reduce((total, job) => total + numericValue(firstValue(job.income, job.revenue, job.earnings, job.money)), 0) : 0);
}

function getLiveActivity(live) {
  if (!live) {
    return "-";
  }

  const status = firstValue(live.status, live.state, live.activity, live.message, "Online");
  const game = firstValue(live.game, live.gameName, live.game_name);
  const truck = firstValue(live.truck, live.truckName, live.truck_name);
  const city = firstValue(live.city, live.location?.city);
  const cargo = firstValue(live.cargo, live.cargoName, live.cargo_name);
  return [status, game, truck, city, cargo].filter(Boolean).map(textFromValue).filter(Boolean).join(" - ") || "Online";
}

function renderMemberStatus(live) {
  const status = live ? "Online" : "Offline";
  return `<span class="member-status member-status-${status.toLowerCase()}">${status}</span>`;
}

function renderMembers() {
  if (!selectors.membersTable) {
    return;
  }

  const rows = members
    .slice()
    .sort(compareMemberIds);
  const onlineCount = rows.filter((member) => findLiveMember(member)).length;
  const totalPages = Math.max(1, Math.ceil(rows.length / MEMBERS_PAGE_SIZE));
  membersPage = Math.min(Math.max(1, membersPage), totalPages);
  const pageStart = (membersPage - 1) * MEMBERS_PAGE_SIZE;
  const visibleRows = rows.slice(pageStart, pageStart + MEMBERS_PAGE_SIZE);

  setText(selectors.membersSummary, `${formatNumber(rows.length)} members - ${formatNumber(onlineCount)} online - sorted by ID`);
  setText(selectors.membersPageStatus, `Page ${formatNumber(membersPage)} of ${formatNumber(totalPages)}`);
  if (selectors.membersPrevPageButton) {
    selectors.membersPrevPageButton.disabled = membersPage <= 1;
  }
  if (selectors.membersNextPageButton) {
    selectors.membersNextPageButton.disabled = membersPage >= totalPages;
  }

  selectors.membersTable.innerHTML = visibleRows.length
    ? visibleRows.map((member) => {
      const live = findLiveMember(member);
      const lastUpdate = firstValue(live?.updatedAt, live?.updated_at, member.lastSeenAt, member.last_seen_at, member.updatedAt, member.updated_at, member.lastLoginAt);
      return `
        <tr>
          <td>${renderMemberCell(member)}</td>
          <td>${renderMemberStatus(live)}</td>
          <td class="member-activity">${escapeHtml(getLiveActivity(live))}</td>
          <td>${escapeHtml(formatNumber(getMemberJobs(member)))}</td>
          <td>${escapeHtml(formatDistance(getMemberDistance(member)))}</td>
          <td>${escapeHtml(formatCurrency(getMemberEarnings(member)))}</td>
          <td>${renderCompactTime(lastUpdate)}</td>
        </tr>
      `;
    }).join("")
    : "<tr><td colspan=\"7\">No members found.</td></tr>";
}

function renderMemberCell(member) {
  return `
    <div class="member-cell">
      <img class="recent-driver-avatar" src="${escapeHtml(getMemberAvatar(member))}" alt="" onerror="this.src='../public/img/logo.png'" />
      <span>
        <strong>${escapeHtml(getMemberName(member) || "Unknown member")}</strong>
        <small>ID: ${escapeHtml(getMemberId(member) || "-")}</small>
      </span>
    </div>
  `;
}

async function refreshMembers() {
  if (!discordAuthorized) {
    return;
  }

  try {
    const usersResponse = await window.jastuk.fetchDriverUsers();
    if (!usersResponse.success) {
      throw new Error(usersResponse.error || "Driver users request failed");
    }
    members = getDriverUsers(usersResponse.data);
    membersPage = 1;
  } catch (error) {
    members = [];
    membersPage = 1;
    setText(selectors.membersSummary, `Unable to load members: ${error.message}`);
  }

  try {
    const liveResponse = await window.jastuk.fetchLiveDrivers();
    liveMembers = liveResponse.success ? getLiveDrivers(liveResponse.drivers || liveResponse.data) : [];
  } catch {
    liveMembers = [];
  }

  renderMembers();
}

function renderAdminDeliveries() {
  if (!selectors.adminDeliveriesTable) {
    return;
  }

  const recentJobs = Array.isArray(storedJobs) ? storedJobs.slice(-100).reverse() : [];
  const sentCount = jobDeliveries.filter((delivery) => delivery.status === "sent").length;
  const failedCount = jobDeliveries.filter((delivery) => delivery.status === "failed").length;
  const pendingCount = jobDeliveries.filter((delivery) => ["pending", "sending"].includes(delivery.status)).length;

  setText(
    selectors.adminDeliverySummary,
    `${formatNumber(jobDeliveries.length)} logged deliveries - ${formatNumber(sentCount)} sent, ${formatNumber(failedCount)} failed, ${formatNumber(pendingCount)} pending`
  );

  selectors.adminDeliveriesTable.innerHTML = recentJobs.length
    ? recentJobs.map((job) => {
      const delivery = getDeliveryForJob(job);
      const jobKey = getJobKey(job);
      const canResend = jobKey && (!delivery || delivery.status !== "sending");
      return `
        <tr>
          <td class="recent-time">${renderCompactTime(getEntryTime(job))}</td>
          <td>
            <strong>${escapeHtml(textFromValue(firstValue(job.cargo, job.cargoName, job.cargo_name, job.description, job.title)) || "Unknown Cargo")}</strong>
            <small>${escapeHtml(firstValue(job.id, job.job_id, job.jobId, job.uuid, job._trackerKey, "-"))}</small>
          </td>
          <td>${escapeHtml(getEntryRoute(job))}</td>
          <td>${renderDeliveryStatus(delivery)}</td>
          <td>${escapeHtml(delivery?.attempts ?? 0)}</td>
          <td class="delivery-message">${escapeHtml(getDeliveryMessage(delivery))}</td>
          <td>
            <button class="button button-secondary button-small resend-job-delivery" type="button" data-job-key="${escapeHtml(jobKey)}" ${canResend ? "" : "disabled"}>
              <i class="fa-solid fa-paper-plane"></i> Resend
            </button>
          </td>
        </tr>
      `;
    }).join("")
    : "<tr><td colspan=\"7\">No completed jobs captured yet.</td></tr>";
}

async function refreshJobDeliveries() {
  if (!currentUserIsAdmin) {
    jobDeliveries = [];
    renderAdminDeliveries();
    return;
  }

  if (!window.jastuk.loadJobDeliveries) {
    return;
  }

  try {
    const response = await window.jastuk.loadJobDeliveries();
    jobDeliveries = Array.isArray(response.deliveries) ? response.deliveries : [];
    renderAdminDeliveries();
  } catch (error) {
    jobDeliveries = [];
    setText(selectors.adminDeliverySummary, `Admin access required: ${error.message}`);
  }
}

function renderPersonalStats(jobs) {
  const hubJobs = hubPersonalDriver ? getHubJobs(hubPersonalDriver) : [];
  const statsJobs = hubJobs.length ? hubJobs : jobs;
  const completedJobs = Array.isArray(statsJobs) ? statsJobs.filter(isCompletedJob) : [];
  const source = completedJobs.length ? completedJobs : Array.isArray(statsJobs) ? statsJobs : [];
  const localDistance = source.reduce((total, job) => total + numericValue(firstValue(job.distance, job.distance_km, job.distanceKm, job.planned_distance_km, job.km)), 0);
  const localEarnings = source.reduce((total, job) => total + numericValue(firstValue(job.income, job.revenue, job.earnings, job.money)), 0);
  const personalJobs = hubPersonalDriver ? getHubPersonalJobs(hubPersonalDriver) : source.length;
  const personalDistance = hubPersonalDriver ? getHubPersonalDistance(hubPersonalDriver) : localDistance;
  const personalEarnings = hubPersonalDriver ? getHubPersonalEarnings(hubPersonalDriver) : localEarnings;
  const damageValues = source
    .map((job) => damagePercentValue(getJobDamageValue(job)))
    .filter((value) => value !== null);
  const averageDamage = damageValues.length
    ? `${Math.round(damageValues.reduce((total, value) => total + value, 0) / damageValues.length)}%`
    : "-";

  setText(selectors.personalJobs, formatNumber(personalJobs));
  setText(selectors.personalDistance, formatDistance(personalDistance));
  setText(selectors.personalEarnings, formatCurrency(personalEarnings));
  setText(selectors.personalDamage, averageDamage);
}

async function renderStoredJobs() {
  await ensureLocalUsersLoaded();
  const response = await window.jastuk.loadJobs();
  storedJobs = Array.isArray(response.jobs) ? response.jobs : [];
  renderPersonalStats(storedJobs);
  renderRecentJobs({ jobs: storedJobs });
  await refreshJobDeliveries();
}

async function refreshDashboardData() {
  await Promise.allSettled([
    renderStoredJobs(),
    loadRouteData(),
    refreshHubStats()
  ]);
}

function renderHeader(snapshot) {
  const currentJob = snapshot?.current_job;
  const updatedText = snapshot?.updated_at_utc ? new Date(snapshot.updated_at_utc).toLocaleString() : "-";

  if (!isActiveCurrentJob(currentJob)) {
    setText(selectors.jobGame, "-");
    setText(selectors.jobCargo, "-");
    setText(selectors.jobRoute, "-");
    setText(selectors.jobDistance, "-");
    setText(selectors.jobIncome, "-");
    setText(selectors.jobDamage, "-");
    setText(selectors.summaryLastEvent, "-");
    setText(selectors.summarySession, snapshot?.session_id || "-");
    setText(selectors.summaryEvents, snapshot?.jobs?.length ?? 0);
    setText(selectors.summaryUpdated, updatedText);
    setHtml(selectors.eventList, "<div class='help-text'>No active job available. Start a session in ETS2 or ATS to see live data.</div>");
    setHtml(selectors.historyList, "<div class='help-text'>History will appear after tracker events are captured.</div>");
    setText(selectors.rawJson, JSON.stringify(snapshot, null, 2));
    renderRecentJobs({ jobs: storedJobs });
    return;
  }

  setText(selectors.jobGame, formatValue(getEntryGame(currentJob)));
  setText(selectors.jobCargo, formatValue(textFromValue(firstValue(currentJob.cargo, currentJob.cargoName, currentJob.cargo_name, currentJob.description, currentJob.title))));
  setText(selectors.jobRoute, getEntryRoute(currentJob));
  setText(selectors.jobDistance, formatValue(firstValue(currentJob.distance, currentJob.distance_km, currentJob.distanceKm, currentJob.planned_distance_km, currentJob.km)));
  setText(selectors.jobIncome, formatValue(firstValue(currentJob.income, currentJob.revenue, currentJob.earnings, currentJob.money)));
  setText(selectors.jobDamage, formatValue(getJobDamageValue(currentJob)));
  setText(selectors.summaryEvents, snapshot.jobs?.length ?? 0);
  setText(selectors.summaryLastEvent, snapshot.jobs?.length ? snapshot.jobs[snapshot.jobs.length - 1]?.type : "-");
  setText(selectors.summaryUpdated, updatedText);
  setText(selectors.summarySession, formatValue(snapshot.session_id));

  const recent = snapshot.jobs?.slice(-6).reverse() ?? [];
  setHtml(selectors.eventList, recent.length
    ? recent.map((entry) => `<div class="event-item"><div class="event-type">${entry.type || entry.event || "event"}</div><div class="event-meta">${getEntryTime(entry)} - ${textFromValue(firstValue(entry.cargo, entry.cargo_name, entry.description, entry.title)) || "no details"}</div></div>`).join("")
    : "<div class='help-text'>No recent events yet.</div>");

  setHtml(selectors.historyList, snapshot.jobs?.length
    ? snapshot.jobs.map((entry) => `<div class="history-item"><div class="event-type">${entry.type || entry.event || "event"}</div><div class="event-meta">${getEntryTime(entry)} - ${textFromValue(firstValue(entry.cargo, entry.cargo_name, entry.description, entry.title)) || "details unavailable"}</div></div>`).join("")
    : "<div class='help-text'>No history available yet.</div>");

  setText(selectors.rawJson, JSON.stringify(snapshot, null, 2));
  renderRecentJobs({ jobs: storedJobs });
}

async function refreshHubStats() {
  try {
    const response = await fetch("https://hub.jastukvtc.com/api/vtc/stats");
    if (!response.ok) {
      throw new Error(`Hub stats request failed: ${response.status}`);
    }

    const data = await response.json();
    selectors.hubJobs.textContent = formatNumber(data.jobs);
    selectors.hubDistance.textContent = data.distance === undefined || data.distance === null ? "-" : `${formatNumber(data.distance)} KM`;
    selectors.hubEarnings.textContent = data.earnings === undefined || data.earnings === null ? "-" : `${formatNumber(data.earnings)} €`;
    selectors.hubFuel.textContent = data.fuel === undefined || data.fuel === null ? "-" : `${formatNumber(data.fuel)} L`;
  } catch (error) {
    selectors.hubJobs.textContent = "-";
    selectors.hubDistance.textContent = "-";
    selectors.hubEarnings.textContent = "-";
    selectors.hubFuel.textContent = "-";
  }

  try {
    await ensureLocalUsersLoaded();
    const usersResponse = await window.jastuk.fetchDriverUsers();
    if (!usersResponse.success) {
      throw new Error(usersResponse.error || "Driver users request failed");
    }

    hubPersonalDriver = findHubDriver(getDriverUsers(usersResponse.data));
  } catch (error) {
    hubPersonalDriver = null;
  }

  renderPersonalStats(storedJobs);
  renderRecentJobs({ jobs: storedJobs });
}

async function refreshSnapshot() {
  if (snapshotRefreshInFlight) {
    return;
  }

  if (!discordAuthorized) {
    setHtml(selectors.eventList, "<div class='help-text'>Discord login with the required role is required to continue.</div>");
    setHtml(selectors.historyList, "");
    selectors.recentJobsTable.innerHTML = "<tr><td colspan=\"8\">Sign in or enable a local user to view completed jobs.</td></tr>";
    setText(selectors.rawJson, "{}");
    return;
  }

  snapshotRefreshInFlight = true;
  try {
    await refreshHubStats();
    const response = await window.jastuk.fetchJobs();
    if (!response.success) {
      setHtml(selectors.eventList, "<div class='help-text'>Unable to reach the local tracker API. Make sure the game plugin is running and the telemetry server is active.</div>");
      setHtml(selectors.historyList, "");
      await renderStoredJobs();
      setText(selectors.rawJson, "{}");
      return;
    }

    currentSnapshot = response.data;
    storedJobs = Array.isArray(response.storedJobs) ? response.storedJobs : storedJobs;
    renderPersonalStats(storedJobs);
    await refreshJobDeliveries();
    renderHeader(currentSnapshot);
  } catch (error) {
    setHtml(selectors.eventList, "<div class='help-text'>Unable to reach the local tracker API.</div>");
    setHtml(selectors.historyList, "");
    await renderStoredJobs();
    setText(selectors.rawJson, "{}");
  } finally {
    snapshotRefreshInFlight = false;
  }
}

function setDiscordStatus(user, message, accessAllowed = false) {
  discordAuthorized = accessAllowed;
  currentUserIsAdmin = accessAllowed && isAdminIdentity(user);
  const username = user?.displayName || user?.global_name || user?.username;
  setText(selectors.discordUser, username ? `${username}${user.discriminator ? `#${user.discriminator}` : ""}` : "Signed out");
  setText(selectors.pageSubtitle, username ? `Welcome back, ${username}!` : "Welcome back!");
  setText(selectors.discordStatus, message || (user ? "Signed in" : "Sign in with Discord once your credentials are saved."));
  setText(selectors.loginStatusMessage, accessAllowed ? "Login complete. Opening dashboard..." : "Connect with Discord to continue.");
  updateAccessControls();
  if (!currentUserIsAdmin && document.getElementById("admin-tab")?.classList.contains("active")) {
    setActiveTab(discordAuthorized ? "dashboard" : "login-page");
  }
}

function renderUpdaterStatus(status) {
  if (!status) {
    return;
  }

  const currentVersion = status.currentVersion || "-";
  const nextVersion = status.updateInfo?.version;
  const progress = status.progress?.percent ? ` (${Math.round(status.progress.percent)}%)` : "";
  const detail = status.error ? status.error : `${status.message || "Ready to check for updates."}${progress}`;

  selectors.updateStatus.textContent = detail;
  selectors.updateVersion.textContent = nextVersion && nextVersion !== currentVersion
    ? `Current version: ${currentVersion} - Available version: ${nextVersion}`
    : `Current version: ${currentVersion}`;

  selectors.checkUpdatesButton.disabled = ["checking", "downloading"].includes(status.status);
  selectors.downloadUpdateButton.disabled = status.status !== "available";
  selectors.installUpdateButton.disabled = status.status !== "downloaded";
}

async function refreshUpdaterStatus() {
  const status = await window.jastuk.getUpdaterStatus();
  renderUpdaterStatus(status);
}

function renderDiscordPresenceStatus(status) {
  if (!status || !selectors.discordPresenceStatus) {
    return;
  }

  const detail = status.error
    ? `${status.message || "Discord Rich Presence error"}: ${status.error}`
    : status.message || "Discord Rich Presence is idle.";
  selectors.discordPresenceStatus.textContent = detail;
  selectors.discordPresenceClient.textContent = `Client ID: ${status.clientId || "-"}`;
}

async function refreshDiscordPresenceStatus() {
  renderDiscordPresenceStatus(await window.jastuk.getDiscordPresenceStatus());
}

async function loadLocalUsers() {
  const response = await window.jastuk.loadUsers();
  localUsers = Array.isArray(response.users) ? response.users : [];
  const enabledUsers = localUsers.filter((user) => user.enabled !== false);

  const activeUser = enabledUsers[0];
  selectors.localUsersStatus.textContent = activeUser
    ? `Logged in as ${activeUser.displayName || activeUser.username || activeUser.id}.`
    : "No logged in user found.";

  selectors.localUsersList.innerHTML = enabledUsers.length
    ? enabledUsers.map((user) => `<div class="local-user-chip"><i class="fa-solid fa-user-check"></i><span>${escapeHtml(user.displayName || user.username || user.id)}</span></div>`).join("")
    : "<div class=\"help-text\">Add users to electron/users.json to unlock without Discord.</div>";

  return enabledUsers;
}

async function getEnabledLocalUsers() {
  const response = await window.jastuk.loadUsers();
  localUsers = Array.isArray(response.users) ? response.users : [];
  return localUsers.filter((user) => user.enabled !== false);
}

function normalizeSteamId(value) {
  return String(value || "").replace(/\D/g, "");
}

function hasSavedSteamId(config, user) {
  return Boolean(firstValue(
    config?.values?.DRIVER_STEAM_ID,
    config?.values?.STEAM_ID,
    config?.values?.TRUCKERSMP_STEAM_ID,
    user?.steamid,
    user?.steamId,
    user?.steamID
  ));
}

function showSteamIdPrompt(prefill = "") {
  if (!selectors.steamIdPrompt || !selectors.steamIdPromptInput) {
    return;
  }

  selectors.steamIdPrompt.hidden = false;
  selectors.steamIdPromptInput.value = normalizeSteamId(prefill);
  setText(selectors.steamIdPromptError, "");
  selectors.steamIdPromptInput.focus();
}

function hideSteamIdPrompt() {
  if (selectors.steamIdPrompt) {
    selectors.steamIdPrompt.hidden = true;
  }
}

async function saveSteamIdFromPrompt() {
  const steamId = normalizeSteamId(selectors.steamIdPromptInput?.value);
  if (!/^\d{16,20}$/.test(steamId)) {
    setText(selectors.steamIdPromptError, "Enter a valid Steam ID64.");
    return;
  }

  selectors.steamIdPromptSave.disabled = true;
  setText(selectors.steamIdPromptError, "Saving...");
  try {
    await window.jastuk.saveConfig({ DRIVER_STEAM_ID: steamId });
    setInputValue(selectors.driverSteamIdInput, steamId);
    hideSteamIdPrompt();
  } catch (error) {
    setText(selectors.steamIdPromptError, `Save failed: ${error.message}`);
  } finally {
    selectors.steamIdPromptSave.disabled = false;
  }
}

function maybeAskForSteamId(config, user) {
  if (!user || hasSavedSteamId(config, user)) {
    return;
  }

  showSteamIdPrompt(firstValue(user.steamid, user.steamId, user.steamID));
}

async function loadConfiguration() {
  const config = await window.jastuk.loadConfig();
  const configuredAdminIds = parseAdminIdList(config.values.ADMIN_DISCORD_IDS);
  adminDiscordIds = new Set(configuredAdminIds.length ? configuredAdminIds : DEFAULT_ADMIN_DISCORD_IDS);
  const enabledUsers = await loadLocalUsers();
  setInputValue(selectors.clientIdInput, config.values.DISCORD_CLIENT_ID);
  setInputValue(selectors.clientSecretInput, config.values.DISCORD_CLIENT_SECRET);
  setInputValue(selectors.guildIdInput, config.values.DISCORD_GUILD_ID);
  setInputValue(selectors.requiredRoleIdInput, config.values.DISCORD_REQUIRED_ROLE_ID);
  setInputValue(selectors.driverSteamIdInput, config.values.DRIVER_STEAM_ID);
  const activeUser = enabledUsers[0] || null;
  const overlaySettings = getUserOverlaySettings(config, activeUser);
  selectors.overlayEnabledInput.checked = Boolean(overlaySettings.enabled);
  selectors.overlayRequireGameFocusInput.checked = Boolean(overlaySettings.requireGameFocus);
  selectors.overlayPositionInput.value = String(overlaySettings.position).toLowerCase() === "bottom" ? "bottom" : "top";
  selectors.overlayOpacityInput.value = String(overlaySettings.opacity);
  renderOverlayFieldOptions(overlaySettings.fields);

  if (enabledUsers.length) {
    await unlockFromSavedUser();
    maybeAskForSteamId(config, enabledUsers[0]);
    setActiveTab(getRequestedTab() || "dashboard");
    Promise.allSettled([
      refreshMembers(),
      refreshJobDeliveries(),
      refreshSnapshot(),
      refreshDashboardData()
    ]).catch(() => {});
    return;
  }

  setDiscordStatus(null, "Connect with Discord to enable the dashboard, or add users to electron/users.json.", false);
  setActiveTab(getRequestedTab() === "account" ? "account" : "login-page");
}

function getConfigFormValues() {
  return {
    DISCORD_CLIENT_ID: selectors.clientIdInput.value.trim(),
    DISCORD_CLIENT_SECRET: selectors.clientSecretInput.value.trim(),
    DISCORD_GUILD_ID: selectors.guildIdInput.value.trim(),
    DISCORD_REQUIRED_ROLE_ID: selectors.requiredRoleIdInput.value.trim(),
    DRIVER_STEAM_ID: selectors.driverSteamIdInput.value.trim()
  };
}

async function saveConfigFormValues({ saveOverlay = true } = {}) {
  saveRoutePreferences({
    game: selectors.routeDefaultGame.value,
    dlc: getSelectedRouteDlc()
  });
  selectors.routeGameSelect.value = routePreferences.game;
  pickRandomRoute(routePreferences.game);

  await window.jastuk.saveConfig(getConfigFormValues());

  if (!saveOverlay) {
    return;
  }

  try {
    const response = await window.jastuk.saveOverlaySettings({
      enabled: selectors.overlayEnabledInput.checked,
      requireGameFocus: selectors.overlayRequireGameFocusInput.checked,
      position: selectors.overlayPositionInput.value,
      opacity: Number(selectors.overlayOpacityInput.value),
      fields: getSelectedOverlayFields()
    });
    localUsers = Array.isArray(response.users) ? response.users : localUsers;
  } catch (error) {
    if (!localUsers.some((user) => user.enabled !== false)) {
      return;
    }

    throw error;
  }
}

async function signInWithDiscord(button) {
  if (loginInFlight) {
    return;
  }

  if (!selectors.loginPageButton) {
    initializeSelectors();
  }

  loginInFlight = true;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Signing in...";
  setText(selectors.loginStatusMessage, "Checking saved login...");

  try {
    const enabledUsers = await getEnabledLocalUsers();
    const activeUser = enabledUsers[0] || null;
    if (activeUser) {
      setDiscordStatus(activeUser, "Authorized from saved local profile", true);
      await openAuthorizedTab("dashboard");
      Promise.allSettled([
        refreshMembers(),
        refreshSnapshot(),
        refreshDashboardData()
      ]).catch(() => {});
      return;
    }

    if (button === selectors.loginDiscordButton) {
      setText(selectors.loginStatusMessage, "Saving Discord credentials...");
      await saveConfigFormValues({ saveOverlay: false });
    }

    setText(selectors.loginStatusMessage, "Opening Discord login window...");
    const response = await window.jastuk.discordLogin();
    if (!response.success) {
      setDiscordStatus(null, `Login failed: ${response.error}`, false);
    } else {
      setDiscordStatus(response.user, "Signed in with Discord", true);
      await openAuthorizedTab("dashboard");
      loadLocalUsers().catch(() => {});
      window.jastuk.loadConfig()
        .then((config) => maybeAskForSteamId(config, response.user))
        .catch(() => {});
      Promise.allSettled([
        refreshMembers(),
        refreshSnapshot(),
        refreshDashboardData()
      ]).catch(() => {});
    }
  } catch (error) {
    setDiscordStatus(null, `Login failed: ${error.message}`, false);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
    loginInFlight = false;
  }
}

function bindLoginControls() {
  if (selectors.goToAccountButton && !selectors.goToAccountButton.dataset.boundClick) {
    selectors.goToAccountButton.dataset.boundClick = "true";
    selectors.goToAccountButton.addEventListener("click", () => {
      setActiveTab("account");
    });
  }

  if (selectors.loginPageButton && !selectors.loginPageButton.dataset.boundClick) {
    selectors.loginPageButton.dataset.boundClick = "true";
    selectors.loginPageButton.addEventListener("click", () => signInWithDiscord(selectors.loginPageButton));
  }

  if (selectors.loginDiscordButton && !selectors.loginDiscordButton.dataset.boundClick) {
    selectors.loginDiscordButton.dataset.boundClick = "true";
    selectors.loginDiscordButton.addEventListener("click", () => signInWithDiscord(selectors.loginDiscordButton));
  }

  if (selectors.steamIdPromptSave && !selectors.steamIdPromptSave.dataset.boundClick) {
    selectors.steamIdPromptSave.dataset.boundClick = "true";
    selectors.steamIdPromptSave.addEventListener("click", saveSteamIdFromPrompt);
  }

  if (selectors.steamIdPromptLater && !selectors.steamIdPromptLater.dataset.boundClick) {
    selectors.steamIdPromptLater.dataset.boundClick = "true";
    selectors.steamIdPromptLater.addEventListener("click", hideSteamIdPrompt);
  }

  if (selectors.steamIdPromptInput && !selectors.steamIdPromptInput.dataset.boundKeydown) {
    selectors.steamIdPromptInput.dataset.boundKeydown = "true";
    selectors.steamIdPromptInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveSteamIdFromPrompt();
      }
    });
  }
}

async function initialize() {
  initializeSelectors();
  bindLoginControls();

  try {
    await window.jastukLayout.ready;
  } catch (error) {
    setText(selectors.loginStatusMessage, `Layout failed: ${error.message}`);
  }

  initializeSelectors();
  bindLoginControls();
  setText(selectors.apiUrlLabel, await window.jastuk.getApiUrl());

  tabs.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.hash = button.dataset.tab;
      openAuthorizedTab(button.dataset.tab);
      if (button.dataset.tab === "members") {
        refreshMembers();
      }
    });
  });

  selectors.saveConfigButton.addEventListener("click", async () => {
    selectors.saveConfigButton.disabled = true;
    const originalText = selectors.saveConfigButton.textContent;

    try {
      await saveConfigFormValues();
      if (normalizeSteamId(selectors.driverSteamIdInput.value)) {
        hideSteamIdPrompt();
      }
      selectors.saveConfigButton.textContent = "Saved";
    } catch (error) {
      selectors.saveConfigButton.textContent = "Save failed";
      setText(selectors.discordStatus, `Save failed: ${error.message}`);
      setText(selectors.loginStatusMessage, `Save failed: ${error.message}`);
    } finally {
      setTimeout(() => {
        selectors.saveConfigButton.textContent = originalText;
        selectors.saveConfigButton.disabled = false;
      }, 1200);
    }
  });

  selectors.overlayResetFieldsButton.addEventListener("click", () => {
    renderOverlayFieldOptions(DEFAULT_OVERLAY_FIELDS);
  });

  selectors.routeGameSelect.addEventListener("change", () => {
    routePreferences = {
      ...(routePreferences || DEFAULT_ROUTE_PREFERENCES),
      game: normalizeRouteGame(selectors.routeGameSelect.value)
    };
    selectors.routeDefaultGame.value = routePreferences.game;
    saveRoutePreferences(routePreferences);
    pickRandomRoute(routePreferences.game);
  });

  selectors.routeDefaultGame.addEventListener("change", () => {
    selectors.routeGameSelect.value = normalizeRouteGame(selectors.routeDefaultGame.value);
  });

  selectors.routeRandomButton.addEventListener("click", () => {
    pickRandomRoute(selectors.routeGameSelect.value);
  });

  selectors.membersRefreshButton?.addEventListener("click", async () => {
    selectors.membersRefreshButton.disabled = true;
    await refreshMembers();
    selectors.membersRefreshButton.disabled = false;
  });

  selectors.membersPrevPageButton?.addEventListener("click", () => {
    membersPage = Math.max(1, membersPage - 1);
    renderMembers();
  });

  selectors.membersNextPageButton?.addEventListener("click", () => {
    membersPage += 1;
    renderMembers();
  });

  selectors.adminRefreshDeliveriesButton?.addEventListener("click", async () => {
    if (!currentUserIsAdmin) {
      return;
    }

    selectors.adminRefreshDeliveriesButton.disabled = true;
    await renderStoredJobs();
    selectors.adminRefreshDeliveriesButton.disabled = false;
  });

  selectors.adminDeliveriesTable?.addEventListener("click", async (event) => {
    const button = event.target.closest(".resend-job-delivery");
    if (!button) {
      return;
    }

    if (!currentUserIsAdmin) {
      return;
    }

    const jobKey = button.dataset.jobKey;
    if (!jobKey) {
      return;
    }

    button.disabled = true;
    button.innerHTML = "<i class=\"fa-solid fa-spinner fa-spin\"></i> Sending";
    const result = await window.jastuk.resendJobDelivery(jobKey);
    if (!result.success) {
      setText(selectors.adminDeliverySummary, `Resend failed: ${result.error}`);
    }
    await renderStoredJobs();
  });

  if (selectors.openDiscordButton) {
    selectors.openDiscordButton.addEventListener("click", () => {
      window.jastuk.openUrl("https://discord.com/developers/applications");
    });
  }

  selectors.checkUpdatesButton.addEventListener("click", async () => {
    selectors.checkUpdatesButton.disabled = true;
    renderUpdaterStatus(await window.jastuk.checkForUpdates());
  });

  selectors.downloadUpdateButton.addEventListener("click", async () => {
    selectors.downloadUpdateButton.disabled = true;
    renderUpdaterStatus(await window.jastuk.downloadUpdate());
  });

  selectors.installUpdateButton.addEventListener("click", () => {
    window.jastuk.installUpdate();
  });

  selectors.testRichPresenceButton.addEventListener("click", async () => {
    selectors.testRichPresenceButton.disabled = true;
    renderDiscordPresenceStatus(await window.jastuk.testDiscordPresence());
    setTimeout(() => {
      selectors.testRichPresenceButton.disabled = false;
    }, 1200);
  });

  selectors.showRichPresenceLogButton.addEventListener("click", async () => {
    const log = await window.jastuk.getDiscordPresenceLog();
    selectors.discordPresenceLog.hidden = false;
    selectors.discordPresenceLog.textContent = [
      log.path ? `Log: ${log.path}` : "Log path unavailable",
      log.error ? `Error: ${log.error}` : "",
      ...log.lines
    ].filter(Boolean).join("\n");
  });

  removeUpdaterStatusListener = window.jastuk.onUpdaterStatus(renderUpdaterStatus);
  removeDiscordPresenceStatusListener = window.jastuk.onDiscordPresenceStatus(renderDiscordPresenceStatus);

  await loadConfiguration();
  await Promise.allSettled([
    refreshDashboardData(),
    refreshUpdaterStatus(),
    refreshDiscordPresenceStatus()
  ]);
  snapshotRefreshTimer = setInterval(refreshSnapshot, 5000);
}

window.addEventListener("beforeunload", () => {
  if (snapshotRefreshTimer) {
    clearInterval(snapshotRefreshTimer);
  }

  if (removeUpdaterStatusListener) {
    removeUpdaterStatusListener();
  }

  if (removeDiscordPresenceStatusListener) {
    removeDiscordPresenceStatusListener();
  }
});

document.addEventListener("DOMContentLoaded", initialize);
