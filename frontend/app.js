import {
  ApiError,
  getSession,
  login,
  logout,
  register,
  request,
  requestPhoneVerification,
  uploadPhoto,
  verifyPhone,
} from "./api.js";

const $ = (selector) => document.querySelector(selector);
const state = { points: [], leaks: [], selectedPoint: null, challengeId: null };
const views = [
  "overview",
  "water-points",
  "leaks",
  "report",
  "inbox",
  "account",
];
const labels = {
  overview: "Overview",
  "water-points": "Water points",
  leaks: "Leak activity",
  report: "Make a report",
  inbox: "Inbox",
  account: "Account",
};
const severityClass = {
  LOW: "",
  MEDIUM: "warning",
  HIGH: "warning",
  CRITICAL: "critical",
};

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}

function dateLabel(value) {
  if (!value) return "No recent update";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : new Intl.DateTimeFormat("en-ET", { dateStyle: "medium" }).format(date);
}

function friendlyStatus(value) {
  return (
    {
      FULL_FLOW: "Full flow",
      TRICKLE: "Trickle",
      DRY: "Dry",
      UNKNOWN: "Unknown",
    }[value] || "No recent report"
  );
}

let alertTimer;
function notify(message, isError = false) {
  const alert = $("#alert");
  alert.textContent = message;
  alert.classList.toggle("error", isError);
  alert.hidden = false;
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => {
    alert.hidden = true;
  }, 7000);
}

function handleError(error) {
  notify(
    error instanceof ApiError
      ? error.message
      : "Something went wrong. Please try again.",
    true,
  );
}

function empty(title, description) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(description)}</div>`;
}

function pointRow(point) {
  return `<div class="list-row"><span class="row-icon" aria-hidden="true">◉</span><span class="row-body"><strong>${escapeHtml(point.name)}</strong><small>${escapeHtml(point.code)}</small></span><span class="row-meta">Public point</span></div>`;
}

function leakRow(leak) {
  return `<div class="list-row"><span class="row-icon warning" aria-hidden="true">⌁</span><span class="row-body"><strong>${escapeHtml(leak.kebeleCode)} · ${escapeHtml(leak.severity)}</strong><small>${escapeHtml(leak.code)}</small></span><span class="row-meta">${escapeHtml(dateLabel(leak.lastReportedAt))}</span></div>`;
}

function renderOverview() {
  $("#stat-points").textContent = state.points.length.toLocaleString();
  $("#stat-leaks").textContent = state.leaks.length.toLocaleString();
  $("#overview-points").innerHTML = state.points.length
    ? state.points.slice(0, 3).map(pointRow).join("")
    : empty(
        "No water points listed yet",
        "Check back as the public registry grows.",
      );
  $("#overview-leaks").innerHTML = state.leaks.length
    ? state.leaks.slice(0, 3).map(leakRow).join("")
    : empty("No active leaks reported", "Community reports will appear here.");
}

function renderPoints() {
  const search = $("#point-search").value.trim().toLowerCase();
  const filtered = state.points.filter((point) =>
    `${point.name} ${point.code}`.toLowerCase().includes(search),
  );
  $("#points-list").innerHTML = filtered.length
    ? filtered
        .map(
          (point) => `
    <article class="info-card">
      <div class="info-card-top"><span class="row-icon" aria-hidden="true">◉</span><span class="chip">Public water point</span></div>
      <h2>${escapeHtml(point.name)}</h2><p>Code ${escapeHtml(point.code)}</p>
      <button type="button" class="button button-outline" data-point-id="${escapeHtml(point.id)}">View updates →</button>
    </article>`,
        )
        .join("")
    : empty(
        search ? "No matching water points" : "No water points listed yet",
        search ? "Try another name or code." : "Check back later.",
      );
  const options = state.points
    .map(
      (point) =>
        `<option value="${escapeHtml(point.id)}">${escapeHtml(point.name)} (${escapeHtml(point.code)})</option>`,
    )
    .join("");
  for (const select of [$("#flow-point"), $("#queue-point")]) {
    const previous = select.value;
    select.innerHTML = `<option value="">Choose a water point</option>${options}`;
    if (state.points.some((point) => point.id === previous))
      select.value = previous;
  }
}

function renderLeaks() {
  $("#leaks-list").innerHTML = state.leaks.length
    ? state.leaks
        .map((leak) => {
          const lat = Number(leak.centroidLatitude);
          const lon = Number(leak.centroidLongitude);
          const mapLink =
            Number.isFinite(lat) && Number.isFinite(lon)
              ? `<a class="button button-outline" href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}" target="_blank" rel="noopener noreferrer">View location ↗</a>`
              : "";
          return `<article class="info-card"><div class="info-card-top"><span class="row-icon warning" aria-hidden="true">⌁</span><span class="chip ${severityClass[leak.severity] || ""}">${escapeHtml(leak.severity)}</span></div><h2>${escapeHtml(leak.kebeleCode)}</h2><p>${escapeHtml(leak.code)} · ${escapeHtml(leak.reportCount)} report${leak.reportCount === 1 ? "" : "s"}<br />Last seen ${escapeHtml(dateLabel(leak.lastReportedAt))}</p>${mapLink}</article>`;
        })
        .join("")
    : empty(
        "No active leak areas",
        "When residents report a leak, it will appear here.",
      );
}

