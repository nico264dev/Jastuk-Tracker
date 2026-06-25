const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const net = require("net");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const electronRuntime = require("electron");
if (typeof electronRuntime === "string") {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronRuntime, [path.join(__dirname, "..")], {
    env,
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
  process.exit(0);
}

const { app, BrowserWindow, ipcMain, shell, clipboard, Menu, nativeImage, screen, Tray } = electronRuntime;
const axios = require("axios");
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  autoUpdater = null;
}

const execFileAsync = promisify(execFile);
const APP_TITLE = "Jastuk Tracker";
const APP_ICON_PATH = path.join(__dirname, "..", "public", "img", "logo.png");
const APP_ICON = nativeImage?.createFromPath
  ? nativeImage.createFromPath(APP_ICON_PATH)
  : undefined;
const APP_ICON_SOURCE = APP_ICON || APP_ICON_PATH;
app.setName(APP_TITLE);
app.setPath("userData", path.join(app.getPath("appData"), APP_TITLE));
app.commandLine.appendSwitch("disk-cache-dir", path.join(app.getPath("userData"), "Cache"));
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const API_URL = "http://127.0.0.1:48251";
const LOCAL_TRACKER_TIMEOUT_MS = 2200;
const TRACKER_JOBS_TIMEOUT_MS = 3000;
const LIVE_API_TIMEOUT_MS = 3000;
const DISCORD_AUTH_TIMEOUT_MS = 15000;
const LOCAL_TRACKER_STALE_GRACE_MS = 10000;
const FOREGROUND_GAME_CACHE_MS = 1000;
const OVERLAY_HEIGHT = 144;
const GAME_PROCESS_NAMES = new Set(["eurotrucks2", "eurotrucks2.exe", "amtrucks", "amtrucks.exe"]);
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
const DISCORD_AUTHORIZE_URL = "https://discord.com/api/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_ME_URL = "https://discord.com/api/users/@me";
const DISCORD_REDIRECT_URI = "http://127.0.0.1:48252/callback";
const DISCORD_SCOPE = "identify guilds.members.read";
const REQUIRED_DISCORD_ROLE_ID = "1496990127581302916";
const DEFAULT_ENV_FILENAME = ".env";
const USERS_FILENAME = "users.json";
const JOBS_FILENAME = "jobs.json";
const JOB_DELIVERIES_FILENAME = "job-deliveries.json";
const CITIES_FILENAME = "cities.json";
const APP_CONFIG_FILENAME = "app-config.json";
const PARTIALS_DIR = path.join(__dirname, "partials");
const DEFAULT_DRIVER_USERS_URL = "https://hub.jastukvtc.com/api/drivers/users";
const DEFAULT_PROFILE_DRIVERS_URL = "https://hub.jastukvtc.com/api/vtc/drivers";
const DEFAULT_LIVE_DRIVERS_URL = "https://api.jastukvtc.com/live/drivers";
const DEFAULT_DRIVERSHUB_COMPLETE_JOB_URL = "http://5.231.5.90:8082/complete-job";
const DEFAULT_ADMIN_DISCORD_IDS = [
  "1496983353037951167",
  "1496920531721650428",
  "1496983823953428520"
];
const DEFAULT_TRUCKERSMP_SERVERS_URL = "https://api.truckersmp.com/v2/servers";
const LEGACY_LIVE_DRIVERS_URLS = new Set([
  "http://5.231.5.90:2238/live/drivers",
  "https://5.231.5.90:2238/live/drivers"
]);
const LIVE_RECEIVER_PORT = 48253;
const DISCORD_RPC_UPDATE_MS = 1000;
const DISCORD_RPC_RECONNECT_MS = 10000;
const DISCORD_RPC_ACTIVITY_VERSION = "tmp-presence-v4";
const TRUCKERSMP_CACHE_MS = 2500;
const TRUCKERSMP_SERVERS_CACHE_MS = 5 * 60 * 1000;
const TRUCKERSMP_LOG_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const TRUCKERSMP_LOG_CANDIDATE_LIMIT = 8;
let receivedLiveTelemetry = null;
let lastLiveTrackerSnapshot = null;
let liveReceiverServer = null;
const liveReceiverSockets = new Set();
let mainWindow = null;
let overlayWindow = null;
let tray = null;
let isQuitting = false;
let updaterAutoCheckTimer = null;
let trackerPersistenceTimer = null;
let trackerPersistenceInFlight = false;
let discordPresenceTimer = null;
let discordPresenceReconnectTimer = null;
let discordPresenceSocket = null;
let discordPresenceReady = false;
let discordPresenceLastActivity = "";
let discordPresenceConnectedClientId = null;
let discordPresenceSafeMode = false;
let discordPresenceStopping = false;
let discordPresenceStartedAt = Math.floor(Date.now() / 1000);
let discordPresenceState = {
  status: "idle",
  message: "Discord Rich Presence has not started yet.",
  clientId: null,
  error: null,
  updatedAt: null
};
let appCleanupStarted = false;
let foregroundGameCache = { checkedAt: 0, result: { isGame: false, processName: null, title: null } };
let truckersMpCache = { checkedAt: 0, result: null };
let truckersMpServersCache = { checkedAt: 0, servers: [] };

function appendDiscordPresenceLog(message, payload = null) {
  try {
    const logPath = path.join(app.getPath("userData"), "discord-presence.log");
    const line = JSON.stringify({
      at: new Date().toISOString(),
      message,
      payload
    }) + "\n";
    fs.appendFileSync(logPath, line, "utf8");
  } catch {
    // Debug logging must never break the app.
  }
}

function appendAppDebugLog(message, payload = null) {
  try {
    const logPath = path.join(app.getPath("userData"), "app-debug.log");
    const line = JSON.stringify({
      at: new Date().toISOString(),
      message,
      payload
    }) + "\n";
    fs.appendFileSync(logPath, line, "utf8");
  } catch {
    // Debug logging must never break the app.
  }
}
let updaterState = {
  status: "idle",
  message: "Ready to check for updates.",
  currentVersion: app.getVersion(),
  updateInfo: null,
  progress: null,
  error: null,
  isPackaged: app.isPackaged
};

if (autoUpdater) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.verifyUpdateCodeSignature = false;
}

function setUpdaterState(nextState) {
  updaterState = {
    ...updaterState,
    ...nextState,
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged
  };

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send("updater-status", updaterState);
  });
}

function getUpdaterState() {
  return updaterState;
}

function updateUnavailableInDev() {
  return {
    ...getUpdaterState(),
    status: "unavailable",
    message: "Update checks are available after installing a packaged release.",
    error: null
  };
}

function getUpdaterErrorMessage(error) {
  const rawMessage = String(error?.message || error || "");
  if (rawMessage.includes("releases.atom") && rawMessage.includes("404")) {
    return "No public GitHub release feed was found. Publish a release for nico264dev/Jastuk-Tracker, or make the repository/releases public before using in-app updates.";
  }

  if (rawMessage.includes("404")) {
    return "The update feed was not found. Check the GitHub owner/repo settings and published release files.";
  }

  if (rawMessage.includes("401") || rawMessage.includes("403")) {
    return "GitHub refused the update request. Public releases are recommended because installed apps cannot safely include a private GitHub token.";
  }

  if (rawMessage.includes("not signed") || rawMessage.includes("nicht digital signiert")) {
    return "The downloaded update is not digitally signed. Install this version manually once, or sign future Windows installers with a code-signing certificate.";
  }

  return rawMessage || "Unknown updater error.";
}

async function checkForAppUpdates() {
  if (!app.isPackaged || !autoUpdater) {
    setUpdaterState(updateUnavailableInDev());
    return getUpdaterState();
  }

  setUpdaterState({
    status: "checking",
    message: "Checking GitHub releases...",
    error: null,
    progress: null
  });

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setUpdaterState({
      status: "error",
      message: "Update check failed.",
      error: getUpdaterErrorMessage(error),
      progress: null
    });
  }

  return getUpdaterState();
}

async function downloadAppUpdate() {
  if (!app.isPackaged || !autoUpdater) {
    setUpdaterState(updateUnavailableInDev());
    return getUpdaterState();
  }

  setUpdaterState({
    status: "downloading",
    message: "Downloading update...",
    error: null
  });

  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    setUpdaterState({
      status: "error",
      message: "Update download failed.",
      error: getUpdaterErrorMessage(error),
      progress: null
    });
  }

  return getUpdaterState();
}

function installAppUpdate() {
  if (updaterState.status !== "downloaded" || !autoUpdater) {
    return false;
  }

  autoUpdater.quitAndInstall(false, true);
  return true;
}

function startUpdaterAutoChecks() {
  if (updaterAutoCheckTimer || !app.isPackaged || !autoUpdater) {
    return;
  }

  setTimeout(() => {
    checkForAppUpdates();
  }, 5000);

  updaterAutoCheckTimer = setInterval(() => {
    checkForAppUpdates();
  }, 4 * 60 * 60 * 1000);
}

if (autoUpdater) {
  autoUpdater.on("checking-for-update", () => {
    setUpdaterState({
      status: "checking",
      message: "Checking GitHub releases...",
      error: null,
      progress: null
    });
  });

  autoUpdater.on("update-available", (info) => {
    setUpdaterState({
      status: "available",
      message: `Version ${info.version} is available.`,
      updateInfo: info,
      error: null,
      progress: null
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    setUpdaterState({
      status: "current",
      message: "You are running the latest version.",
      updateInfo: info,
      error: null,
      progress: null
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdaterState({
      status: "downloading",
      message: `Downloading update ${Math.round(progress.percent || 0)}%...`,
      progress,
      error: null
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdaterState({
      status: "downloaded",
      message: `Version ${info.version} is ready to install.`,
      updateInfo: info,
      progress: null,
      error: null
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdaterState({
      status: "error",
      message: "Update check failed.",
      error: getUpdaterErrorMessage(error),
      progress: null
    });
  });
}

function resolveEnvPath() {
  const projectRootEnv = path.join(process.cwd(), DEFAULT_ENV_FILENAME);
  if (fs.existsSync(projectRootEnv)) {
    return projectRootEnv;
  }

  const userDataEnv = path.join(app.getPath("userData"), DEFAULT_ENV_FILENAME);
  return userDataEnv;
}

function parseEnv(content) {
  const result = {};
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      return;
    }

    const [key, ...valueParts] = trimmed.split("=");
    result[key.trim()] = valueParts.join("=").trim();
  });
  return result;
}

function loadBundledConfig() {
  const configPath = path.join(__dirname, APP_CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    return {};
  }
}

function mergeEnvValues(defaults, overrides) {
  const values = { ...defaults };
  Object.entries(overrides).forEach(([key, value]) => {
    if (value !== "" || defaults[key] === undefined || defaults[key] === "") {
      values[key] = value;
    }
  });

  ["LIVE_PUSH_URL", "LIVE_DRIVERS_URL"].forEach((key) => {
    if (!values[key] || LEGACY_LIVE_DRIVERS_URLS.has(values[key])) {
      values[key] = DEFAULT_LIVE_DRIVERS_URL;
    }
  });

  return values;
}

function serializeEnv(values) {
  return Object.entries(values)
    .filter(([key, value]) => value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";
}

function loadEnv() {
  const envPath = resolveEnvPath();
  const defaults = loadBundledConfig();
  if (!fs.existsSync(envPath)) {
    return { path: envPath, values: mergeEnvValues(defaults, {}) };
  }

  const content = fs.readFileSync(envPath, "utf8");
  return { path: envPath, values: mergeEnvValues(defaults, parseEnv(content)) };
}

function resolveUsersPath() {
  const userDataUsersPath = path.join(app.getPath("userData"), USERS_FILENAME);
  if (app.isPackaged) {
    return userDataUsersPath;
  }

  if (fs.existsSync(userDataUsersPath)) {
    return userDataUsersPath;
  }

  const projectUsersPath = path.join(process.cwd(), "electron", USERS_FILENAME);
  if (fs.existsSync(projectUsersPath)) {
    return projectUsersPath;
  }

  return userDataUsersPath;
}

function resolveJobsPath() {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), JOBS_FILENAME);
  }

  const projectJobsPath = path.join(process.cwd(), "electron", JOBS_FILENAME);
  if (fs.existsSync(projectJobsPath)) {
    return projectJobsPath;
  }

  return path.join(app.getPath("userData"), JOBS_FILENAME);
}

function resolveJobDeliveriesPath() {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), JOB_DELIVERIES_FILENAME);
  }

  const projectDeliveriesPath = path.join(process.cwd(), "electron", JOB_DELIVERIES_FILENAME);
  if (fs.existsSync(projectDeliveriesPath)) {
    return projectDeliveriesPath;
  }

  return path.join(app.getPath("userData"), JOB_DELIVERIES_FILENAME);
}

function resolveCitiesPath() {
  const projectCitiesPath = path.join(process.cwd(), "electron", CITIES_FILENAME);
  if (fs.existsSync(projectCitiesPath)) {
    return projectCitiesPath;
  }

  return path.join(__dirname, CITIES_FILENAME);
}

function loadPartial(name) {
  if (!/^[a-z0-9-]+$/i.test(String(name || ""))) {
    throw new Error("Invalid partial name.");
  }

  const partialPath = path.resolve(PARTIALS_DIR, `${name}.html`);
  if (!partialPath.startsWith(path.resolve(PARTIALS_DIR))) {
    throw new Error("Invalid partial path.");
  }

  return fs.readFileSync(partialPath, "utf8");
}

function loadUsers() {
  const usersPath = resolveUsersPath();
  if (!fs.existsSync(usersPath)) {
    return { path: usersPath, users: [] };
  }

  const content = fs.readFileSync(usersPath, "utf8");
  const parsed = JSON.parse(content);
  const users = Array.isArray(parsed) ? parsed : parsed.users || [];
  return { path: usersPath, users };
}

function getActiveLocalUser() {
  return loadUsers().users.find((user) => user.enabled !== false) || null;
}

