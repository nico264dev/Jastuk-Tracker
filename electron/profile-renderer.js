let selectors = {};

let activeUser = null;
let profileJobGroups = [];

function initializeSelectors() {
  selectors = {
    apiUrlLabel: document.getElementById("sidebar-api-url"),
    pageSubtitle: document.getElementById("page-subtitle"),
    profileBanner: document.getElementById("profile-banner"),
    profileAvatar: document.getElementById("profile-avatar"),
    profileName: document.getElementById("profile-name"),
    profileRoles: document.getElementById("profile-roles"),
    profileDriverRank: document.getElementById("profile-driver-rank"),
    profileDetailsJobs: document.getElementById("profile-details-jobs"),
    profileSteamName: document.getElementById("profile-steam-name"),
    profileSteamId: document.getElementById("profile-steam-id"),
    profileCountry: document.getElementById("profile-country"),
    profileJoined: document.getElementById("profile-joined"),
    profilePoints: document.getElementById("profile-points"),
    profileWeeklyWins: document.getElementById("profile-weekly-wins"),
    profileTotalEvents: document.getElementById("profile-total-events"),
    profileTotalJobs: document.getElementById("profile-total-jobs"),
    profileDistance: document.getElementById("profile-distance"),
    profileEvents: document.getElementById("profile-events"),
    profileEarnings: document.getElementById("profile-earnings"),
    profileMonthlyJobs: document.getElementById("profile-monthly-jobs")
  };
}

function formatValue(value) {
  return value === undefined || value === null || value === "" ? "-" : value;
}

function formatNumber(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(formatValue(value))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getDriverList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.drivers)) {
    return payload.drivers;
  }

  if (payload && typeof payload === "object") {
    return [payload];
  }

  return [];
}

function getDriverUsers(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.users)) {
    return payload.users;
  }

  return [];
}

function findDriverUser(users) {
  if (!activeUser) {
    return null;
  }

  const candidates = [
    activeUser?.displayName,
    activeUser?.username,
    activeUser?.steamName,
    activeUser?.steamname,
    activeUser?.name
  ].map(normalizeName).filter(Boolean);

  return users.find((user) => {
    const userNames = [
      user.name,
      user.username,
      user.discordDisplayName,
      user.discordUsername,
      user.discordId,
      user.discord_id,
      user.steamName,
      user.steamname,
      user.steamid,
      user.steamId
    ].map(normalizeName);
    return candidates.some((candidate) => userNames.includes(candidate));
  }) || null;
}

function findProfileDriver(drivers) {
  if (!activeUser) {
    return null;
  }

  const candidates = [
    activeUser?.displayName,
    activeUser?.username,
    activeUser?.steamName,
    activeUser?.name,
    activeUser?.id,
    activeUser?.steamid,
    activeUser?.steamId
  ].map(normalizeName).filter(Boolean);

  return drivers.find((driver) => {
    const driverNames = [
      driver.name,
      driver.steamName,
      driver.discordDisplayName,
      driver.discordUsername,
      driver.discordId,
      driver.steamid,
      driver.steamId
    ].map(normalizeName);
    return candidates.some((candidate) => driverNames.includes(candidate));
  }) || null;
}

function renderProfile(driver) {
  if (!driver) {
    selectors.profileName.textContent = "No driver profile found";
    selectors.profileRoles.innerHTML = "<span class=\"profile-role\">No API data</span>";
    return;
  }

  const totalJobs = driver.totalJobs ?? driver.jobs?.length;
  const totalEvents = driver.totalEvents ?? driver.events;
  const weeklyWins = driver.weeklyWins ?? driver.weekly_wins ?? 0;

  selectors.profileBanner.style.backgroundImage = driver.banner
    ? `linear-gradient(180deg, rgba(7, 13, 18, 0.12), rgba(7, 13, 18, 0.68)), url("${driver.banner}")`
    : "";
  selectors.profileAvatar.src = driver.avatar || "../public/img/logo.png";
  selectors.profileName.textContent = formatValue(driver.name);
  if (selectors.pageSubtitle) {
    selectors.pageSubtitle.textContent = `Welcome back, ${formatValue(driver.name)}!`;
  }
  selectors.profileRoles.innerHTML = Array.isArray(driver.roles) && driver.roles.length
    ? driver.roles.map((role) => `<span class="profile-role">${escapeHtml(role)}</span>`).join("")
    : "<span class=\"profile-role\">Member</span>";
  selectors.profileDriverRank.textContent = formatValue(driver.driverrank);
  selectors.profileDetailsJobs.textContent = formatNumber(totalJobs);
  selectors.profileSteamName.textContent = formatValue(driver.steamName || driver.steamname);
  selectors.profileSteamId.textContent = formatValue(driver.steamid);
  selectors.profileCountry.textContent = formatValue(driver.country);
  selectors.profileJoined.textContent = formatDate(driver.joinedAt);
  selectors.profilePoints.textContent = formatNumber(driver.points);
  selectors.profileWeeklyWins.textContent = formatNumber(weeklyWins);
  selectors.profileTotalEvents.textContent = formatNumber(totalEvents);
  selectors.profileTotalJobs.textContent = formatNumber(totalJobs);
  selectors.profileDistance.textContent = driver.distance === undefined || driver.distance === null ? "-" : `${formatNumber(driver.distance)} KM`;
  selectors.profileEvents.textContent = formatNumber(totalEvents);
  selectors.profileEarnings.textContent = driver.earnings === undefined || driver.earnings === null ? "-" : `${formatNumber(driver.earnings)} €`;
}