async function loadPublic() {
  try {
    const [points, leaks] = await Promise.all([
      loadAllPoints(),
      request("/leaks/public/active"),
    ]);
    state.points = points;
    state.leaks = leaks.items || [];
    $("#connection-label").textContent = "Connected to network";
    $("#connection-label").classList.remove("offline");
    renderOverview();
    renderPoints();
    renderLeaks();
  } catch (error) {
    $("#connection-label").textContent = "Network unavailable";
    $("#connection-label").classList.add("offline");
    $("#overview-points").innerHTML = empty(
      "Could not load water points",
      "Check the backend connection and refresh.",
    );
    $("#overview-leaks").innerHTML = empty(
      "Could not load activity",
      "Check the backend connection and refresh.",
    );
    handleError(error);
  }
}

async function loadAllPoints() {
  const first = await request("/public/standpipes?limit=100&page=1");
  const points = [...(first.items || [])];
  const totalPages = Math.max(1, Number(first.meta?.totalPages) || 1);
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await request(`/public/standpipes?limit=100&page=${page}`);
    points.push(...(next.items || []));
  }
  return points;
}

async function showPoint(id) {
  const point = state.points.find((item) => item.id === id);
  if (!point) return;
  state.selectedPoint = id;
  const panel = $("#point-detail");
  panel.hidden = false;
  panel.innerHTML = `<p class="muted">Loading updates for ${escapeHtml(point.name)}…</p>`;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  try {
    const [flow, queue] = await Promise.all([
      request(`/consensus/standpipes/${encodeURIComponent(id)}/tap-status`),
      request(`/consensus/standpipes/${encodeURIComponent(id)}/queue`),
    ]);
    if (state.selectedPoint !== id) return;
    const lat = Number(point.location?.latitude);
    const lon = Number(point.location?.longitude);
    const mapLink =
      Number.isFinite(lat) && Number.isFinite(lon)
        ? `<a class="button button-outline" href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}" target="_blank" rel="noopener noreferrer">Open map ↗</a>`
        : "";
    panel.innerHTML = `<p class="eyebrow">LATEST COMMUNITY OBSERVATIONS</p><h2>${escapeHtml(point.name)}</h2><p class="muted">${escapeHtml(point.code)} · Community reports are estimates and may change.</p><div class="detail-grid"><div class="detail-item"><small>Water flow</small><strong>${escapeHtml(friendlyStatus(flow?.status))}</strong></div><div class="detail-item"><small>Queue wait</small><strong>${queue ? `${escapeHtml(queue.waitMinutes)} min` : "No recent report"}</strong></div><div class="detail-item"><small>Flow observations</small><strong>${escapeHtml(flow?.sampleCount ?? 0)}</strong></div><div class="detail-item"><small>Queue trend</small><strong>${escapeHtml(queue?.trend || "Unknown")}</strong></div></div><div class="detail-actions">${mapLink}<a href="#report" class="button button-primary">Share an update</a></div>`;
  } catch (error) {
    panel.innerHTML = empty(
      "Could not load updates",
      "Please try again in a moment.",
    );
    handleError(error);
  }
}