function parseListValue(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((entry) => entry.trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getAdminDiscordIds() {
  const configuredIds = parseListValue(loadEnv().values.ADMIN_DISCORD_IDS);
  return new Set((configuredIds.length ? configuredIds : DEFAULT_ADMIN_DISCORD_IDS).map(String));
}

function getUserAdminCandidates(user) {
  return [
    user.id,
    user.discordId,
    user.discord_id,
    user.userId,
    user.user_id,
    ...parseListValue(user.roles)
  ].map(String).filter(Boolean);
}

function isAdminUser(user = getActiveLocalUser()) {
  if (!user) {
    return false;
  }

  const adminIds = getAdminDiscordIds();
  return getUserAdminCandidates(user).some((id) => adminIds.has(id));
}

function requireAdminUser() {
  if (!isAdminUser()) {
    throw new Error("Admin access is required.");
  }
}

function saveUsers(users) {
  const usersPath = resolveUsersPath();
  const content = JSON.stringify({ users }, null, 2) + "\n";
  fs.mkdirSync(path.dirname(usersPath), { recursive: true });
  fs.writeFileSync(usersPath, content, "utf8");
  return { path: usersPath, users };
}

function upsertDiscordUser(user, guildMember) {
  const current = loadUsers();
  const existingUser = current.users.find((entry) => entry.id === user.id);
  const users = current.users.filter((entry) => entry.id !== user.id);
  const displayName = user.global_name || user.username || "Discord User";
  const savedUser = {
    ...existingUser,
    id: user.id,
    username: user.username,
    displayName,
    discriminator: user.discriminator,
    avatar: user.avatar,
    source: "discord",
    role: "Tracker user",
    roles: guildMember?.roles || [],
    enabled: true,
    lastLoginAt: new Date().toISOString()
  };

  users.unshift(savedUser);
  saveUsers(users);
  return savedUser;
}

function loadJobs() {
  const jobsPath = resolveJobsPath();
  if (!fs.existsSync(jobsPath)) {
    return { path: jobsPath, jobs: [] };
  }

  const content = fs.readFileSync(jobsPath, "utf8");
  const parsed = JSON.parse(content);
  const jobs = Array.isArray(parsed) ? parsed : parsed.jobs || [];
  return { path: jobsPath, jobs };
}

function loadJobDeliveries() {
  const deliveriesPath = resolveJobDeliveriesPath();
  if (!fs.existsSync(deliveriesPath)) {
    return { path: deliveriesPath, deliveries: [] };
  }

  const content = fs.readFileSync(deliveriesPath, "utf8");
  const parsed = JSON.parse(content);
  const deliveries = Array.isArray(parsed) ? parsed : parsed.deliveries || [];
  return { path: deliveriesPath, deliveries };
}

function loadCities() {
  const citiesPath = resolveCitiesPath();
  if (!fs.existsSync(citiesPath)) {
    return { path: citiesPath, cities: [] };
  }

  const content = fs.readFileSync(citiesPath, "utf8");
  const parsed = JSON.parse(content);
  const cities = Array.isArray(parsed) ? parsed : parsed.cities || [];
  return { path: citiesPath, cities };
}

function saveJobs(jobs) {
  const jobsPath = resolveJobsPath();
  const content = JSON.stringify({ jobs }, null, 2) + "\n";
  fs.mkdirSync(path.dirname(jobsPath), { recursive: true });
  fs.writeFileSync(jobsPath, content, "utf8");
  return { path: jobsPath, jobs };
}

function saveJobDeliveries(deliveries) {
  const deliveriesPath = resolveJobDeliveriesPath();
  const content = JSON.stringify({ deliveries }, null, 2) + "\n";
  fs.mkdirSync(path.dirname(deliveriesPath), { recursive: true });
  fs.writeFileSync(deliveriesPath, content, "utf8");
  return { path: deliveriesPath, deliveries };
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function hasTelemetryValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function hasTelemetryObject(value) {
  return value && typeof value === "object" && Object.keys(value).length > 0;
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

function routeFromJob(job) {
  const sourceCity = textFromValue(firstValue(job.source?.city, job.source_city, job.sourceCity, job.from, job.origin, job.start));
  const sourceCompany = textFromValue(firstValue(job.source?.company, job.source_company, job.sourceCompany, job.originCompany));
  const destinationCity = textFromValue(firstValue(job.destination?.city, job.destination_city, job.destinationCity, job.to, job.target, job.end));
  const destinationCompany = textFromValue(firstValue(job.destination?.company, job.destination_company, job.destinationCompany, job.targetCompany));
  const sourceStop = formatRouteStop(sourceCity, sourceCompany);
  const destinationStop = formatRouteStop(destinationCity, destinationCompany);

  if (sourceStop || destinationStop) {
    return `${sourceStop || "?"} -> ${destinationStop || "?"}`;
  }

  return textFromValue(job.route);
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

function isFinishedJob(job) {
  const type = String(firstValue(job.type, job.status, job.event, job.state) || "").toLowerCase();
  return Boolean(
    type.includes("complete") ||
    type.includes("deliver") ||
    type.includes("finish") ||
    firstValue(job.finished_at_utc, job.finished_at, job.completed_at, job.delivered_at)
  );
}

function isActiveJob(job) {
  if (!job || typeof job !== "object") {
    return false;
  }

  if (isFinishedJob(job)) {
    return false;
  }

  const loadedFlag = firstValue(job.cargo_loaded, job.cargoLoaded, job.loaded, job.active);
  if (loadedFlag !== undefined) {
    return isTruthyFlag(loadedFlag);
  }

  const type = String(firstValue(job.type, job.status, job.event, job.state) || "").toLowerCase();
  const cargo = textFromValue(firstValue(job.cargo, job.cargoName, job.cargo_name, job.description, job.title));
  const hasStarted = Boolean(firstValue(job.started_at_utc, job.started_at, job.start_time, job.startTime));
  return Boolean(cargo && (hasStarted || type.includes("start") || type.includes("active")));
}

function normalizeTrackerJob(job) {
  return {
    ...job,
    timestamp: firstValue(job.timestamp, job.time, job.completed_at, job.finished_at, job.finished_at_utc, job.created_at, job.started_at_utc, job.date),
    game: textFromValue(firstValue(job.game, job.gameName, job.game_name, job.game_id)),
    cargo: textFromValue(firstValue(job.cargo, job.cargoName, job.cargo_name, job.description, job.title)),
    route: routeFromJob(job),
    distance: firstValue(job.distance, job.distance_km, job.distanceKm, job.planned_distance_km, job.km),
    income: firstValue(job.income, job.revenue, job.earnings, job.money),
    damage: firstValue(job.damage, job.cargo_damage, job.cargoDamage, job.damage_percent, job.damagePercent),
    event: job.event || job.type || job.status
  };
}

function getJobKey(job) {
  if (job.id || job.job_id || job.jobId || job.uuid) {
    return String(job.id || job.job_id || job.jobId || job.uuid);
  }

  const stablePayload = {
    type: job.type,
    status: job.status || job.event,
    timestamp: job.timestamp || job.time || job.completed_at || job.finished_at || job.finished_at_utc || job.created_at || job.started_at_utc,
    game: job.game,
    cargo: job.cargo || job.cargo_name || job.description || job.title,
    route: job.route,
    source: textFromValue(job.source || job.source_city || job.sourceCity || job.from || job.origin),
    destination: textFromValue(job.destination || job.destination_city || job.destinationCity || job.to || job.target),
    distance: job.distance || job.distance_km || job.distanceKm || job.planned_distance_km,
    income: job.income || job.revenue || job.earnings || job.money,
    damage: job.damage || job.cargo_damage || job.cargoDamage || job.damage_percent
  };

  return crypto.createHash("sha1").update(JSON.stringify(stablePayload)).digest("hex");
}

function parseNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function objectFromText(value, fallbackId = "unknown") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      id: String(firstValue(value.id, value.value, fallbackId)),
      name: String(firstValue(value.name, value.city, value.label, value.title, value.id, "Unknown"))
    };
  }

  const text = textFromValue(value) || "Unknown";
  return {
    id: String(fallbackId === "unknown" ? text.toLowerCase().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "unknown" : fallbackId),
    name: String(text)
  };
}

function getConfiguredDriversHubCompleteJobUrl() {
  const env = loadEnv().values;
  return env.DRIVERSHUB_COMPLETE_JOB_URL || DEFAULT_DRIVERSHUB_COMPLETE_JOB_URL;
}

function isJobDeliveryEnabled() {
  return String(loadEnv().values.ENABLE_JOB_DELIVERY || "").toLowerCase() === "true";
}

function getJobDeliveryTarget() {
  return getConfiguredDriversHubCompleteJobUrl();
}

function getConfiguredDriverSteamId() {
  const env = loadEnv().values;
  return firstValue(env.DRIVER_STEAM_ID, env.STEAM_ID, env.TRUCKERSMP_STEAM_ID);
}

function getDetectedTruckersMpSteamId() {
  try {
    return parseTruckersMpLogs().steamId || null;
  } catch {
    return null;
  }
}

function getDriverSteamId(job, activeUser) {
  return firstValue(
    job.driver?.steamID,
    job.driver?.steamId,
    job.driver?.steamid,
    job.steamID,
    job.steamId,
    job.steamid,
    activeUser?.steamID,
    activeUser?.steamId,
    activeUser?.steamid,
    getConfiguredDriverSteamId(),
    getDetectedTruckersMpSteamId()
  );
}

function buildDriversHubCompleteJobPayload(job) {
  const activeUser = getActiveLocalUser();
  const driverSteamId = getDriverSteamId(job, activeUser);
  const driverName = firstValue(
    job.driver?.name,
    job.driver?.displayName,
    job.driverName,
    job.driver_name,
    activeUser?.displayName,
    activeUser?.username,
    activeUser?.name,
    "Local Driver"
  );
  const sourceCity = firstValue(job.source?.city, job.source_city, job.sourceCity, job.from, job.origin, job.start);
  const sourceCompany = firstValue(job.source?.company, job.source_company, job.sourceCompany, job.originCompany);
  const destinationCity = firstValue(job.destination?.city, job.destination_city, job.destinationCity, job.to, job.target, job.end);
  const destinationCompany = firstValue(job.destination?.company, job.destination_company, job.destinationCompany, job.targetCompany);
  const cargoName = textFromValue(firstValue(job.cargo, job.cargoName, job.cargo_name, job.description, job.title)) || "Unknown Cargo";
  const startedAt = firstValue(job.started_at_utc, job.started_at, job.start_time, job.startTime, job.timestamp, job.time);
  const finishedAt = firstValue(job.completed_at, job.finished_at, job.finished_at_utc, job.delivered_at, job.timestamp, job.time, job.storedAt);

  return {
    object: "event",
    type: "job.delivered",
    data: {
      jobID: firstValue(job.truckersHubJobID, job.truckersHubJobId, job.jobID, job.jobId, job.job_id, job.id, job.uuid, job._trackerKey),
      driver: {
        steamID: driverSteamId,
        name: driverName,
        avatar: firstValue(job.driver?.avatar, job.driverAvatar, job.driver_avatar, activeUser?.avatar)
      },
      source: {
        city: objectFromText(sourceCity),
        company: objectFromText(sourceCompany)
      },
      destination: {
        city: objectFromText(destinationCity),
        company: objectFromText(destinationCompany)
      },
      cargo: {
        id: String(firstValue(job.cargo?.id, cargoName.toLowerCase().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, ""), "unknown")),
        name: cargoName,
        mass: parseNumber(firstValue(job.cargo?.mass, job.mass, job.cargo_mass)),
        unit_mass: parseNumber(firstValue(job.cargo?.unit_mass, job.unit_mass, job.unitMass)),
        damage: parseNumber(firstValue(job.cargo?.damage, job.damage, job.cargo_damage, job.cargoDamage, job.damage_percent, job.damagePercent)),
        language: firstValue(job.cargo?.language, "en")
      },
      truck: {
        id: String(firstValue(job.truck?.id, job.truck_id, "unknown")),
        name: String(firstValue(job.truck?.name, job.truckName, job.truck_name, "unknown")),
        model: {
          id: String(firstValue(job.truck?.model?.id, job.truckModelId, "unknown")),
          name: String(firstValue(job.truck?.model?.name, job.truckModel, job.truck_model, job.truck?.name, "unknown"))
        },
        ownTruck: true
      },
      topSpeed: parseNumber(firstValue(job.topSpeed, job.top_speed, job.maxSpeed, job.max_speed)),
      avgSpeed: parseNumber(firstValue(job.avgSpeed, job.avg_speed, job.averageSpeed, job.average_speed)),
      income: parseNumber(firstValue(job.income, job.revenue, job.earnings, job.money)),
      distanceDriven: parseNumber(firstValue(job.distanceDriven, job.distance, job.distance_km, job.distanceKm, job.km)),
      plannedDistance: parseNumber(firstValue(job.plannedDistance, job.planned_distance_km, job.distance, job.distance_km, job.distanceKm, job.km)),
      fuel: {
        current: parseNumber(firstValue(job.fuel?.current, job.fuel_current)),
        burned: parseNumber(firstValue(job.fuel?.burned, job.fuel_burned, job.fuel)),
        purchased: parseNumber(firstValue(job.fuel?.purchased, job.fuel_purchased))
      },
      realtime: {
        start: startedAt || finishedAt || new Date().toISOString(),
        end: finishedAt || startedAt || new Date().toISOString()
      }
    }
  };
}

function createJobDeliveryRecord(job, existing = null) {
  const key = job._trackerKey || getJobKey(job);
  return {
    id: key,
    jobKey: key,
    jobId: firstValue(job.id, job.job_id, job.jobId, job.uuid, key),
    status: existing?.status || "pending",
    attempts: existing?.attempts || 0,
    targetUrl: getJobDeliveryTarget(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: existing?.updatedAt || new Date().toISOString(),
    sentAt: existing?.sentAt || null,
    lastAttemptAt: existing?.lastAttemptAt || null,
    lastError: existing?.lastError || null,
    responseStatus: existing?.responseStatus || null,
    responseData: existing?.responseData || null,
    job,
    payload: buildDriversHubCompleteJobPayload(job)
  };
}

async function sendJobDelivery(record, targetUrl = getJobDeliveryTarget()) {
  const payload = buildDriversHubCompleteJobPayload(record.job || {});
  const nextRecord = {
    ...record,
    payload,
    targetUrl,
    status: "sending",
    attempts: (record.attempts || 0) + 1,
    lastAttemptAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastError: null
  };

  if (!payload.data?.driver?.steamID) {
    return {
      ...nextRecord,
      status: "failed",
      updatedAt: new Date().toISOString(),
      responseStatus: null,
      responseData: null,
      lastError: "Missing driver Steam ID. Add DRIVER_STEAM_ID in Account settings, then resend."
    };
  }

  try {
    const response = await axios.post(targetUrl, payload, {
      timeout: LIVE_API_TIMEOUT_MS,
      headers: {
        ...authHeadersFromEnv(loadEnv().values),
        "Content-Type": "application/json"
      }
    });

    return {
      ...nextRecord,
      status: "sent",
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      responseStatus: response.status,
      responseData: response.data,
      lastError: null
    };
  } catch (error) {
    return {
      ...nextRecord,
      status: "failed",
      updatedAt: new Date().toISOString(),
      responseStatus: error.response?.status || null,
      responseData: error.response?.data || null,
      lastError: error.response?.data?.error || error.response?.data?.message || error.message || "Delivery failed"
    };
  }
}

async function upsertAndSendJobDeliveries(jobs) {
  if (!Array.isArray(jobs) || !jobs.length) {
    return loadJobDeliveries();
  }

  const current = loadJobDeliveries();
  const deliveryMap = new Map(current.deliveries.map((delivery) => [delivery.jobKey || delivery.id, delivery]));
  const pendingRecords = [];

  jobs.forEach((job) => {
    const key = job._trackerKey || getJobKey(job);
    const existing = deliveryMap.get(key);
    if (existing?.status === "sent") {
      deliveryMap.set(key, createJobDeliveryRecord(job, existing));
      return;
    }

    const record = createJobDeliveryRecord(job, existing);
    deliveryMap.set(key, record);
    if (!existing || existing.status === "pending") {
      pendingRecords.push(record);
    }
  });

  saveJobDeliveries(Array.from(deliveryMap.values()).slice(-500));

  for (const record of pendingRecords) {
    const sentRecord = await sendJobDelivery(record);
    deliveryMap.set(record.jobKey, sentRecord);
    saveJobDeliveries(Array.from(deliveryMap.values()).slice(-500));
  }

  return loadJobDeliveries();
}

async function resendJobDelivery(jobKey) {
  const current = loadJobDeliveries();
  const index = current.deliveries.findIndex((delivery) => String(delivery.jobKey || delivery.id) === String(jobKey));
  let record = index >= 0 ? current.deliveries[index] : null;

  if (!record) {
    const job = loadJobs().jobs.find((entry) => String(entry._trackerKey || getJobKey(entry)) === String(jobKey));
    if (!job) {
      throw new Error("Job delivery record was not found.");
    }
    record = createJobDeliveryRecord(job);
    current.deliveries.push(record);
  }

  const sentRecord = await sendJobDelivery(createJobDeliveryRecord(record.job || {}, record));
  const nextDeliveries = current.deliveries.map((delivery) => (
    String(delivery.jobKey || delivery.id) === String(sentRecord.jobKey) ? sentRecord : delivery
  ));
  if (!nextDeliveries.some((delivery) => String(delivery.jobKey || delivery.id) === String(sentRecord.jobKey))) {
    nextDeliveries.push(sentRecord);
  }
  saveJobDeliveries(nextDeliveries.slice(-500));
  return sentRecord;
}

function shouldStoreJob(job) {
  if (isFinishedJob(job)) {
    return true;
  }

  const type = String(firstValue(job.type, job.status, job.event, job.state) || "").toLowerCase();
  const loadedFlag = firstValue(job.cargo_loaded, job.cargoLoaded, job.loaded);
  if (type.includes("start") || loadedFlag !== undefined) {
    return false;
  }

  if (isActiveJob(job)) {
    return false;
  }

  const hasPayment = firstValue(job.income, job.revenue, job.earnings, job.money) !== undefined;
  const hasDistance = firstValue(job.distance, job.distance_km, job.distanceKm, job.planned_distance_km, job.km) !== undefined;
  return hasPayment && hasDistance;
}

function collectTrackerJobs(snapshot) {
  return [
    snapshot?.jobs,
    snapshot?.completed_jobs,
    snapshot?.completedJobs,
    snapshot?.job_history,
    snapshot?.jobHistory,
    snapshot?.history
  ].find(Array.isArray) || [];
}

function persistTrackerJobs(snapshot) {
  const incomingJobs = collectTrackerJobs(snapshot).filter(shouldStoreJob).map(normalizeTrackerJob);
  const current = loadJobs();
  const jobMap = new Map(current.jobs.map((job) => [job._trackerKey || getJobKey(job), job]));

  incomingJobs.forEach((job) => {
    const key = getJobKey(job);
    jobMap.set(key, {
      ...jobMap.get(key),
      ...job,
      _trackerKey: key,
      storedAt: jobMap.get(key)?.storedAt || new Date().toISOString()
    });
  });

  const jobs = Array.from(jobMap.values()).slice(-500);
  saveJobs(jobs);
  if (isJobDeliveryEnabled()) {
    upsertAndSendJobDeliveries(incomingJobs).catch((error) => {
      appendDiscordPresenceLog("job delivery persistence failed", { message: error.message });
    });
  }
  return jobs;
}

function saveEnv(values) {
  const envPath = resolveEnvPath();
  const currentValues = loadEnv().values;
  const nextValues = mergeEnvValues(currentValues, values || {});
  const content = serializeEnv(nextValues);
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, content, "utf8");
  applyOverlaySettings(nextValues);
  return { path: envPath, values: nextValues };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  response.end(JSON.stringify(payload));
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Telemetry payload is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function startLiveReceiver() {
  if (liveReceiverServer) {
    return;
  }

  liveReceiverServer = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${LIVE_RECEIVER_PORT}`);

    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    if (request.method === "GET" && ["/", "/api/live", "/api/telemetry", "/api/online-drivers"].includes(url.pathname)) {
      sendJson(response, 200, {
        success: true,
        updatedAt: receivedLiveTelemetry?.updatedAt || null,
        telemetry: receivedLiveTelemetry?.data || null
      });
      return;
    }

    if (request.method === "POST" && ["/api/live", "/api/telemetry", "/live", "/telemetry"].includes(url.pathname)) {
      try {
        const data = await readRequestJson(request);
        receivedLiveTelemetry = {
          updatedAt: new Date().toISOString(),
          data
        };
        sendJson(response, 200, { success: true, updatedAt: receivedLiveTelemetry.updatedAt });
      } catch (error) {
        sendJson(response, 400, { success: false, error: error.message });
      }
      return;
    }

    sendJson(response, 404, { success: false, error: "Not found" });
  });

  liveReceiverServer.on("connection", (socket) => {
    liveReceiverSockets.add(socket);
    socket.on("close", () => {
      liveReceiverSockets.delete(socket);
    });
  });

  liveReceiverServer.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      appendDiscordPresenceLog("live receiver port already in use", {
        port: LIVE_RECEIVER_PORT,
        message: error.message
      });
      liveReceiverServer = null;
      return;
    }

    appendDiscordPresenceLog("live receiver error", {
      code: error.code,
      message: error.message
    });
  });

  liveReceiverServer.listen(LIVE_RECEIVER_PORT, "127.0.0.1");
}

async function fetchTracker() {
  const url = `${API_URL}/api/jobs`;
  const response = await axios.get(url, { timeout: TRACKER_JOBS_TIMEOUT_MS });
  return parseTrackerPayload(response.data);
}

async function refreshPersistedTrackerJobs() {
  if (trackerPersistenceInFlight) {
    return;
  }

  trackerPersistenceInFlight = true;
  try {
    const data = await fetchTracker();
    persistTrackerJobs(data);
  } catch (error) {
    // The game/plugin is often offline; persistence resumes automatically.
  } finally {
    trackerPersistenceInFlight = false;
  }
}

function startTrackerPersistenceLoop() {
  if (trackerPersistenceTimer) {
    return;
  }

  refreshPersistedTrackerJobs();
  trackerPersistenceTimer = setInterval(refreshPersistedTrackerJobs, 5000);
}

function getDiscordIpcPath(index) {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\discord-ipc-${index}`;
  }

  const basePath = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
  return path.join(basePath, `discord-ipc-${index}`);
}

function setDiscordPresenceState(nextState) {
  discordPresenceState = {
    ...discordPresenceState,
    ...nextState,
    updatedAt: new Date().toISOString()
  };
  appendDiscordPresenceLog("state", discordPresenceState);

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send("discord-presence-status", discordPresenceState);
  });
}