function getMonthKey(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "Unknown month";
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long"
  });
}

function renderProfileJobs(jobs) {
  const sortedJobs = Array.isArray(jobs)
    ? [...jobs].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    : [];

  if (!sortedJobs.length) {
    profileJobGroups = [];
    selectors.profileMonthlyJobs.innerHTML = "<div class=\"help-text\">No jobs found for this driver.</div>";
    return;
  }

  const groups = sortedJobs.reduce((result, job) => {
    const month = getMonthKey(job.date);
    if (!result.has(month)) {
      result.set(month, []);
    }
    result.get(month).push(job);
    return result;
  }, new Map());

  profileJobGroups = Array.from(groups.entries()).map(([month, monthJobs]) => ({ month, jobs: monthJobs }));
  selectors.profileMonthlyJobs.innerHTML = `
    <div class="month-tabs">
      ${profileJobGroups.map((group, index) => `
        <button class="month-tab ${index === 0 ? "active" : ""}" data-month-index="${index}" type="button">
          <span>${escapeHtml(group.month)}</span>
          <strong>${formatNumber(group.jobs.length)}</strong>
        </button>
      `).join("")}
    </div>
    <div id="profile-month-table"></div>
  `;
  renderProfileJobMonth(0);
}

function renderProfileJobMonth(index) {
  const group = profileJobGroups[index];
  const target = document.getElementById("profile-month-table");
  if (!group || !target) {
    return;
  }

  selectors.profileMonthlyJobs.querySelectorAll(".month-tab").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.monthIndex) === index);
  });

  target.innerHTML = `
    <section class="month-job-group">
      <div class="month-job-heading">
        <span>${escapeHtml(group.month)}</span>
        <strong>${formatNumber(group.jobs.length)} jobs</strong>
      </div>
      <div class="table-wrap">
        <table class="jobs-table profile-jobs-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Job</th>
              <th>Route</th>
              <th>Distance</th>
            </tr>
          </thead>
          <tbody>
            ${group.jobs.map((job) => `
              <tr>
                <td>${escapeHtml(formatDate(job.date))}</td>
                <td>${escapeHtml(job.title)}</td>
                <td>${escapeHtml(`${formatValue(job.origin)} -> ${formatValue(job.destination)}`)}</td>
                <td>${escapeHtml(job.distance === undefined || job.distance === null ? "-" : `${formatNumber(job.distance)} KM`)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

async function loadActiveUser() {
  const response = await window.jastuk.loadUsers();
  const users = Array.isArray(response.users) ? response.users : [];
  activeUser = users.find((user) => user.enabled !== false) || null;
}

async function refreshProfile() {
  try {
    const profileResponse = await window.jastuk.fetchProfileDrivers();
    if (!profileResponse.success) {
      throw new Error(profileResponse.error || "Drivers request failed");
    }

    const usersResponse = await window.jastuk.fetchDriverUsers();
    const drivers = getDriverList(profileResponse.data);
    const user = usersResponse.success ? findDriverUser(getDriverUsers(usersResponse.data)) : null;
    renderProfile(user || findProfileDriver(drivers));
    renderProfileJobs(user?.jobs || []);
  } catch (error) {
    selectors.profileName.textContent = "Unable to load profile";
    selectors.profileRoles.innerHTML = "<span class=\"profile-role\">API offline</span>";
    selectors.profileMonthlyJobs.innerHTML = "<div class=\"help-text\">Unable to load jobs from the drivers API.</div>";
  }
}

async function initialize() {
  await window.jastukLayout.ready;
  initializeSelectors();
  if (selectors.apiUrlLabel) {
    selectors.apiUrlLabel.textContent = await window.jastuk.getApiUrl();
  }
  selectors.profileMonthlyJobs.addEventListener("click", (event) => {
    const button = event.target.closest(".month-tab");
    if (!button) {
      return;
    }

    renderProfileJobMonth(Number(button.dataset.monthIndex));
  });

  await loadActiveUser();
  await refreshProfile();
}

document.addEventListener("DOMContentLoaded", initialize);