async function loadInbox() {
  if (!getSession()) return;
  $("#inbox-list").innerHTML = '<p class="muted">Loading your inbox…</p>';
  try {
    const [list, count] = await Promise.all([
      request("/notifications?limit=100"),
      request("/notifications/unread-count"),
    ]);
    $("#unread-badge").textContent =
      count.unread > 99 ? "99+" : String(count.unread);
    $("#unread-badge").hidden = count.unread === 0;
    $("#inbox-list").innerHTML = list.items?.length
      ? list.items
          .map(
            (item) =>
              `<div class="list-row"><span class="row-icon ${item.readAt ? "" : "warning"}" aria-hidden="true">✉</span><span class="row-body"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.body)} · ${escapeHtml(dateLabel(item.createdAt))}</small></span>${item.readAt ? "" : `<button type="button" class="button button-outline" data-read-id="${escapeHtml(item.id)}">Mark read</button>`}</div>`,
          )
          .join("")
      : empty("All caught up", "Updates about your reports will appear here.");
  } catch (error) {
    handleError(error);
    $("#inbox-list").innerHTML = empty(
      "Could not load inbox",
      "Please try again.",
    );
  }
}

function renderSession() {
  const session = getSession();
  $("#auth-button").textContent = session
    ? session.user?.displayName || "Account"
    : "Sign in";
  $("#report-gate").hidden = Boolean(session);
  $("#report-content").hidden = !session;
  $("#inbox-gate").hidden = Boolean(session);
  $("#inbox-list").hidden = !session;
  $("#unread-badge").hidden = !session;
  $("#account-content").innerHTML = session
    ? `<p class="eyebrow">SIGNED IN</p><h2>${escapeHtml(session.user?.displayName || "Your account")}</h2><p>Your community updates are connected to this account.</p><div class="account-data"><div><small>Phone</small><strong>${escapeHtml(session.user?.phone || "—")}</strong></div><div><small>Role</small><strong>${escapeHtml(session.user?.role || "—")}</strong></div></div><button id="logout-button" type="button" class="button button-outline">Sign out</button>`
    : '<h2>You are browsing as a guest</h2><p>Sign in to report water conditions and receive updates.</p><button type="button" data-open-auth class="button button-primary">Sign in or create an account</button>';
  if (session) loadInbox();
}

function route() {
  const requested = location.hash.slice(1) || "overview";
  const name = views.includes(requested) ? requested : "overview";
  for (const view of views) $("#view-" + view).hidden = view !== name;
  for (const link of document.querySelectorAll("[data-nav]")) {
    const active = link.dataset.nav === name;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  $("#page-label").textContent = labels[name];
  $(".sidebar").classList.remove("open");
  $("#menu-button").setAttribute("aria-expanded", "false");
  if (name === "inbox" && getSession()) loadInbox();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function openAuth(tab = "login") {
  showAuthTab(tab);
  $("#auth-dialog").showModal();
}

function showAuthTab(tab) {
  $("#login-form").hidden = tab !== "login";
  $("#register-form").hidden = tab !== "register";
  $("#verify-form").hidden = tab !== "verify";
  $(".auth-tabs").hidden = tab === "verify";
  for (const button of document.querySelectorAll("[data-auth-tab]"))
    button.classList.toggle("selected", button.dataset.authTab === tab);
  $("#auth-title").textContent =
    tab === "register"
      ? "Create an account"
      : tab === "verify"
        ? "Verify your phone"
        : "Sign in";
  $("#auth-subtitle").textContent =
    tab === "verify"
      ? "We sent a six-digit code to your phone."
      : "Your water community starts here.";
}

function showReportTab(tab) {
  for (const name of ["flow", "queue", "leak"])
    $("#" + name + "-form").hidden = tab !== name;
  for (const button of document.querySelectorAll("[data-report-tab]"))
    button.classList.toggle("selected", button.dataset.reportTab === tab);
}

async function submitForm(form, action, success) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await action();
    if (success) notify(success);
    form.reset();
  } catch (error) {
    handleError(error);
  } finally {
    button.disabled = false;
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.id === "menu-button") {
    const open = $(".sidebar").classList.toggle("open");
    target.setAttribute("aria-expanded", String(open));
  } else if (target.id === "auth-button") {
    if (getSession()) location.hash = "#account";
    else openAuth();
  } else if (target.hasAttribute("data-open-auth")) openAuth();
  else if (target.id === "close-auth") $("#auth-dialog").close();
  else if (target.dataset.authTab) showAuthTab(target.dataset.authTab);
  else if (target.dataset.reportTab) showReportTab(target.dataset.reportTab);
  else if (target.id === "refresh-points") loadPublic();
  else if (target.dataset.pointId) showPoint(target.dataset.pointId);
  else if (target.dataset.readId) {
    try {
      await request(
        `/notifications/${encodeURIComponent(target.dataset.readId)}/read`,
        { method: "PATCH" },
      );
      await loadInbox();
    } catch (error) {
      handleError(error);
    }
  } else if (target.id === "logout-button") {
    try {
      await logout();
      notify("You are signed out.");
      location.hash = "#overview";
    } catch (error) {
      handleError(error);
    }
  } else if (target.id === "locate-button") {
    if (!navigator.geolocation)
      return notify("Location is not available in this browser.", true);
    target.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        $('#leak-form [name="longitude"]').value = position.coords.longitude;
        $('#leak-form [name="latitude"]').value = position.coords.latitude;
        target.disabled = false;
        notify("Location added. Check it before submitting.");
      },
      () => {
        target.disabled = false;
        notify(
          "Could not get your location. Enter coordinates manually.",
          true,
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }
});