function getDiscordPresenceState() {
  return discordPresenceState;
}

function getDiscordPresenceLog() {
  try {
    const logPath = path.join(app.getPath("userData"), "discord-presence.log");
    if (!fs.existsSync(logPath)) {
      return { path: logPath, lines: [] };
    }

    const lines = fs.readFileSync(logPath, "utf8").trim().split(/\r?\n/).filter(Boolean).slice(-30);
    return { path: logPath, lines };
  } catch (error) {
    return { path: null, lines: [], error: error.message };
  }
}

function parseTruckersMpLogContent(content) {
  const result = {};
  const lines = String(content || "").split(/\r?\n/).slice(-1200);
  const clearServerState = () => {
    delete result.serverName;
    delete result.serverAddress;
    delete result.playerNumber;
  };
  const serverPatterns = [
    /\bconnected to server\s+["']?([^"'\r\n]+)/i,
    /\bconnecting to server\s+["']?([^"'\r\n]+)/i,
    /\bserver\s*[:=]\s*["']?([^"'\r\n]+)/i,
    /\bselected server\s*[:=]\s*["']?([^"'\r\n]+)/i,
    /\bjoin(?:ing|ed)\s+server\s+["']?([^"'\r\n]+)/i
  ];
  const playerPatterns = [
    /\b(?:tmp|truckersmp|player|server|session|in-?game)\s*(?:id|number)\s*[:=#-]?\s*#?(\d{1,6})\b/i,
    /\byour\s+(?:id|number)\s*(?:is|:)\s*#?(\d{1,6})\b/i,
    /\bassigned\s+(?:id|number)\s*[:=#-]?\s*#?(\d{1,6})\b/i
  ];
  const steamIdPatterns = [
    /\bSteamID\s*:\s*(\d{16,20})\b/i,
    /\bSteam\s+ID\s*:\s*(\d{16,20})\b/i,
    /\bsteamid64\s*[:=]\s*(\d{16,20})\b/i
  ];
  const addressPatterns = [
    /\[net\]\s+Connecting to\s+([\w.-]+:\d+)/i,
    /\bConnecting to\s+([\w.-]+:\d+)/i,
    /\bserver address\s*[:=]\s*([\w.-]+:\d+)/i
  ];

  for (const line of lines) {
    const normalized = line.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }

    if (/^\*+\s+Log started on:/i.test(normalized)) {
      Object.keys(result).forEach((key) => delete result[key]);
      result.active = true;
      result.phase = "starting";
      result.phaseText = "Starting TruckersMP";
    }

    if (/\b(disconnecting|disconnected|connection closed|left the server|offline mode|shutdown successfully)\b/i.test(normalized)) {
      clearServerState();
      result.active = true;
      result.phase = "server";
      result.phaseText = "Selecting Server";
    }

    if (/\[client\]\s+Deinitialized successfully|\[net\]\s+Deinitialized successfully/i.test(normalized)) {
      clearServerState();
      result.active = false;
      result.phase = "offline";
      result.phaseText = null;
    }

    if (/\bClient:\s+(ETS2MP|ATSMP)\b/i.test(normalized) || /\[client\]\s+Initialized successfully/i.test(normalized)) {
      clearServerState();
      result.active = true;
      result.phase = "starting";
      result.phaseText = "Starting TruckersMP";
    }

    if (/\[client\]\s+Game started/i.test(normalized)) {
      clearServerState();
      result.active = true;
      result.phase = "profile";
      result.phaseText = "Selecting Profile";
    }

    if (/\[client\]\s+SteamID:/i.test(normalized) || /\[client\]\s+(Initializing gameplay|Finished initializing gameplay)/i.test(normalized) || /\[net\]\s+Initialized successfully/i.test(normalized)) {
      clearServerState();
      result.active = true;
      result.phase = "server";
      result.phaseText = "Selecting Server";
    }

    if (/\b(connected|connecting|joined)\b/i.test(normalized) && /\b(server|simulation|arcade|promods)\b/i.test(normalized)) {
      result.active = true;
    }

    if (/\[net\]\s+Connection successfully established/i.test(normalized)) {
      result.active = true;
      result.phase = "connected";
      result.phaseText = "Connected";
    }

    const queueMatch = normalized.match(/\[net\]\s+Placed to the queue\.\s+Position in queue:\s+(\d+)/i);
    if (queueMatch?.[1]) {
      result.active = true;
      result.phase = "queue";
      result.phaseText = `In Queue: ${queueMatch[1]}`;
    }

    for (const pattern of steamIdPatterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        result.steamId = match[1];
        break;
      }
    }

    for (const pattern of serverPatterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        result.serverName = match[1]
          .replace(/\s*\(.*$/, "")
          .replace(/[.;,]$/, "")
          .trim();
        result.active = true;
        break;
      }
    }

    for (const pattern of addressPatterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        result.serverAddress = match[1].trim();
        result.active = true;
        result.phase = "connecting";
        result.phaseText = "Connecting to Server";
        break;
      }
    }

    const namedServer = normalized.match(/\b(Simulation\s*\d+|Arcade\s*\d+|ProMods(?:\s+\w+)?\s*\d*)\b/i);
    if (namedServer?.[1]) {
      result.serverName = namedServer[1].replace(/\s+/g, " ").trim();
      result.active = true;
    }

    for (const pattern of playerPatterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        result.playerNumber = match[1];
        break;
      }
    }
  }

  return result;
}

function getRecentTruckersMpLogFiles() {
  const documentsPath = app.getPath("documents");
  const logDirs = [
    path.join(documentsPath, "ETS2MP", "logs"),
    path.join(documentsPath, "ATSMP", "logs")
  ];
  const cutoff = Date.now() - TRUCKERSMP_LOG_MAX_AGE_MS;
  const files = [];

  for (const logDir of logDirs) {
    try {
      if (!fs.existsSync(logDir)) {
        continue;
      }

      fs.readdirSync(logDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^client_.*(?:_log\.txt|\.log)$/i.test(entry.name))
        .forEach((entry) => {
          const filePath = path.join(logDir, entry.name);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs >= cutoff) {
            files.push({ path: filePath, mtimeMs: stat.mtimeMs });
          }
        });
    } catch {
      // Missing or locked TruckersMP log folders are fine.
    }
  }

  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, TRUCKERSMP_LOG_CANDIDATE_LIMIT);
}

function parseTruckersMpLogs() {
  const logFiles = getRecentTruckersMpLogFiles();
  const result = { source: null, active: false };

  for (const file of logFiles.slice().reverse()) {
    try {
      const content = fs.readFileSync(file.path, "utf8");
      const parsed = parseTruckersMpLogContent(content);
      const parsedCanShowServer = ["connecting", "queue", "connected"].includes(parsed.phase);
      if (!parsedCanShowServer || !parsed.serverName) {
        delete result.serverName;
      }
      if (!parsedCanShowServer || !parsed.serverAddress) {
        delete result.serverAddress;
      }
      if (!parsedCanShowServer || !parsed.playerNumber) {
        delete result.playerNumber;
      }
      Object.assign(result, parsed, {
        source: file.path,
        logUpdatedAt: new Date(file.mtimeMs).toISOString()
      });
    } catch {
      // Ignore individual unreadable log files and keep checking the others.
    }
  }

  return result;
}

function normalizeServerAddress(value) {
  const match = String(value || "").trim().match(/^(.+):(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    host: match[1].toLowerCase(),
    port: Number(match[2]),
    value: `${match[1].toLowerCase()}:${Number(match[2])}`
  };
}

function getTruckersMpServersFromPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.response)) {
    return payload.response;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (payload?.data && typeof payload.data === "object") {
    return getTruckersMpServersFromPayload(payload.data);
  }

  return [];
}

async function fetchTruckersMpServers() {
  const now = Date.now();
  if (now - truckersMpServersCache.checkedAt < TRUCKERSMP_SERVERS_CACHE_MS) {
    return truckersMpServersCache.servers;
  }

  const env = loadEnv().values;
  const url = env.TRUCKERSMP_SERVERS_URL || DEFAULT_TRUCKERSMP_SERVERS_URL;
  try {
    const response = await axios.get(url, { timeout: LIVE_API_TIMEOUT_MS });
    const servers = getTruckersMpServersFromPayload(response.data);
    truckersMpServersCache = { checkedAt: now, servers };
    return servers;
  } catch {
    truckersMpServersCache = { checkedAt: now, servers: [] };
    return [];
  }
}

async function resolveTruckersMpServer(serverAddress) {
  const address = normalizeServerAddress(serverAddress);
  if (!address) {
    return null;
  }

  const servers = await fetchTruckersMpServers();
  const portCandidates = new Set([address.port, address.port - 1, address.port + 1]);
  return servers.find((server) => {
    const serverHost = String(firstValue(server.ip, server.host, server.address) || "").toLowerCase();
    const serverPort = Number(firstValue(server.port, server.game_port, server.gamePort));
    return serverHost === address.host && portCandidates.has(serverPort);
  }) || null;
}

async function getTruckersMpProcesses() {
  if (process.platform !== "win32") {
    return [];
  }

  const script = `
Get-Process | Where-Object {
  $_.ProcessName -match 'truckersmp|launcher|eurotrucks2|amtrucks'
} | Select-Object ProcessName, MainWindowTitle | ConvertTo-Json -Compress
`;

  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 1200,
      windowsHide: true
    });
    const parsed = JSON.parse(String(stdout || "[]"));
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return [];
  }
}

async function detectTruckersMp() {
  const now = Date.now();
  if (truckersMpCache.result && now - truckersMpCache.checkedAt < TRUCKERSMP_CACHE_MS) {
    return truckersMpCache.result;
  }

  const [processes, logInfo] = await Promise.all([
    getTruckersMpProcesses(),
    Promise.resolve(parseTruckersMpLogs())
  ]);
  const processText = processes
    .map((item) => `${item.ProcessName || ""} ${item.MainWindowTitle || ""}`)
    .join(" ")
    .toLowerCase();
  const truckersMpProcess = processes.find((item) => /truckersmp/i.test(String(item.ProcessName || item.MainWindowTitle || "")));
  const truckersMpGameProcess = processes.find((item) => {
    const processName = String(item.ProcessName || "").toLowerCase();
    const title = String(item.MainWindowTitle || "").toLowerCase();
    return /^(eurotrucks2|amtrucks)$/.test(processName) && title.includes("truckersmp");
  });
  const active = Boolean(logInfo.active || truckersMpGameProcess);
  const canShowServer = ["connecting", "queue", "connected"].includes(logInfo.phase);
  const resolvedServer = canShowServer && !logInfo.serverName ? await resolveTruckersMpServer(logInfo.serverAddress) : null;
  const resolvedServerName = textFromValue(firstValue(resolvedServer?.name, resolvedServer?.shortname, resolvedServer?.shortName));
  const result = {
    active,
    detected: active || Boolean(truckersMpProcess || processText.includes("truckersmp") || logInfo.serverName || logInfo.serverAddress || logInfo.playerNumber || logInfo.source),
    serverName: canShowServer ? logInfo.serverName || resolvedServerName || null : null,
    serverId: firstValue(resolvedServer?.id, resolvedServer?.server_id, resolvedServer?.serverId) || null,
    serverType: resolvedServer?.event || resolvedServer?.specialEvent ? "event" : resolvedServer ? "public" : null,
    serverAddress: canShowServer ? logInfo.serverAddress || null : null,
    playerNumber: canShowServer ? logInfo.playerNumber || null : null,
    steamId: logInfo.steamId || null,
    phase: logInfo.phase || null,
    phaseText: logInfo.phaseText || null,
    processName: truckersMpProcess?.ProcessName || null,
    source: logInfo.source,
    logUpdatedAt: logInfo.logUpdatedAt || null,
    updatedAt: new Date().toISOString()
  };

  truckersMpCache = { checkedAt: now, result };
  return result;
}

function writeDiscordRpc(socket, opcode, payload) {
  appendDiscordPresenceLog("send", { opcode, payload });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode, 0);
  header.writeInt32LE(body.length, 4);
  socket.write(Buffer.concat([header, body]));
}

function getTruckBrandKey(truck) {
  const text = String(truck || "").toLowerCase();
  const brandMap = [
    ["mercedes", "brand_mercedes_benz"],
    ["freightliner", "brand_freightliner"],
    ["international", "brand_international"],
    ["western star", "brand_western_star"],
    ["kenworth", "brand_kenworth"],
    ["peterbilt", "brand_peterbilt"],
    ["scania", "brand_scania"],
    ["volvo", "brand_volvo"],
    ["renault", "brand_renault"],
    ["iveco", "brand_iveco"],
    ["mack", "brand_mack"],
    ["daf", "brand_daf"],
    ["man", "brand_man"]
  ];
  return brandMap.find(([brand]) => text.includes(brand))?.[1] || "logo";
}

function truncatePresenceText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function buildDiscordPresenceButtons(env) {
  return [
    {
      label: env.DISCORD_RPC_BUTTON_LABEL || "Jastuk VTC",
      url: env.DISCORD_RPC_BUTTON_URL || "https://hub.jastukvtc.com"
    },
    {
      label: env.DISCORD_RPC_SECOND_BUTTON_LABEL || "Apply Today",
      url: env.DISCORD_RPC_SECOND_BUTTON_URL || "https://truckersmp.com/vtc/88850"
    }
  ]
    .filter((button) => button.label && /^https?:\/\//i.test(String(button.url || "")))
    .slice(0, 2);
}

function getRawLivePayload(raw) {
  return parseTrackerPayload(raw?.telemetryApi?.live) ||
    parseTrackerPayload(raw?.telemetryApi?.telemetry) ||
    parseTrackerPayload(raw?.endpoints?.["/api/live"]) ||
    parseTrackerPayload(raw?.endpoints?.["/api/telemetry"]) ||
    parseTrackerPayload(raw) ||
    {};
}

function buildDiscordActivity(driver) {
  const env = loadEnv().values;
  const rawLive = getRawLivePayload(driver.raw);
  const rawTruck = rawLive?.truck || {};
  const rawTruckName = findTruckName(rawTruck);
  const rawSpeed = firstValue(rawTruck.speed_kmh, rawTruck.speedKmh, rawTruck.speed?.kmh, rawTruck.speed?.kph);
  const rawSpeedMps = firstValue(rawTruck.speed_mps, rawTruck.speedMps);
  const truckersMp = driver.truckersmp || {};
  const truckersMpParts = [
    truckersMp.serverName || truckersMp.serverAddress,
    truckersMp.playerNumber ? `#${truckersMp.playerNumber}` : null
  ].filter(Boolean);
  const isTruckersMpConnected = !truckersMp.active || truckersMp.phase === "connected";
  const truckersMpText = truckersMp.active && isTruckersMpConnected
    ? `TruckersMP${truckersMpParts.length ? `: ${truckersMpParts.join(" ")}` : ""}`
    : truckersMp.active
      ? "TruckersMP"
    : null;
  const speedNumber = Number(firstValue(
    driver.speed,
    rawSpeed,
    rawSpeedMps !== undefined ? Number(rawSpeedMps) * 3.6 : undefined
  ));
  const speedText = Number.isFinite(speedNumber)
    ? `${Math.round(speedNumber)} KM/H`
    : null;
  const truckName = firstValue(driver.truck, rawTruckName);
  const knownTruck = truckName && truckName !== "Unknown truck" && truckName !== "-";
  const truck = knownTruck ? truckName : "Jastuk Tracker";
  const city = driver.city && driver.city !== "Unknown city" ? driver.city : null;
  const status = driver.status || "Connected";
  const phaseDetails = ["profile", "server", "queue", "connecting", "starting"].includes(truckersMp.phase)
    ? truckersMp.phaseText
    : null;
  const details = phaseDetails || (speedText && speedNumber > 0
    ? knownTruck ? `Driving ${truck}` : "Driving"
    : status === "On job"
      ? knownTruck ? `On job with ${truck}` : "On job"
      : `Parked${city ? ` in ${city}` : ""}`);
  const route = driver.route || [
    driver.jobStops?.source,
    driver.jobStops?.destination
  ].filter(Boolean).join(" -> ");
  const stateParts = [
    truckersMpText,
    isTruckersMpConnected ? route || driver.cargo || city || "Live with Jastuk Tracker" : null,
    isTruckersMpConnected && driver.distance ? `${driver.distance} left` : null,
    isTruckersMpConnected && speedText ? speedText : null
  ].filter(Boolean);

  const activity = {
    details: truncatePresenceText(details, 128),
    state: truncatePresenceText(stateParts.join(" | "), 128),
    timestamps: {
      start: discordPresenceStartedAt
    },
    instance: false
  };

  if (!discordPresenceSafeMode) {
    activity.assets = {
      large_image: env.DISCORD_RPC_LARGE_IMAGE || "logo",
      large_text: "Jastuk Tracker",
      small_image: env.DISCORD_RPC_BRAND_IMAGE || getTruckBrandKey(truck),
      small_text: truncatePresenceText(truck, 128)
    };
    const buttons = buildDiscordPresenceButtons(env);
    if (buttons.length) {
      activity.buttons = buttons;
    }
  }

  return activity;
}

async function updateDiscordPresence() {
  if (discordPresenceStopping) {
    return;
  }

  if (!discordPresenceReady || !discordPresenceSocket || discordPresenceSocket.destroyed) {
    setDiscordPresenceState({
      status: "waiting",
      message: "Waiting for Discord RPC connection.",
      clientId: discordPresenceConnectedClientId,
      error: null
    });
    return;
  }

  try {
    const data = await fetchLiveTrackerSnapshot({
      endpoints: ["/api/telemetry", "/api/live", "/api/jobs"],
      timeout: LOCAL_TRACKER_TIMEOUT_MS
    });
    data.polledAt = new Date().toISOString();
    data.truckersmp = await detectTruckersMp();
    const driver = normalizeLiveDriver(data);
    const activity = buildDiscordActivity(driver);
    const serialized = JSON.stringify(activity);
    if (serialized === discordPresenceLastActivity) {
      return;
    }

    discordPresenceLastActivity = serialized;
    writeDiscordRpc(discordPresenceSocket, 1, {
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid,
        activity
      },
      nonce: crypto.randomUUID()
    });
    setDiscordPresenceState({
      status: "sent",
      message: `${activity.details} - ${activity.state}`,
      clientId: discordPresenceConnectedClientId,
      activityVersion: DISCORD_RPC_ACTIVITY_VERSION,
      error: null
    });
  } catch {
    const truckersmp = await detectTruckersMp();
    const fallbackActivity = buildDiscordActivity({
      status: truckersmp.active ? "On TruckersMP" : "Waiting for telemetry",
      truck: "Jastuk Tracker",
      game: "ETS2 / ATS",
      truckersmp
    });
    writeDiscordRpc(discordPresenceSocket, 1, {
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid,
        activity: fallbackActivity
      },
      nonce: crypto.randomUUID()
    });
    setDiscordPresenceState({
      status: "sent",
      message: `${fallbackActivity.details} - ${fallbackActivity.state}`,
      clientId: discordPresenceConnectedClientId,
      activityVersion: DISCORD_RPC_ACTIVITY_VERSION,
      error: null
    });
  }
}

function sendDiscordPresenceTest() {
  startDiscordPresence();
  const env = loadEnv().values;
  if (!discordPresenceReady || !discordPresenceSocket || discordPresenceSocket.destroyed) {
    setDiscordPresenceState({
      status: "waiting",
      message: "Discord RPC is not ready yet. Try again in a few seconds.",
      clientId: discordPresenceConnectedClientId || env.DISCORD_RPC_CLIENT_ID || env.DISCORD_CLIENT_ID,
      error: null
    });
    return getDiscordPresenceState();
  }

  discordPresenceSafeMode = false;
  discordPresenceLastActivity = "";
  const activity = {
    details: "Jastuk Tracker test",
    state: "Rich Presence is connected",
    timestamps: {
      start: Math.floor(Date.now() / 1000)
    },
    assets: {
      large_image: env.DISCORD_RPC_LARGE_IMAGE || "logo",
      large_text: "Jastuk Tracker"
    },
    instance: false
  };
  writeDiscordRpc(discordPresenceSocket, 1, {
    cmd: "SET_ACTIVITY",
    args: {
      pid: process.pid,
      activity
    },
    nonce: crypto.randomUUID()
  });
  setDiscordPresenceState({
    status: "sent",
    message: "Sent test Rich Presence from the app process.",
    clientId: discordPresenceConnectedClientId,
    error: null
  });
  return getDiscordPresenceState();
}

function scheduleDiscordPresenceReconnect() {
  if (discordPresenceStopping) {
    return;
  }

  if (discordPresenceReconnectTimer) {
    return;
  }

  discordPresenceReconnectTimer = setTimeout(() => {
    discordPresenceReconnectTimer = null;
    startDiscordPresence();
  }, DISCORD_RPC_RECONNECT_MS);
}

function connectDiscordIpc(clientId, index = 0) {
  if (index > 9) {
    setDiscordPresenceState({
      status: "offline",
      message: "Discord is not reachable. Open Discord Desktop and enable activity status.",
      clientId,
      error: "No discord-ipc pipe found."
    });
    scheduleDiscordPresenceReconnect();
    return;
  }

  setDiscordPresenceState({
    status: "connecting",
    message: `Connecting to Discord RPC pipe ${index}...`,
    clientId,
    error: null
  });
  const socket = net.createConnection(getDiscordIpcPath(index));
  let buffer = Buffer.alloc(0);

  socket.on("connect", () => {
    discordPresenceSocket = socket;
    discordPresenceConnectedClientId = clientId;
    setDiscordPresenceState({
      status: "handshake",
      message: "Connected to Discord. Sending Rich Presence handshake...",
      clientId,
      error: null
    });
    writeDiscordRpc(socket, 0, { v: 1, client_id: clientId });
  });

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
      const opcode = buffer.readInt32LE(0);
      const length = buffer.readInt32LE(4);
      if (buffer.length < 8 + length) {
        return;
      }

      let payload = {};
      try {
        payload = JSON.parse(buffer.slice(8, 8 + length).toString("utf8"));
      } catch {
        payload = {};
      }
      appendDiscordPresenceLog("receive", { opcode, payload });
      buffer = buffer.slice(8 + length);
      if (opcode === 1 && payload.evt === "READY") {
        discordPresenceReady = true;
        discordPresenceStartedAt = Math.floor(Date.now() / 1000);
        setDiscordPresenceState({
          status: "ready",
          message: "Discord Rich Presence is ready.",
          clientId,
          error: null
        });
        updateDiscordPresence();
      } else if (opcode === 1 && (payload.evt === "ERROR" || payload.cmd === "SET_ACTIVITY")) {
        const errorMessage = payload.data?.message || payload.data?.error || payload.message || null;
        if (errorMessage) {
          const shouldRetryMinimal = !discordPresenceSafeMode;
          discordPresenceSafeMode = true;
          if (shouldRetryMinimal) {
            discordPresenceLastActivity = "";
          }
          setDiscordPresenceState({
            status: "error",
            message: shouldRetryMinimal
              ? "Discord rejected the full Rich Presence payload. Retrying without images/buttons."
              : "Discord rejected the Rich Presence payload.",
            clientId,
            error: errorMessage
          });
          if (shouldRetryMinimal) {
            updateDiscordPresence();
          }
        }
      }
    }
  });

  socket.on("error", (error) => {
    if (discordPresenceSocket === socket) {
      discordPresenceSocket = null;
    }
    socket.destroy();
    if (discordPresenceStopping) {
      return;
    }

    if (index < 9) {
      connectDiscordIpc(clientId, index + 1);
    } else {
      setDiscordPresenceState({
        status: "offline",
        message: "Discord is not reachable. Open Discord Desktop and enable activity status.",
        clientId,
        error: error.message
      });
      scheduleDiscordPresenceReconnect();
    }
  });

  socket.on("close", () => {
    if (discordPresenceSocket === socket) {
      discordPresenceSocket = null;
      discordPresenceReady = false;
      discordPresenceLastActivity = "";
      if (discordPresenceStopping) {
        return;
      }

      setDiscordPresenceState({
        status: "disconnected",
        message: "Discord RPC disconnected. Reconnecting...",
        clientId,
        error: null
      });
      scheduleDiscordPresenceReconnect();
    }
  });
}