$("#point-search").addEventListener("input", renderPoints);
$("#login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  submitForm(
    form,
    async () => {
      await login(
        String(data.get("phone")).trim(),
        String(data.get("password")),
      );
      $("#auth-dialog").close();
    },
    "Welcome back.",
  );
});
$("#register-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  submitForm(
    form,
    async () => {
      const phone = String(data.get("phone")).trim();
      await register(
        String(data.get("displayName")).trim(),
        phone,
        String(data.get("password")),
      );
      const challenge = await requestPhoneVerification(phone);
      state.challengeId = challenge.challengeId;
      showAuthTab("verify");
    },
    "Account created. Enter the code sent to your phone.",
  );
});
$("#verify-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  submitForm(
    form,
    async () => {
      if (!state.challengeId)
        throw new ApiError(
          "Request a new code by creating your account again.",
          0,
        );
      await verifyPhone(state.challengeId, String(data.get("code")));
      state.challengeId = null;
      $("#auth-dialog").close();
    },
    "Phone verified. You are signed in.",
  );
});
$("#flow-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  submitForm(
    form,
    async () => {
      await request("/reports/tap-status", {
        method: "POST",
        body: JSON.stringify({
          standpipeId: data.get("standpipeId"),
          status: data.get("status"),
          note: String(data.get("note")).trim() || null,
        }),
      });
    },
    "Thank you. Your flow update was recorded.",
  );
});
$("#queue-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  submitForm(
    form,
    async () => {
      await request("/reports/queue-wait", {
        method: "POST",
        body: JSON.stringify({
          standpipeId: data.get("standpipeId"),
          waitMinutes: Number(data.get("waitMinutes")),
          ...(data.get("queueSize") === ""
            ? {}
            : { queueSize: Number(data.get("queueSize")) }),
        }),
      });
    },
    "Thank you. Your queue update was recorded.",
  );
});
$("#leak-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  submitForm(
    form,
    async () => {
      const file = data.get("photo");
      if (file instanceof File && file.size > 10 * 1024 * 1024)
        throw new ApiError("Photos must be 10 MB or smaller.", 0);
      const photoObjectKey =
        file instanceof File && file.size ? await uploadPhoto(file) : null;
      await request("/leaks/reports", {
        method: "POST",
        body: JSON.stringify({
          description: String(data.get("description")).trim(),
          location: {
            longitude: Number(data.get("longitude")),
            latitude: Number(data.get("latitude")),
          },
          severity: data.get("severity"),
          ...(photoObjectKey ? { photoObjectKey } : {}),
        }),
      });
      loadPublic();
    },
    "Thank you. Your leak report was recorded.",
  );
});

window.addEventListener("hashchange", route);
window.addEventListener("hydro:session", renderSession);
route();
renderSession();
loadPublic();