function startDiscordPresence() {
  discordPresenceStopping = false;
  const env = loadEnv().values;
  const clientId = env.DISCORD_RPC_CLIENT_ID || env.DISCORD_CLIENT_ID;
  if (!clientId) {
    setDiscordPresenceState({
      status: "disabled",
      message: "Discord client ID is missing.",
      clientId: null,
      error: "Set DISCORD_CLIENT_ID or DISCORD_RPC_CLIENT_ID."
    });
    return;
  }

  if (discordPresenceSocket || discordPresenceConnectedClientId === clientId && discordPresenceReady) {
    return;
  }

  connectDiscordIpc(clientId);
  if (!discordPresenceTimer) {
    updateDiscordPresence();
    discordPresenceTimer = setInterval(updateDiscordPresence, DISCORD_RPC_UPDATE_MS);
  }
}

function stopDiscordPresence() {
  discordPresenceStopping = true;

  if (discordPresenceTimer) {
    clearInterval(discordPresenceTimer);
    discordPresenceTimer = null;
  }

  if (discordPresenceReconnectTimer) {
    clearTimeout(discordPresenceReconnectTimer);
    discordPresenceReconnectTimer = null;
  }

  const socket = discordPresenceSocket;
  if (socket && !socket.destroyed) {
    try {
      writeDiscordRpc(socket, 1, {
        cmd: "SET_ACTIVITY",
        args: {
          pid: process.pid,
          activity: null
        },
        nonce: crypto.randomUUID()
      });
    } catch {
      // The app is already shutting down; clearing presence is best-effort.
    }

    try {
      socket.end();
    } catch {
      socket.destroy();
    }
  }

  discordPresenceSocket = null;
  discordPresenceReady = false;
  discordPresenceLastActivity = "";
  setDiscordPresenceState({
    status: "stopped",
    message: "Discord Rich Presence stopped.",
    clientId: discordPresenceConnectedClientId,
    error: null
  });
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

async function fetchOptionalTrackerEndpoint(endpoint, timeout = LOCAL_TRACKER_TIMEOUT_MS) {
  const response = await axios.get(`${API_URL}${endpoint}`, { timeout });
  return parseTrackerPayload(response.data);
}

async function fetchLiveTrackerSnapshot(options = {}) {
  const endpoints = options.endpoints || ["/api/telemetry", "/api/jobs", "/api/live"];
  const timeout = options.timeout || LOCAL_TRACKER_TIMEOUT_MS;
  const results = await Promise.allSettled(endpoints.map((endpoint) => fetchOptionalTrackerEndpoint(endpoint, timeout)));
  const successful = results
    .map((result, index) => result.status === "fulfilled" ? { endpoint: endpoints[index], data: result.value } : null)
    .filter(Boolean);

  if (receivedLiveTelemetry) {
    successful.unshift({ endpoint: "electron-receiver", data: parseTrackerPayload(receivedLiveTelemetry.data) });
  }

  if (!successful.length) {
    if (lastLiveTrackerSnapshot && Date.now() - lastLiveTrackerSnapshot.cachedAt <= LOCAL_TRACKER_STALE_GRACE_MS) {
      return {
        ...lastLiveTrackerSnapshot.snapshot,
        stale: true,
        staleReason: errorToMessage(results.find((result) => result.status === "rejected")?.reason),
        cachedAt: new Date(lastLiveTrackerSnapshot.cachedAt).toISOString()
      };
    }

    const firstError = results.find((result) => result.status === "rejected")?.reason;
    throw firstError || new Error("Local tracker API is not reachable.");
  }

  const snapshot = successful.reduce((snapshot, entry) => {
    snapshot.endpoints[entry.endpoint] = entry.data;
    if (entry.endpoint === "/api/jobs") {
      snapshot.jobsApi = entry.data;
    } else if (entry.endpoint === "electron-receiver") {
      snapshot.receiverApi = {
        updatedAt: receivedLiveTelemetry?.updatedAt,
        data: entry.data
      };
    } else {
      snapshot.telemetryApi = {
        ...snapshot.telemetryApi,
        [entry.endpoint.replace("/api/", "")]: entry.data
      };
    }
    return snapshot;
  }, { endpoints: {}, jobsApi: null, telemetryApi: {} });

  lastLiveTrackerSnapshot = {
    cachedAt: Date.now(),
    snapshot
  };

  return snapshot;
}

function readPath(source, paths) {
  for (const pathParts of paths) {
    let value = source;
    for (const part of pathParts) {
      value = value?.[part];
    }

    if (value !== undefined && value !== null && value !== "" && typeof value !== "object") {
      return value;
    }
  }

  return null;
}

function normalizeKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findPrimitiveByKeys(source, keys, depth = 0) {
  if (!source || depth > 8) {
    return null;
  }

  if (Array.isArray(source)) {
    for (const item of source) {
      const found = findPrimitiveByKeys(item, keys, depth + 1);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  if (typeof source !== "object") {
    return null;
  }

  const wanted = new Set(keys.map(normalizeKey));
  for (const [key, value] of Object.entries(source)) {
    if (wanted.has(normalizeKey(key)) && value !== undefined && value !== null && value !== "" && typeof value !== "object") {
      return value;
    }
  }

  for (const value of Object.values(source)) {
    const found = findPrimitiveByKeys(value, keys, depth + 1);
    if (found !== null) {
      return found;
    }
  }

  return null;
}

function findTruckName(source) {
  const displayName = findPrimitiveByKeys(source, ["displayName", "display_name", "truckDisplayName"]);
  if (displayName) {
    return displayName;
  }

  const brand = findPrimitiveByKeys(source, ["truckBrand", "brand", "manufacturer", "make"]);
  const model = findPrimitiveByKeys(source, ["truckName", "truckModel", "modelName", "name", "model"]);
  const parts = [brand, model].filter(Boolean);
  if (parts.length) {
    return [...new Set(parts.map(String))].join(" ");
  }

  const direct = findPrimitiveByKeys(source, ["truckName", "truckModel", "truck", "vehicleName", "vehicleModel", "modelName"]);
  if (direct) {
    return direct;
  }

  return null;
}

function getLiveCoordinate(location, key) {
  if (!location || typeof location !== "object") {
    return null;
  }

  const upperKey = key.toUpperCase();
  const titleKey = key.charAt(0).toUpperCase() + key.slice(1);
  const value = firstValue(
    location[key],
    location[`position${upperKey}`],
    location[`position${titleKey}`],
    location[`coordinate${upperKey}`],
    location[`coordinate${titleKey}`],
    location[`world${upperKey}`],
    location[`world${titleKey}`],
    location[`game${upperKey}`],
    location[`game${titleKey}`]
  );
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeHeadingDegrees(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const degrees = Math.abs(numeric) <= Math.PI * 2 ? numeric * (180 / Math.PI) : numeric;
  return ((degrees % 360) + 360) % 360;
}

function getLiveHeading(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    const value = firstValue(
      source.heading,
      source.headingDeg,
      source.heading_deg,
      source.rotation,
      source.rotationDeg,
      source.rotation_deg,
      source.direction,
      source.yaw
    );
    const heading = normalizeHeadingDegrees(value);
    if (heading !== null) {
      return heading;
    }
  }

  return null;
}

function findNearestCity(location, gameId) {
  const x = getLiveCoordinate(location, "x");
  const z = getLiveCoordinate(location, "z");
  if (x === null || z === null) {
    return null;
  }

  const normalizedGameId = String(gameId || "").toLowerCase();
  const gameAliases = {
    ets2: "eut2",
    eurotrucksimulator2: "eut2",
    eut2: "eut2",
    ats: "ats",
    amtrucks: "ats",
    americantrucksimulator: "ats"
  };
  const targetGame = gameAliases[normalizedGameId] || normalizedGameId;
  const cities = loadCities().cities.filter((city) => {
    const cityGameId = String(city.game || city.game_id || "").toLowerCase();
    const cityGame = gameAliases[cityGameId] || cityGameId;
    return !cityGame || !targetGame || cityGame === targetGame;
  });

  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  cities.forEach((city) => {
    const cityX = Number(firstValue(city.x, city.positionX));
    const cityZ = Number(firstValue(city.z, city.positionZ));
    if (!Number.isFinite(cityX) || !Number.isFinite(cityZ)) {
      return;
    }

    const distance = Math.hypot(x - cityX, z - cityZ);
    if (distance < nearestDistance) {
      nearest = city;
      nearestDistance = distance;
    }
  });

  if (!nearest) {
    return null;
  }

  const maxDistance = Number(firstValue(nearest.radius, nearest.maxDistance, 50000));
  if (Number.isFinite(maxDistance) && nearestDistance > maxDistance) {
    return null;
  }

  return firstValue(nearest.name, nearest.city, nearest.id);
}

function titleCaseText(value) {
  const text = textFromValue(value);
  if (!text) {
    return null;
  }

  return String(text)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\p{L}[\p{L}'-]*/gu, (word) => word.charAt(0).toLocaleUpperCase() + word.slice(1));
}

function formatRouteStop(city, company) {
  const cityText = titleCaseText(city);
  const companyText = titleCaseText(company);

  if (cityText && companyText) {
    return `${cityText} (${companyText})`;
  }

  return cityText || companyText || null;
}

function formatDistanceKm(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance)) {
    return value === undefined || value === null || value === "" ? null : String(value);
  }

  return `${Math.round(distance).toLocaleString("en-US")} KM`;
}

function formatDamagePercent(value) {
  const damage = Number(value);
  if (!Number.isFinite(damage)) {
    return value === undefined || value === null || value === "" ? null : String(value);
  }

  const percent = damage <= 1 ? damage * 100 : damage;
  return `${Math.round(percent)}%`;
}

function formatFuelPercent(value) {
  const fuel = Number(value);
  if (!Number.isFinite(fuel) || fuel < 0) {
    return null;
  }

  const percent = fuel <= 1 ? fuel * 100 : fuel;
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

function formatFuelLiters(value) {
  const fuel = Number(value);
  return Number.isFinite(fuel) && fuel > 0 ? `${fuel.toFixed(fuel >= 10 ? 0 : 1)} L` : null;
}

function formatFuelRange(value) {
  const range = Number(value);
  return Number.isFinite(range) && range > 0 ? `${Math.round(range).toLocaleString("en-US")} KM` : null;
}

function formatFuelEconomy(value) {
  const economy = Number(value);
  return Number.isFinite(economy) && economy > 0 ? `${economy.toFixed(1)} KM/L` : null;
}

function formatRpm(value) {
  const rpm = Number(value);
  return Number.isFinite(rpm) && rpm >= 0 ? `${Math.round(rpm).toLocaleString("en-US")}` : null;
}

function formatIntegerUnit(value, unit) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric).toLocaleString("en-US")} ${unit}` : null;
}

function formatDecimalUnit(value, unit, decimals = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(decimals)} ${unit}` : null;
}

function formatBooleanState(value, enabledText, disabledText) {
  if (typeof value !== "boolean") {
    return null;
  }

  return value ? enabledText : disabledText;
}

function formatGear(value, displayedValue) {
  const gear = firstValue(displayedValue, value);
  if (gear === undefined || gear === null || gear === "") {
    return null;
  }

  const numeric = Number(gear);
  if (!Number.isFinite(numeric)) {
    return String(gear);
  }

  if (numeric < 0) {
    return "R";
  }

  if (numeric === 0) {
    return "N";
  }

  return String(Math.round(numeric));
}

function formatWearGroup(wear) {
  if (!wear || typeof wear !== "object") {
    return null;
  }

  const values = Object.values(wear).map(Number).filter(Number.isFinite);
  if (!values.length) {
    return null;
  }

  const maxWear = Math.max(...values);
  return formatDamagePercent(maxWear);
}

function positiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function fuelPercentNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function errorToMessage(error) {
  if (!error) {
    return null;
  }

  if (error.code === "ECONNABORTED" || String(error.message || "").toLowerCase().includes("timeout")) {
    const timeout = error.config?.timeout;
    return timeout
      ? `Request timed out after ${timeout} ms`
      : "Request timed out";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error.error) {
    return errorToMessage(error.error);
  }

  if (error.message) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function getForegroundGameState() {
  const now = Date.now();
  if (now - foregroundGameCache.checkedAt < FOREGROUND_GAME_CACHE_MS) {
    return foregroundGameCache.result;
  }

  if (process.platform !== "win32") {
    foregroundGameCache = {
      checkedAt: now,
      result: { isGame: false, processName: null, title: null }
    };
    return foregroundGameCache.result;
  }

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class JastukForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$handle = [JastukForegroundWindow]::GetForegroundWindow()
$processId = 0
[JastukForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId) | Out-Null
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
if ($process) {
  [PSCustomObject]@{
    processName = $process.ProcessName
    title = $process.MainWindowTitle
  } | ConvertTo-Json -Compress
}
`;

  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 1200,
      windowsHide: true
    });
    const info = JSON.parse(String(stdout || "{}"));
    const normalizedProcess = String(info.processName || "").toLowerCase();
    const normalizedTitle = String(info.title || "").toLowerCase();
    const isGame = GAME_PROCESS_NAMES.has(normalizedProcess) ||
      GAME_PROCESS_NAMES.has(`${normalizedProcess}.exe`) ||
      normalizedTitle.includes("euro truck simulator 2") ||
      normalizedTitle.includes("american truck simulator");

    foregroundGameCache = {
      checkedAt: now,
      result: {
        isGame,
        processName: info.processName || null,
        title: info.title || null
      }
    };
  } catch {
    foregroundGameCache = {
      checkedAt: now,
      result: { isGame: false, processName: null, title: null }
    };
  }

  return foregroundGameCache.result;
}

function normalizeOverlayData(snapshot) {
  const driver = normalizeLiveDriver(snapshot);
  const payloads = unwrapTelemetryPayload(snapshot);
  const telemetryRoot = snapshot?.telemetryApi?.telemetry || snapshot?.telemetryApi?.live || snapshot?.telemetryApi || snapshot;
  const telemetryTruck = telemetryRoot?.truck || {};
  const navigation = telemetryRoot?.navigation || {};
  const location = telemetryRoot?.location || {};
  const rpm = readPath(snapshot, [
    ["telemetryApi", "telemetry", "truck", "engine_rpm"],
    ["telemetryApi", "telemetry", "truck", "engineRpm"],
    ["telemetryApi", "telemetry", "truck", "rpm"],
    ["telemetryApi", "live", "truck", "engine_rpm"],
    ["telemetryApi", "truck", "engine_rpm"],
    ["truck", "engine_rpm"],
    ["truck", "engineRpm"],
    ["truck", "rpm"],
    ["telemetry", "truck", "engine_rpm"],
    ["engine_rpm"],
    ["rpm"]
  ]) ?? findPrimitiveByKeys(payloads, ["engine_rpm", "engineRpm", "engineRPM", "rpm"]);
  const fuelLiters = positiveNumber(readPath(snapshot, [
    ["telemetryApi", "telemetry", "truck", "fuel"],
    ["telemetryApi", "telemetry", "truck", "fuel", "value"],
    ["telemetryApi", "telemetry", "truck", "fuel", "amount"],
    ["telemetryApi", "telemetry", "truck", "fuel", "liters"],
    ["telemetryApi", "telemetry", "truck", "fuel_liters"],
    ["telemetryApi", "live", "truck", "fuel"],
    ["telemetryApi", "live", "truck", "fuel_liters"],
    ["telemetryApi", "truck", "fuel"],
    ["telemetryApi", "truck", "fuel_liters"],
    ["truck", "fuel"],
    ["truck", "fuelLiters"],
    ["truck", "fuel_liters"],
    ["telemetry", "truck", "fuel"],
    ["telemetry", "truck", "fuel_liters"],
    ["fuel"]
  ]) ?? findPrimitiveByKeys(payloads, ["fuelLiters", "fuel_liters", "fuelAmount", "fuel_amount", "fuel"]));
  const fuelCapacity = positiveNumber(readPath(snapshot, [
    ["telemetryApi", "telemetry", "truck", "fuelCapacity"],
    ["telemetryApi", "telemetry", "truck", "fuel", "capacity"],
    ["telemetryApi", "telemetry", "truck", "fuel_capacity_liters"],
    ["telemetryApi", "live", "truck", "fuel_capacity"],
    ["telemetryApi", "live", "truck", "fuel_capacity_liters"],
    ["telemetryApi", "truck", "fuelCapacity"],
    ["telemetryApi", "truck", "fuel_capacity_liters"],
    ["truck", "fuelCapacity"],
    ["truck", "fuel_capacity"],
    ["truck", "fuel_capacity_liters"],
    ["fuelCapacity"]
  ]) ?? findPrimitiveByKeys(payloads, ["fuelCapacity", "fuel_capacity", "fuel_capacity_liters", "fuelTank", "fuelTankCapacity"]));
  const fuelPercentValue = fuelPercentNumber(firstValue(
    readPath(snapshot, [
      ["telemetryApi", "telemetry", "truck", "fuelPercent"],
      ["telemetryApi", "telemetry", "truck", "fuel", "percent"],
      ["telemetryApi", "telemetry", "truck", "fuel_percent"],
      ["telemetryApi", "live", "truck", "fuel_percent"],
      ["telemetryApi", "truck", "fuelPercent"],
      ["telemetryApi", "truck", "fuel_percent"],
      ["truck", "fuelPercent"],
      ["truck", "fuel_percent"],
      ["fuelPercent"]
    ]),
    findPrimitiveByKeys(payloads, ["fuelPercent", "fuel_percentage", "fuelPercentage"])
  ));
  const computedFuelPercent = fuelLiters !== null && fuelCapacity !== null
    ? (fuelLiters / fuelCapacity) * 100
    : null;
  const fuelRange = positiveNumber(readPath(snapshot, [
    ["telemetryApi", "telemetry", "truck", "fuelRange"],
    ["telemetryApi", "telemetry", "truck", "fuel", "range"],
    ["telemetryApi", "telemetry", "truck", "fuel", "rangeKm"],
    ["telemetryApi", "telemetry", "truck", "fuel_range_km"],
    ["telemetryApi", "live", "truck", "fuel_range"],
    ["telemetryApi", "live", "truck", "fuel_range_km"],
    ["telemetryApi", "truck", "fuelRange"],
    ["telemetryApi", "truck", "fuel_range_km"],
    ["truck", "fuelRange"],
    ["truck", "fuel_range"],
    ["truck", "fuel_range_km"],
    ["fuelRange"]
  ]) ?? findPrimitiveByKeys(payloads, ["fuelRange", "fuel_range", "fuel_range_km", "rangeOnFuel", "fuelDistance", "fuel_distance", "fuelRangeKm"]));
  const fuelEconomy = positiveNumber(firstValue(
    readPath(snapshot, [
      ["telemetryApi", "telemetry", "truck", "fuelAverageConsumption"],
      ["telemetryApi", "telemetry", "truck", "fuel", "kmPerLiter"],
      ["telemetryApi", "telemetry", "truck", "fuel_km_per_liter"],
      ["telemetryApi", "live", "truck", "fuel_km_l"],
      ["telemetryApi", "live", "truck", "fuel_km_per_liter"],
      ["telemetryApi", "truck", "fuelKmPerLiter"],
      ["telemetryApi", "truck", "fuel_km_per_liter"],
      ["truck", "fuelKmPerLiter"],
      ["truck", "fuel_km_l"],
      ["truck", "fuel_km_per_liter"],
      ["fuelKmPerLiter"]
    ]),
    findPrimitiveByKeys(payloads, ["fuelKmPerLiter", "kmPerLiter", "fuel_km_l", "fuel_km_per_liter", "fuelEconomy"])
  ));
  const litersPer100Km = positiveNumber(firstValue(
    readPath(snapshot, [
      ["telemetryApi", "telemetry", "truck", "fuelAverageConsumptionLiters"],
      ["telemetryApi", "telemetry", "truck", "fuel", "litersPer100Km"],
      ["telemetryApi", "live", "truck", "fuel_l_100km"],
      ["telemetryApi", "truck", "fuelLitersPer100Km"],
      ["truck", "fuelLitersPer100Km"],
      ["truck", "fuel_l_100km"],
      ["fuelLitersPer100Km"]
    ]),
    findPrimitiveByKeys(payloads, ["fuelLitersPer100Km", "litersPer100Km", "fuel_l_100km", "fuelL100Km"])
  ));
  const computedFuelEconomy = fuelEconomy || (litersPer100Km ? 100 / litersPer100Km : null);
  const computedFuelRange = fuelRange || (fuelLiters && computedFuelEconomy ? fuelLiters * computedFuelEconomy : null);
  const gear = formatGear(telemetryTruck.gear, telemetryTruck.displayed_gear);
  const cruise = formatIntegerUnit(firstValue(telemetryTruck.cruise_control_kmh, Number(telemetryTruck.cruise_control_mps) * 3.6), "KM/H");
  const speedLimit = formatIntegerUnit(firstValue(navigation.speed_limit_kmh, Number(navigation.speed_limit_mps) * 3.6), "KM/H");
  const odometer = formatIntegerUnit(telemetryTruck.odometer_km, "KM");
  const navDistance = formatIntegerUnit(firstValue(navigation.distance_km, Number(navigation.distance_m) / 1000), "KM");
  const navEtaMinutes = Number(navigation.time_s);
  const warningItems = [
    telemetryTruck.fuel_warning ? "Fuel" : null,
    telemetryTruck.adblue_warning ? "AdBlue" : null,
    telemetryTruck.oil_pressure_warning ? "Oil" : null,
    telemetryTruck.water_temperature_warning ? "Water" : null,
    telemetryTruck.battery_voltage_warning ? "Battery" : null,
    telemetryTruck.brake_air_pressure_warning || telemetryTruck.brake_air_pressure_emergency ? "Air" : null
  ].filter(Boolean);
  const lightItems = [
    telemetryTruck.light_low_beam ? "Low" : null,
    telemetryTruck.light_high_beam ? "High" : null,
    telemetryTruck.light_beacon ? "Beacon" : null,
    telemetryTruck.left_blinker || telemetryTruck.right_blinker ? "Blinker" : null,
    telemetryTruck.hazard_warning ? "Hazard" : null,
    telemetryTruck.wipers ? "Wipers" : null
  ].filter(Boolean);
  const controlItems = [
    formatBooleanState(telemetryTruck.engine_enabled, "Engine on", "Engine off"),
    formatBooleanState(telemetryTruck.electric_enabled, "Electric on", "Electric off"),
    telemetryTruck.parking_brake ? "Park brake" : null,
    telemetryTruck.motor_brake ? "Motor brake" : null,
    Number(telemetryTruck.retarder_level) > 0 ? `Retarder ${Math.round(Number(telemetryTruck.retarder_level))}` : null,
    telemetryTruck.differential_lock ? "Diff lock" : null
  ].filter(Boolean);

  return {
    success: true,
    updatedAt: new Date().toISOString(),
    name: driver.name,
    status: driver.status,
    speed: driver.speed,
    rpm: formatRpm(rpm),
    truck: driver.truck,
    city: driver.city,
    cargo: driver.cargo,
    route: driver.route,
    distance: driver.distance,
    damage: driver.damage,
    gear,
    odometer,
    navigation: {
      distance: navDistance,
      eta: Number.isFinite(navEtaMinutes) && navEtaMinutes > 0 ? `${Math.round(navEtaMinutes / 60)} min` : null,
      speedLimit
    },
    systems: {
      cruise,
      parkingBrake: formatBooleanState(telemetryTruck.parking_brake, "On", "Off"),
      engine: formatBooleanState(telemetryTruck.engine_enabled, "On", "Off"),
      electric: formatBooleanState(telemetryTruck.electric_enabled, "On", "Off"),
      controls: controlItems.join(" / ") || null,
      lights: lightItems.join(" / ") || "Off",
      warnings: warningItems.join(" / ") || "OK",
      oilPressure: formatDecimalUnit(telemetryTruck.oil_pressure, "psi", 0),
      oilTemperature: formatDecimalUnit(telemetryTruck.oil_temperature, "C", 0),
      waterTemperature: formatDecimalUnit(telemetryTruck.water_temperature, "C", 0),
      batteryVoltage: formatDecimalUnit(telemetryTruck.battery_voltage, "V", 1),
      brakeAirPressure: formatDecimalUnit(telemetryTruck.brake_air_pressure, "psi", 0),
      brakeTemperature: formatDecimalUnit(telemetryTruck.brake_temperature, "C", 0),
      adblue: formatFuelLiters(telemetryTruck.adblue),
      wear: formatWearGroup(telemetryTruck.wear)
    },
    location: {
      heading: formatDecimalUnit(location.heading, "deg", 0),
      coordinates: Number.isFinite(Number(location.x)) && Number.isFinite(Number(location.z))
        ? `${Math.round(Number(location.x))}, ${Math.round(Number(location.z))}`
        : null
    },
    fuel: {
      percent: formatFuelPercent(firstValue(fuelPercentValue, computedFuelPercent)),
      liters: formatFuelLiters(fuelLiters),
      range: formatFuelRange(computedFuelRange),
      economy: formatFuelEconomy(computedFuelEconomy)
    }
  };
}

function getDriverUsersFromPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    return getDriverUsersFromPayload(payload.data);
  }

  return [
    payload?.users,
    payload?.drivers,
    payload?.onlineDrivers,
    payload?.online_drivers,
    payload?.data
  ].find(Array.isArray) || [];
}

function truthyOnline(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value > 0;
  }

  return ["online", "driving", "connected", "active", "true", "1", "yes"].includes(String(value || "").toLowerCase());
}

function coordinateFromSources(key, ...sources) {
  for (const source of sources) {
    const value = getLiveCoordinate(source, key);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function normalizeSharedLiveDriver(user) {
  const live = firstValue(user.live, user.current, user.currentStatus, user.statusData, user.telemetry, user.tracker, user.session) || {};
  const currentJob = firstValue(user.currentJob, user.current_job, user.job, live.currentJob, live.current_job, live.job) || {};
  const location = firstValue(user.location, user.position, user.coordinates, user.coords, user.truck?.location, live.location, live.position, live.coordinates, live.truck?.location) || {};
  const positionX = coordinateFromSources("x", location, live, user);
  const positionZ = coordinateFromSources("z", location, live, user);
  const heading = getLiveHeading(location, live.truck, live, user.truck, user);
  const speed = firstValue(user.speed, user.speedKmh, user.speed_kmh, user.kmh, live.speed, live.speedKmh, live.speed_kmh, live.truck?.speed);
  const truck = findTruckName(firstValue(user.truck, user.vehicle, live.truck, live.vehicle)) || textFromValue(firstValue(user.truck, user.truckName, user.truck_name, live.truckName, live.truck_name));
  const sourceCity = firstValue(currentJob.sourceCity, currentJob.source_city, currentJob.source?.city, currentJob.from, currentJob.origin, live.sourceCity, user.sourceCity);
  const sourceCompany = firstValue(currentJob.sourceCompany, currentJob.source_company, currentJob.source?.company, currentJob.originCompany, live.sourceCompany, user.sourceCompany);
  const destinationCity = firstValue(currentJob.destinationCity, currentJob.destination_city, currentJob.destination?.city, currentJob.to, currentJob.target, live.destinationCity, user.destinationCity);
  const destinationCompany = firstValue(currentJob.destinationCompany, currentJob.destination_company, currentJob.destination?.company, currentJob.targetCompany, live.destinationCompany, user.destinationCompany);
  const sourceStop = formatRouteStop(sourceCity, sourceCompany);
  const destinationStop = formatRouteStop(destinationCity, destinationCompany);
  const isOnline = truthyOnline(firstValue(user.online, user.isOnline, user.status, live.online, live.status, live.state));
  const city = firstValue(user.city, user.currentCity, user.nearestCity, location.city, live.city, live.currentCity);
  const hasCurrentJob = Boolean(firstValue(currentJob.cargo, currentJob.cargoName, currentJob.cargo_name, sourceCity, destinationCity));
  const game = firstValue(user.game, user.gameName, user.game_id, user.gameId, live.game, live.gameName, live.game_id, currentJob.game);
  const status = firstValue(user.statusText, user.status_text, live.statusText) || (Number(speed) > 0 ? "Driving" : hasCurrentJob ? "On job" : isOnline ? "Online" : "Connected");

  return {
    id: String(firstValue(user.id, user.discordId, user.discord_id, user.steamid, user.steamId, user.name, user.username)),
    name: textFromValue(firstValue(user.displayName, user.name, user.username, user.discordUsername, user.steamName, user.steamname)) || "Driver",
    status,
    telemetryAvailable: Boolean(isOnline || speed || truck || city || hasCurrentJob || (positionX !== null && positionZ !== null)),
    game,
    truck,
    speed,
    city: titleCaseText(city),
    position: positionX !== null && positionZ !== null ? { x: positionX, z: positionZ } : null,
    heading,
    jobStops: {
      source: sourceStop,
      destination: destinationStop,
      sourceCity: titleCaseText(sourceCity),
      sourceCompany: titleCaseText(sourceCompany),
      destinationCity: titleCaseText(destinationCity),
      destinationCompany: titleCaseText(destinationCompany)
    },
    cargo: titleCaseText(firstValue(currentJob.cargo, currentJob.cargoName, currentJob.cargo_name, live.cargo, user.cargo)),
    route: titleCaseText(firstValue(currentJob.route, live.route, user.route)) || (sourceStop || destinationStop ? `${sourceStop || "?"} -> ${destinationStop || "?"}` : null),
    distance: formatDistanceKm(firstValue(currentJob.distance, currentJob.distance_km, currentJob.distanceKm, live.distance, user.distance)),
    income: firstValue(currentJob.income, currentJob.revenue, currentJob.earnings, user.income, user.earnings),
    damage: formatDamagePercent(firstValue(currentJob.damage, currentJob.cargo_damage, currentJob.cargoDamage, live.damage, user.damage)),
    updatedAt: firstValue(user.updatedAt, user.updated_at, live.updatedAt, live.updated_at, user.lastSeenAt, user.last_seen_at, new Date().toISOString()),
    source: "hub",
    raw: user
  };
}

function unwrapTelemetryPayload(snapshot) {
  return {
    receiver: snapshot?.receiverApi?.data || {},
    telemetry: snapshot?.telemetryApi || {}
  };
}

function normalizeLiveDriver(snapshot) {
  const root = snapshot?.jobsApi || snapshot;
  const telemetry = snapshot?.telemetryApi || {};
  const liveTelemetry = parseTrackerPayload(telemetry?.live) || {};
  const fullTelemetry = parseTrackerPayload(telemetry?.telemetry) || {};
  const payloads = unwrapTelemetryPayload(snapshot);
  const currentJob =
    root?.current_job ||
    root?.currentJob ||
    root?.navigation?.current_job ||
    root?.navigation?.currentJob ||
    liveTelemetry?.current_job ||
    liveTelemetry?.currentJob ||
    liveTelemetry?.navigation?.current_job ||
    liveTelemetry?.navigation?.currentJob ||
    fullTelemetry?.current_job ||
    fullTelemetry?.currentJob ||
    fullTelemetry?.navigation?.current_job ||
    fullTelemetry?.navigation?.currentJob ||
    {};
  const activeUser = getActiveLocalUser();
  const liveTruck = liveTelemetry?.truck || fullTelemetry?.truck || telemetry?.truck || root?.truck || snapshot?.truck || {};
  const directSpeedKmh = firstValue(
    liveTruck.speed_kmh,
    liveTruck.speedKmh,
    liveTruck.speed?.kmh,
    liveTruck.speed?.kph,
    liveTruck.speed
  );
  const directSpeedMps = firstValue(liveTruck.speed_mps, liveTruck.speedMps);
  const speed = firstValue(
    directSpeedKmh,
    directSpeedMps !== undefined ? Number(directSpeedMps) * 3.6 : undefined,
    readPath(snapshot, [
    ["telemetryApi", "telemetry", "truck", "speed", "kph"],
    ["telemetryApi", "telemetry", "truck", "speed", "kmh"],
    ["telemetryApi", "telemetry", "truck", "speedKph"],
    ["telemetryApi", "live", "truck", "speed_kmh"],
    ["telemetryApi", "live", "truck", "speedKmh"],
    ["telemetryApi", "live", "truck", "speed_mps"],
    ["telemetryApi", "live", "truck", "speed"],
    ["telemetryApi", "truck", "speed"],
    ["telemetryApi", "status", "speed"],
    ["truck", "speed"],
    ["truck", "speed", "kph"],
    ["truck", "speed", "kmh"],
    ["truck", "speed_kmh"],
    ["truck", "speedKph"],
    ["vehicle", "speed"],
    ["telemetry", "speed"],
    ["telemetry", "truck", "speed"],
    ["telemetry", "truck", "speed", "kph"],
    ["telemetry", "truck", "speed", "kmh"],
    ["game", "speed"],
    ["speed"]
    ]),
    findPrimitiveByKeys(payloads, ["speedKph", "speedKmh", "truckSpeed", "speed", "kph", "kmh"])
  );
  const truck = findTruckName(liveTruck) || readPath(snapshot, [
    ["telemetryApi", "telemetry", "truck", "brand"],
    ["telemetryApi", "telemetry", "truck", "make"],
    ["telemetryApi", "telemetry", "truck", "name"],
    ["telemetryApi", "telemetry", "truck", "model"],
    ["telemetryApi", "live", "truck", "brand"],
    ["telemetryApi", "live", "truck", "name"],
    ["telemetryApi", "truck", "name"],
    ["telemetryApi", "truck", "model"],
    ["truck", "name"],
    ["truck", "model"],
    ["truck", "make"],
    ["truck", "brand"],
    ["truck", "truckName"],
    ["vehicle", "name"],
    ["vehicle", "model"],
    ["telemetry", "truck", "name"],
    ["telemetry", "truck", "model"],
    ["truck"]
  ]) || findTruckName(root) || findTruckName(snapshot) || findTruckName(payloads);
  const city = readPath(snapshot, [
    ["telemetryApi", "telemetry", "truck", "city"],
    ["telemetryApi", "telemetry", "location", "city"],
    ["telemetryApi", "live", "city"],
    ["telemetryApi", "live", "location", "city"],
    ["telemetryApi", "status", "city"],
    ["location", "city"],
    ["truck", "city"],
    ["telemetry", "city"],
    ["telemetry", "location", "city"],
    ["game", "city"],
    ["city"]
  ]) ?? findPrimitiveByKeys(payloads, ["city", "currentCity", "nearestCity", "locationCity"]);
  const damage = readPath(snapshot, [
    ["telemetryApi", "telemetry", "truck", "damage"],
    ["telemetryApi", "live", "damage"],
    ["telemetryApi", "live", "truck", "damage"],
    ["telemetryApi", "truck", "damage"],
    ["truck", "damage"],
    ["vehicle", "damage"],
    ["telemetry", "damage"],
    ["telemetry", "truck", "damage"],
    ["damage"]
  ]) ?? findPrimitiveByKeys(payloads, ["damage", "truckDamage", "wear", "wearTotal"]);
  const cargo = titleCaseText(firstValue(currentJob.cargo, currentJob.cargoName, currentJob.cargo_name)) || titleCaseText(readPath(snapshot, [
    ["telemetryApi", "telemetry", "job", "cargo", "name"],
    ["telemetryApi", "telemetry", "job", "cargo"],
    ["telemetryApi", "live", "current_job", "cargo_name"],
    ["telemetryApi", "live", "current_job", "cargo"],
    ["telemetryApi", "live", "cargo"],
    ["cargo"],
    ["cargo", "name"],
    ["job", "cargo"],
    ["job", "cargo", "name"]
  ])) || titleCaseText(findPrimitiveByKeys(payloads, ["cargoName", "cargo", "cargoId"]));
  const sourceCity = readPath(snapshot, [
    ["telemetryApi", "live", "current_job", "source", "city"],
    ["telemetryApi", "live", "current_job", "source_city"],
    ["telemetryApi", "telemetry", "job", "source", "city"],
    ["telemetryApi", "telemetry", "job", "sourceCity"],
    ["job", "source", "city"],
    ["job", "sourceCity"],
    ["source_city"],
    ["source"]
  ]) ?? textFromValue(firstValue(currentJob.source?.city, currentJob.source_city, currentJob.sourceCity, currentJob.from, currentJob.origin)) ?? findPrimitiveByKeys(payloads, ["sourceCity", "source", "origin", "originCity"]);
  const sourceCompany = readPath(snapshot, [
    ["telemetryApi", "live", "current_job", "source", "company"],
    ["telemetryApi", "live", "current_job", "source_company"],
    ["telemetryApi", "telemetry", "job", "source", "company"],
    ["telemetryApi", "telemetry", "job", "sourceCompany"],
    ["job", "source", "company"],
    ["job", "sourceCompany"],
    ["source_company"]
  ]) ?? textFromValue(firstValue(currentJob.source?.company, currentJob.source_company, currentJob.sourceCompany)) ?? findPrimitiveByKeys(payloads, ["sourceCompany", "source_company", "originCompany"]);
  const destinationCity = readPath(snapshot, [
    ["telemetryApi", "live", "current_job", "destination", "city"],
    ["telemetryApi", "live", "current_job", "destination_city"],
    ["telemetryApi", "telemetry", "job", "destination", "city"],
    ["telemetryApi", "telemetry", "job", "destinationCity"],
    ["job", "destination", "city"],
    ["job", "destinationCity"],
    ["destination_city"],
    ["destination"]
  ]) ?? textFromValue(firstValue(currentJob.destination?.city, currentJob.destination_city, currentJob.destinationCity, currentJob.to, currentJob.target)) ?? findPrimitiveByKeys(payloads, ["destinationCity", "destination", "target", "targetCity"]);
  const destinationCompany = readPath(snapshot, [
    ["telemetryApi", "live", "current_job", "destination", "company"],
    ["telemetryApi", "live", "current_job", "destination_company"],
    ["telemetryApi", "telemetry", "job", "destination", "company"],
    ["telemetryApi", "telemetry", "job", "destinationCompany"],
    ["job", "destination", "company"],
    ["job", "destinationCompany"],
    ["destination_company"]
  ]) ?? textFromValue(firstValue(currentJob.destination?.company, currentJob.destination_company, currentJob.destinationCompany)) ?? findPrimitiveByKeys(payloads, ["destinationCompany", "destination_company", "targetCompany"]);
  const sourceStop = formatRouteStop(sourceCity, sourceCompany);
  const destinationStop = formatRouteStop(destinationCity, destinationCompany);
  const route = titleCaseText(currentJob.route || readPath(snapshot, [["route"], ["job", "route"]]) || findPrimitiveByKeys(payloads, ["route"])) || (sourceStop || destinationStop ? `${sourceStop || "?"} -> ${destinationStop || "?"}` : null);
  const navigationDistanceKm = readPath(snapshot, [
    ["telemetryApi", "live", "navigation", "distance_km"],
    ["telemetryApi", "telemetry", "navigation", "distance_km"],
    ["navigation", "distance_km"]
  ]);
  const liveNavigationDistanceKm = Number(navigationDistanceKm) > 0 ? navigationDistanceKm : undefined;
  const jobDistance = firstValue(
    currentJob.distance,
    currentJob.distance_km,
    currentJob.distanceKm,
    currentJob.remaining_distance_km,
    currentJob.remainingDistanceKm,
    liveNavigationDistanceKm,
    currentJob.planned_distance_km,
    currentJob.plannedDistanceKm,
    readPath(snapshot, [
      ["telemetryApi", "live", "current_job", "remaining_distance_km"],
      ["telemetryApi", "live", "current_job", "planned_distance_km"],
      ["telemetryApi", "telemetry", "job", "remainingDistance"],
      ["telemetryApi", "telemetry", "job", "plannedDistanceKm"],
      ["distance"],
      ["job", "distance"]
    ]),
    findPrimitiveByKeys(payloads, ["remainingDistanceKm", "plannedDistanceKm", "remainingDistance", "planned_distance_km", "jobDistance", "distance"])
  );
  const currentJobActive = isActiveJob(currentJob);
  const liveLocation = liveTelemetry?.location || fullTelemetry?.location || telemetry?.truck?.location || root?.location || snapshot?.location || {};
  const positionX = getLiveCoordinate(liveLocation, "x");
  const positionZ = getLiveCoordinate(liveLocation, "z");
  const heading = getLiveHeading(liveLocation, liveTruck, fullTelemetry?.truck, telemetry?.truck);
  const game = textFromValue(firstValue(
    currentJob.game,
    currentJob.gameName,
    currentJob.game_name,
    currentJob.game_id,
    root?.game,
    root?.gameName,
    root?.game_name,
    root?.game_id,
    liveTelemetry?.game,
    fullTelemetry?.game,
    readPath(snapshot, [["telemetryApi", "live", "game", "name"], ["telemetryApi", "live", "game", "id"], ["telemetryApi", "telemetry", "game", "name"], ["telemetryApi", "telemetry", "game", "id"], ["telemetryApi", "telemetry", "game"], ["telemetryApi", "game", "game"], ["telemetry", "game"]]),
    findPrimitiveByKeys(payloads, ["game", "gameName", "game_id", "gameId"])
  ));
  const resolvedCity = city ??
    findNearestCity(liveLocation, root?.game_id || liveTelemetry?.game?.id || fullTelemetry?.game?.id || currentJob.game_id || game) ??
    sourceCity ??
    destinationCity ??
    "Unknown city";
  const hasLocationTelemetry = positionX !== null && positionZ !== null;
  const hasLiveTelemetry = Boolean(
    hasTelemetryValue(speed) ||
    hasTelemetryValue(truck) ||
    hasTelemetryValue(game) ||
    currentJobActive ||
    hasTelemetryObject(liveLocation) ||
    hasLocationTelemetry
  );
  const status = hasLiveTelemetry
    ? Number(speed) > 0
      ? "Driving"
      : currentJobActive
        ? "On job"
        : truck || city || game
          ? "Free roam"
          : "Connected"
    : "Tracker connected - no live telemetry";

  return {
    id: activeUser?.id || "local-driver",
    name: activeUser?.displayName || activeUser?.username || activeUser?.name || "Local Driver",
    status,
    telemetryAvailable: hasLiveTelemetry,
    game,
    truck,
    speed,
    city: titleCaseText(resolvedCity),
    position: positionX !== null && positionZ !== null ? { x: positionX, z: positionZ } : null,
    heading,
    jobStops: {
      source: sourceStop,
      destination: destinationStop,
      sourceCity: titleCaseText(sourceCity),
      sourceCompany: titleCaseText(sourceCompany),
      destinationCity: titleCaseText(destinationCity),
      destinationCompany: titleCaseText(destinationCompany)
    },
    cargo: currentJobActive ? cargo : null,
    route: currentJobActive ? route : null,
    distance: currentJobActive ? formatDistanceKm(jobDistance) : null,
    income: currentJob.income || readPath(snapshot, [["income"], ["job", "income"]]),
    damage: formatDamagePercent(firstValue(currentJob.damage, currentJob.cargo_damage, currentJob.cargoDamage, damage)),
    updatedAt: snapshot?.polledAt || root?.updated_at_utc || new Date().toISOString(),
    truckersmp: snapshot?.truckersmp || null,
    source: "local",
    raw: snapshot
  };
}

function authHeadersFromEnv(env) {
  return env.DRIVER_USERS_TOKEN ? { Authorization: `Bearer ${env.DRIVER_USERS_TOKEN}` } : {};
}

async function pushLiveDriver(driver) {
  const env = loadEnv().values;
  const livePushUrl = env.LIVE_PUSH_URL;

  if (!livePushUrl) {
    return {
      success: false,
      error: "LIVE_PUSH_URL missing in .env"
    };
  }

  if (!driver?.telemetryAvailable) {
    return {
      success: false,
      error: "telemetryAvailable is false",
      driver
    };
  }

  try {
    const response = await axios.post(livePushUrl, driver, {
      timeout: LIVE_API_TIMEOUT_MS,
      headers: {
        ...authHeadersFromEnv(env),
        "Content-Type": "application/json"
      }
    });

    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}
async function fetchSharedLiveDrivers() {
  const env = loadEnv().values;
  const liveDriversUrl = env.LIVE_DRIVERS_URL || DEFAULT_LIVE_DRIVERS_URL;
  const response = await axios.get(liveDriversUrl, {
    timeout: LIVE_API_TIMEOUT_MS,
    headers: authHeadersFromEnv(env)
  });
  return response.data;
}

async function fetchDriverUsers() {
  const env = loadEnv().values;
  const driverUsersUrl = env.DRIVER_USERS_URL || DEFAULT_DRIVER_USERS_URL;
  const response = await axios.get(driverUsersUrl, { timeout: LIVE_API_TIMEOUT_MS, headers: authHeadersFromEnv(env) });
  return response.data;
}

async function fetchProfileDrivers() {
  const env = loadEnv().values;
  const profileDriversUrl = env.PROFILE_DRIVERS_URL || DEFAULT_PROFILE_DRIVERS_URL;
  const response = await axios.get(profileDriversUrl, {
    timeout: LIVE_API_TIMEOUT_MS,
    headers: authHeadersFromEnv(env)
  });
  return response.data;
}

function showMainWindow() {
  const window = createWindow();
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

function createTray() {
  if (tray && !tray.isDestroyed()) {
    return tray;
  }

  tray = new Tray(APP_ICON_SOURCE);
  tray.setToolTip(APP_TITLE);
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "Show Jastuk Tracker",
      click: showMainWindow
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
  return tray;
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    title: APP_TITLE,
    icon: APP_ICON_SOURCE,
    show: false,
    backgroundColor: "#11151b",
    autoHideMenuBar: true,
    menuBarVisible: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    appendAppDebugLog("main window console", { level, message, line, sourceId });
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    appendAppDebugLog("main window render process gone", details);
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    appendAppDebugLog("main window failed load", { errorCode, errorDescription, validatedUrl });
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function cleanupAppResources() {
  if (appCleanupStarted) {
    return;
  }

  appCleanupStarted = true;

  if (trackerPersistenceTimer) {
    clearInterval(trackerPersistenceTimer);
    trackerPersistenceTimer = null;
  }

  if (updaterAutoCheckTimer) {
    clearInterval(updaterAutoCheckTimer);
    updaterAutoCheckTimer = null;
  }

  stopDiscordPresence();

  if (liveReceiverServer) {
    try {
      liveReceiverServer.close();
    } catch {
      // The local receiver may already be closed during shutdown.
    }
    liveReceiverServer = null;
  }

  liveReceiverSockets.forEach((socket) => {
    try {
      socket.destroy();
    } catch {
      // Socket cleanup is best-effort while the process exits.
    }
  });
  liveReceiverSockets.clear();

  screen.off("display-metrics-changed", positionOverlayWindow);
  screen.off("display-added", positionOverlayWindow);
  screen.off("display-removed", positionOverlayWindow);

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
  }
  overlayWindow = null;

  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
}

function normalizeOverlayPosition(value) {
  return String(value || "").toLowerCase() === "bottom" ? "bottom" : "top";
}

function getOverlayFields(value) {
  const requested = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
  const validFields = new Set([
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
    "cruise",
    "systems",
    "lights",
    "warnings",
    "temps",
    "pressure"
  ]);

  const fields = requested.filter((field) => validFields.has(field));
  return fields.length ? fields : DEFAULT_OVERLAY_FIELDS;
}

function normalizeBooleanSetting(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).toLowerCase() !== "false";
}

function getEnvOverlaySettings(values = loadEnv().values) {
  return {
    enabled: String(values.OVERLAY_ENABLED ?? "true").toLowerCase() !== "false",
    requireGameFocus: String(values.OVERLAY_REQUIRE_GAME_FOCUS ?? "false").toLowerCase() === "true",
    position: normalizeOverlayPosition(values.OVERLAY_POSITION),
    opacity: Number(values.OVERLAY_OPACITY || 0.72),
    fields: getOverlayFields(values.OVERLAY_FIELDS)
  };
}

function normalizeOverlaySettings(settings = {}, fallback = getEnvOverlaySettings()) {
  const opacity = Number(settings.opacity ?? fallback.opacity);
  return {
    enabled: normalizeBooleanSetting(settings.enabled, fallback.enabled),
    requireGameFocus: normalizeBooleanSetting(settings.requireGameFocus, fallback.requireGameFocus),
    position: normalizeOverlayPosition(settings.position ?? fallback.position),
    opacity: Number.isFinite(opacity) ? Math.max(0.28, Math.min(1, opacity)) : fallback.opacity,
    fields: getOverlayFields(settings.fields ?? fallback.fields)
  };
}

function getOverlaySettings(values = loadEnv().values) {
  const envSettings = getEnvOverlaySettings(values);
  const activeUser = getActiveLocalUser();
  return normalizeOverlaySettings(activeUser?.overlaySettings, envSettings);
}

function saveActiveUserOverlaySettings(settings) {
  const current = loadUsers();
  const activeIndex = current.users.findIndex((user) => user.enabled !== false);
  if (activeIndex === -1) {
    throw new Error("No enabled user is available for overlay settings.");
  }

  const currentSettings = getOverlaySettings();
  const overlaySettings = normalizeOverlaySettings(settings, currentSettings);
  const users = current.users.map((user, index) => index === activeIndex
    ? { ...user, overlaySettings }
    : user);
  const result = saveUsers(users);
  applyOverlaySettings();
  return {
    ...result,
    user: users[activeIndex],
    overlaySettings
  };
}

function positionOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  const settings = getOverlaySettings();
  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const height = OVERLAY_HEIGHT;
  overlayWindow.setBounds({
    x: bounds.x,
    y: settings.position === "bottom" ? bounds.y + bounds.height - height : bounds.y,
    width: bounds.width,
    height
  });
}

function createOverlayWindow() {
  const settings = getOverlaySettings();
  overlayWindow = new BrowserWindow({
    width: 900,
    height: OVERLAY_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: false
    }
  });

  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.loadFile(path.join(__dirname, "overlay.html"));
  overlayWindow.webContents.on("did-finish-load", () => {
    overlayWindow.webContents.send("overlay-settings", settings);
  });
  overlayWindow.once("ready-to-show", () => {
    positionOverlayWindow();
    if (settings.enabled) {
      overlayWindow.showInactive();
    }
  });
}

function applyOverlaySettings(values = loadEnv().values) {
  const settings = getOverlaySettings(values);
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  positionOverlayWindow();
  overlayWindow.webContents.send("overlay-settings", settings);
  if (settings.enabled) {
    overlayWindow.showInactive();
  } else {
    overlayWindow.hide();
  }
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    createWindow();
  });
}

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    if (process.platform === "win32") {
      app.setAppUserModelId("com.jastuk.tracker");
    }

    startLiveReceiver();
    startTrackerPersistenceLoop();
    startUpdaterAutoChecks();
    startDiscordPresence();
    Menu.setApplicationMenu(null);
    createTray();
    createWindow();
    createOverlayWindow();
    screen.on("display-metrics-changed", positionOverlayWindow);
    screen.on("display-added", positionOverlayWindow);
    screen.on("display-removed", positionOverlayWindow);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (isQuitting && process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  cleanupAppResources();
});

ipcMain.handle("tracker-fetch", async () => {
  try {
    const data = await fetchTracker();
    const storedJobs = persistTrackerJobs(data);
    return { success: true, data, storedJobs };
  } catch (error) {
    return {
      success: false,
      error: error.response ? error.response.statusText || error.message : error.message
    };
  }
});

ipcMain.handle("tracker-live-drivers", async () => {
  const driversById = new Map();
  let snapshot = null;
  let localError = null;
  let sharedError = null;
  let sharedLoaded = false;
  let pushError = null;
  let localDriver = null;

  try {
    const data = await fetchLiveTrackerSnapshot();
    data.polledAt = new Date().toISOString();
    data.truckersmp = await detectTruckersMp();
    snapshot = data;
    localDriver = normalizeLiveDriver(data);
    if (localDriver.telemetryAvailable) {
      driversById.set(localDriver.id, localDriver);
    }
  } catch (error) {
    localError = error;
  }

  const publishLocalDriver = localDriver
    ? pushLiveDriver(localDriver).then((result) => {
      pushError = result;
    })
    : Promise.resolve();

  const loadSharedDrivers = fetchSharedLiveDrivers()
    .then((sharedData) => {
      sharedLoaded = true;
      getDriverUsersFromPayload(sharedData)
        .map(normalizeSharedLiveDriver)
        .filter((driver) => driver.telemetryAvailable)
        .forEach((driver) => {
          const matchesLocalDriver = localDriver && (
            String(driver.id) === String(localDriver.id) ||
            String(driver.name || "").toLowerCase() === String(localDriver.name || "").toLowerCase()
          );
          if (!matchesLocalDriver && !driversById.has(driver.id)) {
            driversById.set(driver.id, driver);
          }
        });
    })
    .catch((error) => {
      sharedError = error;
    });

  await Promise.all([publishLocalDriver, loadSharedDrivers]);

  const drivers = Array.from(driversById.values()).sort((left, right) => {
    if (left.source === "local" && right.source !== "local") {
      return -1;
    }

    if (right.source === "local" && left.source !== "local") {
      return 1;
    }

    return String(left.name || "").localeCompare(String(right.name || ""));
  });
  if (drivers.length || sharedLoaded) {
    return {
      success: true,
      drivers,
      snapshot,
      localDriver,
      errors: {
        local: errorToMessage(localError),
        shared: errorToMessage(sharedError),
        push: pushError?.success === false ? errorToMessage(pushError) : null
      }
    };
  }

  const error = localError || sharedError || new Error("No live driver data is available.");
  return {
    success: false,
    error: error.response ? error.response.statusText || error.message : error.message
  };
});

ipcMain.handle("overlay-data", async () => {
  const settings = getOverlaySettings();
  const foregroundGame = await getForegroundGameState();
  const foregroundTitle = String(foregroundGame.title || "").toLowerCase();
  const foregroundProcess = String(foregroundGame.processName || "").toLowerCase();
  const isTrackerForeground =
    foregroundTitle.includes(APP_TITLE.toLowerCase()) ||
    foregroundTitle.includes("jastuk tracker") ||
    foregroundProcess.includes("jastuk");

  if (isTrackerForeground || (settings.requireGameFocus && !foregroundGame.isGame)) {
    return {
      success: false,
      hideOverlay: true,
      foregroundGame: {
        ...foregroundGame,
        isTracker: isTrackerForeground
      },
      error: isTrackerForeground ? "Overlay hidden while tracker is active" : "Game is not the active window"
    };
  }

  try {
    const data = await fetchLiveTrackerSnapshot({
      endpoints: ["/api/telemetry", "/api/live"],
      timeout: TRACKER_JOBS_TIMEOUT_MS
    });
    data.polledAt = new Date().toISOString();
    return {
      ...normalizeOverlayData(data),
      stale: Boolean(data.stale),
      staleReason: data.staleReason || null,
      foregroundGame
    };
  } catch (error) {
    return {
      success: false,
      foregroundGame,
      error: errorToMessage(error),
      updatedAt: new Date().toISOString()
    };
  }
});

ipcMain.handle("driver-users-fetch", async () => {
  try {
    return { success: true, data: await fetchDriverUsers() };
  } catch (error) {
    return {
      success: false,
      error: error.response ? error.response.statusText || error.message : error.message
    };
  }
});

ipcMain.handle("profile-drivers-fetch", async () => {
  try {
    return { success: true, data: await fetchProfileDrivers() };
  } catch (error) {
    return {
      success: false,
      error: error.response ? error.response.statusText || error.message : error.message
    };
  }
});

ipcMain.handle("copy-text", (_, text) => {
  clipboard.writeText(text || "");
  return true;
});

ipcMain.handle("open-url", (_, url) => {
  if (!url) {
    return false;
  }
  shell.openExternal(url);
  return true;
});

function encodeForm(data) {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

async function exchangeDiscordCode(clientId, clientSecret, code) {
  const body = encodeForm({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: DISCORD_REDIRECT_URI
  });

  const response = await axios.post(DISCORD_TOKEN_URL, body, {
    timeout: DISCORD_AUTH_TIMEOUT_MS,
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  return response.data;
}

async function fetchDiscordUser(accessToken) {
  const response = await axios.get(DISCORD_ME_URL, {
    timeout: DISCORD_AUTH_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return response.data;
}

async function fetchDiscordGuildMember(accessToken, guildId) {
  const url = `https://discord.com/api/users/@me/guilds/${encodeURIComponent(guildId)}/member`;
  const response = await axios.get(url, {
    timeout: DISCORD_AUTH_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return response.data;
}

ipcMain.handle("discord-login", async () => {
  appendAppDebugLog("discord-login ipc invoked");
  const env = loadEnv().values;
  const clientId = env.DISCORD_CLIENT_ID;
  const clientSecret = env.DISCORD_CLIENT_SECRET;
  const guildId = env.DISCORD_GUILD_ID;
  const requiredRoleId = env.DISCORD_REQUIRED_ROLE_ID || REQUIRED_DISCORD_ROLE_ID;

  if (!clientId) {
    return { success: false, error: "Discord client ID is not configured." };
  }

  if (!guildId) {
    return { success: false, error: "Discord guild ID is not configured. Add DISCORD_GUILD_ID to your .env." };
  }

  const responseType = clientSecret ? "code" : "token";
  const authUrl = `${DISCORD_AUTHORIZE_URL}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=${responseType}&scope=${encodeURIComponent(DISCORD_SCOPE)}`;

  const authWindow = new BrowserWindow({
    width: 720,
    height: 820,
    title: "Discord Login",
    icon: APP_ICON_SOURCE,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  authWindow.loadURL(authUrl);

  return new Promise((resolve) => {
    let handled = false;

    const finish = (result) => {
      if (handled) return;
      handled = true;
      if (!authWindow.isDestroyed()) {
        authWindow.close();
      }
      resolve(result);
    };

    const handleCallback = async (url) => {
      try {
        const parsed = new URL(url);
        if (!parsed.pathname.startsWith(new URL(DISCORD_REDIRECT_URI).pathname)) {
          return;
        }

        const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
        const code = parsed.searchParams.get("code");
        const accessToken = hashParams.get("access_token");
        const error = parsed.searchParams.get("error") || hashParams.get("error");

        if (clientSecret && !code) {
          finish({ success: false, error: error || "Discord login failed." });
          return;
        }

        if (!clientSecret && !accessToken) {
          finish({ success: false, error: error || "Discord login failed." });
          return;
        }

        const tokenResponse = clientSecret
          ? await exchangeDiscordCode(clientId, clientSecret, code)
          : { access_token: accessToken };
        const user = await fetchDiscordUser(tokenResponse.access_token);
        const member = await fetchDiscordGuildMember(tokenResponse.access_token, guildId);

        if (requiredRoleId && !member?.roles?.includes(requiredRoleId)) {
          finish({
            success: false,
            error: "Discord login failed: required role is not present in your guild membership."
          });
          return;
        }

        const savedUser = upsertDiscordUser(user, member);
        finish({ success: true, user: savedUser, token: tokenResponse.access_token, guildMember: member });
      } catch (error) {
        finish({ success: false, error: error.response?.data?.error_description || error.message || "Discord login failed." });
      }
    };

    authWindow.webContents.on("will-redirect", (event, url) => {
      if (url.startsWith(DISCORD_REDIRECT_URI)) {
        event.preventDefault();
        handleCallback(url);
      }
    });

    authWindow.webContents.on("will-navigate", (event, url) => {
      if (url.startsWith(DISCORD_REDIRECT_URI)) {
        event.preventDefault();
        handleCallback(url);
      }
    });

    authWindow.on("closed", () => {
      finish({ success: false, error: "Discord login was cancelled." });
    });
  });
});

ipcMain.handle("get-api-url", () => API_URL);
ipcMain.handle("load-users", () => loadUsers());
ipcMain.handle("load-jobs", () => loadJobs());
ipcMain.handle("load-job-deliveries", () => {
  requireAdminUser();
  return loadJobDeliveries();
});
ipcMain.handle("resend-job-delivery", async (_, jobKey) => {
  try {
    requireAdminUser();
    return { success: true, delivery: await resendJobDelivery(jobKey) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle("load-cities", () => loadCities());
ipcMain.handle("load-env", () => ({
  ...loadEnv(),
  isAdmin: isAdminUser()
}));
ipcMain.handle("save-env", (_, values) => saveEnv(values));
ipcMain.handle("save-overlay-settings", (_, settings) => saveActiveUserOverlaySettings(settings));
ipcMain.handle("discord-presence-status", () => getDiscordPresenceState());
ipcMain.handle("discord-presence-test", () => sendDiscordPresenceTest());
ipcMain.handle("discord-presence-log", () => getDiscordPresenceLog());
ipcMain.handle("partial-load", (_, name) => loadPartial(name));
ipcMain.handle("updater-status", () => getUpdaterState());
ipcMain.handle("updater-check", () => checkForAppUpdates());
ipcMain.handle("updater-download", () => downloadAppUpdate());
ipcMain.handle("updater-install", () => installAppUpdate());
