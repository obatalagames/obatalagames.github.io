(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const config = window.TRIVIA_ARENA_CONFIG || {};
  const POLICY_VERSIONS = Object.freeze({ terms: "2026-10-18", privacy: "2026-10-18" });
  const FLASH_CATEGORIES = [
    ["us_football", "US football"], ["us_pop_culture", "US pop culture"],
    ["eu_soccer", "EU soccer"], ["sa_soccer", "South America soccer"],
    ["combat_sports", "Combat sports"], ["music", "Music"],
    ["gaming", "Gaming"], ["film_tv", "Film & TV"],
  ];
  const BOX_CATEGORIES = [
    ["global_sports", "Global sports"], ["mathematics", "Mathematics"],
    ["earth_science", "Earth science"], ["spoken_language", "Spoken language"],
    ["geopolitics", "Geopolitics"],
  ];
  const SUPPORTED_GODS = ["zeus", "athena", "poseidon", "ares", "hermes"];
  const appState = { view: "arena", session: null, account: null, depositInstructions: [], payoutSources: [], matches: [], market: [], offers: [], dailyGift: null, game: null };
  let toastTimer;
  let gameTimer;
  let gamePoller;
  let refreshTimer;
  let dailyWheelRotation = 0;
  let dailyWheelMotionFrame = null;
  let dailyWheelMotionLast = 0;
  let authGeneration = 0;

  function tr(key, fallback, vars = {}) {
    const translated = window.TriviaI18n?.t?.(key, vars);
    return translated && translated !== key ? translated : fallback;
  }

  function toast(message) {
    const node = $("#toast");
    if (!node) return;
    node.textContent = String(message || tr("ui.requestFailed", "Request failed."));
    node.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.classList.remove("show"), 4200);
  }

  function configured() {
    const serviceOrigins = [config.apiOrigin, config.gameOrigin, config.antiCheatOrigin, config.authOrigin].map((value) => String(value || "").trim());
    const supabaseUrl = String(config.supabaseUrl || "").trim();
    const supabaseKey = String(config.supabasePublishableKey || "").trim();
    const statement = String(config.walletStatement || "").trim();
    return serviceOrigins.every((origin) => /^https:\/\//i.test(origin)
      && !/your-domain\.example|replace-with-your-domain|YOUR_PROJECT|YOUR_SUPABASE/i.test(origin))
      && /^https:\/\//i.test(supabaseUrl)
      && !/YOUR_PROJECT|YOUR_SUPABASE/i.test(supabaseUrl)
      && supabaseKey.length > 20
      && !/YOUR_SUPABASE|PUBLISHABLE_OR_ANON/i.test(supabaseKey)
      && statement.length >= 20
      && !/your-domain\.example|replace-with-your-domain|YOUR_PROJECT|YOUR_SUPABASE/i.test(statement);
  }

  function serviceBase(path = "") {
    if (!configured()) return null;
    const value = String(path || "");
    const origin = value.startsWith("/api/matches") || value.startsWith("/api/flash")
      ? config.gameOrigin
      : value.includes("/recording/") ? config.antiCheatOrigin : config.apiOrigin;
    const base = String(origin || "").replace(/\/$/, "");
    return /^https:\/\//i.test(base) ? base : null;
  }

  function apiBase() { return serviceBase("/api/account"); }

  async function accessToken() {
    const auth = window.TriviaArenaAuth;
    if (!auth || typeof auth.getAccessToken !== "function") return null;
    const value = await auth.getAccessToken();
    if (typeof value === "string") return value || null;
    return value && typeof value.access_token === "string" ? value.access_token : null;
  }

  function requestId() {
    return window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function htmlEscape(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function formatUsdt(value) {
    try {
      const units = BigInt(String(value ?? "0"));
      const whole = units / 1_000_000n;
      const fraction = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
      return `$${whole.toString()}${fraction ? `.${fraction}` : ".00"}`;
    } catch (_) { return "—"; }
  }

  function formatUnitsForInput(value) {
    try { return (Number(BigInt(String(value))) / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, ""); } catch (_) { return "5"; }
  }

  function shortAddress(value) {
    const address = String(value || "");
    return /^0x[0-9a-f]{40}$/i.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address || "—";
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function localLocale() {
    const value = String(document.documentElement.lang || navigator.language || "en").slice(0, 2).toLowerCase();
    return ["en", "es", "fr", "it", "el", "de", "cs", "pl", "tr", "ru"].includes(value) ? value : "en";
  }

  function localizedCategory(value) {
    const raw = String(value || "").trim();
    const match = [...FLASH_CATEGORIES, ...BOX_CATEGORIES].find(([key, label]) => key === raw || label.toLowerCase() === raw.toLowerCase());
    if (match) return tr(`category.${match[0]}`, match[1]);
    return raw ? tr(`category.${raw}`, raw) : tr("category.mixed", "Mixed bag");
  }

  function localizedPayoutStatus(value) {
    const raw = String(value || "pending").toLowerCase();
    const key = { pending: "admin.status.pending", pending_review: "admin.status.pending_review", approved: "admin.status.approved", paid: "admin.status.paid", rejected: "admin.status.rejected", cancelled: "admin.status.cancelled", submitted: "admin.status.submitted", under_review: "admin.status.under_review", needs_info: "admin.status.needs_info" }[raw];
    return key ? tr(key, raw.replaceAll("_", " ")) : raw.replaceAll("_", " ");
  }

  function clientError(error, route) { void window.TriviaArenaTelemetry?.report(error, { eventType: "client.request_error", route }); }

  function operationLabel(route) {
    const value = String(route || "");
    if (value.includes("/daily-gift")) return "Daily gift";
    if (value === "/api/account") return "Account loading";
    if (value.includes("/deposits")) return "Deposit information";
    if (value.includes("/payouts")) return "Payout request";
    if (value.includes("/kyc")) return "KYC submission";
    if (value.includes("/recording")) return "Game recording";
    if (value.includes("/flash")) return "Flash match";
    if (value.includes("/matches")) return "Scheduled match";
    return "Game server request";
  }

  function diagnosticError(error, route) {
    const path = String(route || error?.route || "not supplied").slice(0, 160);
    const method = String(error?.method || "GET").toUpperCase();
    const endpoint = error?.endpoint || `${serviceBase(path) || "SERVICE_ORIGIN_NOT_CONFIGURED"}${path}`;
    const rawCode = String(error?.diagnostic?.diagnosticCode || error?.diagnosticCode || error?.code || error?.message || "DIAGNOSTIC_FALLBACK").replace(/[^A-Z0-9_.:-]/gi, "_").slice(0, 96);
    const rawSourceCode = String(error?.diagnostic?.sourceCode || error?.sourceCode || error?.code || "DIAGNOSTIC_FALLBACK").replace(/[^A-Z0-9_.:-]/gi, "_").slice(0, 96);
    const status = Number.isInteger(error?.status) ? ` HTTP ${error.status}` : "";
    const requestId = error?.requestId ? ` Server request ID ${String(error.requestId).slice(0, 64)}.` : "";
    const network = error?.network || /failed to fetch|networkerror|load failed|cors/i.test(String(error?.message || ""));
    const analysis = error?.diagnostic || window.ChestPlayerErrorCatalog?.resolve?.(rawSourceCode, {
      service: "api",
      route: path,
      method,
      status: Number(error?.status) || 0,
      requestId: error?.requestId || "not available",
      stage: error?.stage || `api.${path.replace(/^\/+/, "").replaceAll("/", ".") || "root"}`,
    });
    const code = String(analysis?.diagnosticCode || rawCode);
    const sourceCode = String(analysis?.sourceCode || rawSourceCode);
    const prediagnosis = analysis
      ? ` Category: ${analysis.category}. Failure point: ${analysis.stage}. Likely cause: ${analysis.likelyCause} Next action: ${analysis.nextAction}.`
      : " Pre-analysis unavailable; preserve the code and request ID for support.";
    if (network) {
      return `Could not reach ${operationLabel(path)}. ${method} ${endpoint}. Browser origin: ${window.location?.origin || "not available"}. Code: ${code} (source ${sourceCode}). This is a network/CORS/DNS/Worker-route failure.${prediagnosis}${requestId}`;
    }
    const likelyCause = typeof analysis?.likelyCause === "string" ? ` Likely cause: ${analysis.likelyCause}` : "";
    const nextAction = typeof analysis?.nextAction === "string" ? ` Next action: ${analysis.nextAction}` : "";
    const checks = Array.isArray(analysis?.checks) && analysis.checks.length
      ? ` Checks: ${analysis.checks.slice(0, 3).map((value) => String(value)).join(" | ")}` : "";
    const action = sourceCode === "AUTH_REQUIRED" || sourceCode === "AUTH_INVALID"
      ? "Sign in again."
      : sourceCode === "ORIGIN_NOT_ALLOWED"
        ? "Add the browser origin to the api Worker's APP_ORIGIN and deploy."
        : sourceCode === "INTERNAL_ERROR" || sourceCode === "DATABASE_REQUEST_FAILED"
          ? "Search server logs using the request ID."
          : sourceCode === "ACCOUNT_NOT_ONBOARDED"
            ? "Complete account setup before using this feature."
            : "Review the returned API code and server logs.";
    return `${operationLabel(path)} failed. ${method} ${endpoint} returned ${code} (source ${sourceCode}).${status}${requestId} ${action}${likelyCause}${nextAction}${checks}`;
  }

  function renderEnvironmentChrome() {
    const production = String(config.environment || "production").toLowerCase() === "production";
    const label = production ? tr("environment.production", "Play live") : tr("environment.staging", "Preview");
    const eyebrow = production ? tr("chrome.production", "PLAY LIVE · CENTRAL TIME") : tr("environment.staging", "PREVIEW · CENTRAL TIME");
    const badge = $("#environmentBadge");
    const eyebrowNode = $("#environmentEyebrow");
    const network = $("#networkLabel");
    if (badge) badge.textContent = label;
    if (eyebrowNode) eyebrowNode.textContent = eyebrow;
    if (network) network.textContent = production ? "USDT" : tr("environment.staging", "Preview");
  }

  async function api(path, options = {}) {
    let base = null;
    try {
      base = serviceBase(path);
      if (!base) throw new Error("API_NOT_CONFIGURED");
      const token = await accessToken();
      if (!token) throw new Error("AUTH_REQUIRED");
      const headers = new Headers(options.headers || {});
      headers.set("authorization", `Bearer ${token}`);
      headers.set("accept", "application/json");
      headers.set("x-client-version", "chestplayer-ui-2");
      if (options.body !== undefined) headers.set("content-type", "application/json");
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers,
        body: options.body === undefined || typeof options.body === "string" ? options.body : JSON.stringify(options.body),
      });
      let body = null;
      try { body = await response.json(); } catch (_) { /* empty response */ }
      if (!response.ok) {
        const sourceCode = typeof body?.error === "string"
          ? body.error
          : typeof body?.error?.sourceCode === "string" ? body.error.sourceCode
            : `HTTP_${response.status}`;
        const error = new Error(sourceCode);
        error.status = response.status;
        error.code = typeof body?.diagnostic?.diagnosticCode === "string" ? body.diagnostic.diagnosticCode : sourceCode;
        error.sourceCode = typeof body?.diagnostic?.sourceCode === "string" ? body.diagnostic.sourceCode : sourceCode;
        error.diagnosticCode = typeof body?.diagnostic?.diagnosticCode === "string" ? body.diagnostic.diagnosticCode : null;
        error.diagnostic = body?.diagnostic && typeof body.diagnostic === "object" ? body.diagnostic : null;
        error.requestId = body?.requestId || response.headers.get("x-request-id");
        throw error;
      }
      return body;
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught || "REQUEST_FAILED"));
      error.route = error.route || path;
      error.method = error.method || options.method || "GET";
      error.endpoint = error.endpoint || `${base || serviceBase(path) || "SERVICE_ORIGIN_NOT_CONFIGURED"}${path}`;
      if (error instanceof TypeError || /failed to fetch|networkerror|load failed|cors/i.test(error.message || "")) {
        error.network = true;
      }
      console.error("[ChestPlayer API]", diagnosticError(error, path));
      clientError(error, path);
      throw error;
    }
  }

  function renderRuntimeBanner() {
    const banner = $("#runtimeBanner");
    renderEnvironmentChrome();
    if (!banner) return;
    if (!configured()) {
      const hasSupabase = /^https:\/\//i.test(String(config.supabaseUrl || "")) && String(config.supabasePublishableKey || "").length > 20 && !/YOUR_|PUBLISHABLE_OR_ANON/i.test(String(config.supabasePublishableKey || ""));
      banner.querySelector("strong").textContent = hasSupabase ? tr("runtime.almostReady", "Almost ready") : tr("runtime.welcome", "Welcome to ChestPlayer");
      banner.lastElementChild.textContent = hasSupabase
        ? tr("auth.connectWallet", "Connect your wallet to start playing live matches.")
        : tr("landing.status", "Connect a wallet to begin playing live matches.");
      banner.classList.add("is-warning");
    } else if (!appState.session) {
      banner.querySelector("strong").textContent = tr("runtime.signInRequired", "Sign in required");
      banner.lastElementChild.textContent = tr("runtime.connect", "Connect a wallet to see live rooms, your balance, and daily gifts.");
    } else {
      banner.querySelector("strong").textContent = tr("runtime.ready", "You’re ready to play");
      banner.lastElementChild.textContent = tr("runtime.choose", "Choose a room and put your knowledge to the test.");
      banner.classList.remove("is-warning");
    }
  }

  function showView(view) {
    appState.view = view;
    $$("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    $$(".view").forEach((section) => section.classList.toggle("active", section.id === `${view}View`));
    const titles = { arena: ["titles.arena", "Knowledge under pressure."], flash: ["titles.flash", "10-10 Flash Trivia"], box: ["titles.box", "Scheduled matches"], wallet: ["titles.wallet", "Wallet and payouts"], security: ["titles.security", "Fair play, clear rules"], faq: ["titles.faq", "Frequently asked questions"] };
    const title = titles[view] || titles.arena;
    $("#pageTitle").textContent = tr(title[0], title[1]);
    if (view === "box") void loadMatches("box_5x5");
    if (view === "flash") void loadFlashMarket();
    if (view === "wallet") void loadAccount();
  }

  function renderSignedOut() {
    appState.account = null;
    appState.depositInstructions = [];
    appState.payoutSources = [];
    appState.market = [];
    appState.offers = [];
    appState.matches = [];
    appState.dailyGift = null;
    const user = $("#sidebarUser");
    if (user) user.innerHTML = `<div class="avatar">?</div><div><strong>${htmlEscape(tr("auth.notConnected", "Not connected"))}</strong><span>${htmlEscape(tr("auth.signInContinue", "Sign in to continue"))}</span></div><button class="icon-button" aria-label="${htmlEscape(tr("site.accountMenu", "Open account menu"))}">⋯</button>`;
    $("#availableBalance").innerHTML = "— <span>USDT</span>";
    $("#reservedBalance").textContent = "—";
    $("#accountStatus").textContent = tr("auth.notConnected", "Not connected");
    $("#giftCredits").textContent = "—";
    $("#linkedWallet").textContent = "—";
    renderDepositInstructions([]);
    $("#scheduledMatchList").innerHTML = `<div class="empty-prompt"><strong>${htmlEscape(tr("empty.scheduledSignIn", "Sign in to see scheduled matches."))}</strong><p>${htmlEscape(tr("empty.scheduledJoin", "Join the next five-player room when it appears."))}</p></div>`;
    $("#flashMarketGrid").innerHTML = `<div class="empty-prompt"><strong>${htmlEscape(tr("empty.flashSignIn", "Sign in to view seeking players."))}</strong><p>${htmlEscape(tr("empty.flashCreate", "Find a trivia fan and choose your entry."))}</p></div>`;
    $("#flashOfferGrid").innerHTML = "";
    $("#payoutHistory").innerHTML = `<div class="empty-prompt"><strong>${htmlEscape(tr("empty.payoutSignIn", "Sign in to load withdrawal activity."))}</strong></div>`;
    const payoutSource = $("#payoutSourceMatch");
    if (payoutSource) {
      payoutSource.replaceChildren(new Option(tr("payout.noSource", "No scheduled-match source"), ""));
      payoutSource.value = "";
    }
    const onboardingWallet = $("#onboardingWallet");
    if (onboardingWallet) {
      onboardingWallet.value = "";
      onboardingWallet.disabled = false;
    }
    ["#securityAnswer", "#onboardingCashoutCode", "#cashoutCode"].forEach((selector) => {
      const input = $(selector);
      if (input) input.value = "";
    });
    applyGiftVisual(null);
    $("#dailyGiftResult").innerHTML = `<span class="gift-result-label">${htmlEscape(tr("gift.status", "TODAY’S GIFT"))}</span><strong>${htmlEscape(tr("ui.signInSpin", "Sign in to spin"))}</strong><small>${htmlEscape(tr("gift.copy", "One free spin every day."))}</small>`;
    renderRuntimeBanner();
  }

  function renderAccount(account) {
    appState.account = account;
    $("#availableBalance").innerHTML = `${formatUsdt(account.available_base_units)} <span>USDT</span>`;
    $("#reservedBalance").textContent = formatUsdt(account.reserved_base_units);
    $("#accountStatus").textContent = account.kyc_status === "verified" ? tr("dashboard.kycVerified", "KYC verified") : tr("dashboard.accountReady", "Account ready");
    const credits = Array.isArray(account.gift_credits) ? account.gift_credits : [];
    $("#giftCredits").textContent = credits.length ? credits.map((credit) => credit.credit_type === "free_game_entry" ? tr("dashboard.freeGame", "free game") : tr("dashboard.freeToken", "free token")).join(" · ") : tr("dashboard.none", "None");
    $("#linkedWallet").textContent = shortAddress(account.wallet_address);
    const onboardingWallet = $("#onboardingWallet");
    if (onboardingWallet && account.wallet_address) { onboardingWallet.value = account.wallet_address; onboardingWallet.disabled = true; }
  }

  function renderDepositInstructions(instructions) {
    const node = $("#depositInstructions");
    if (!node) return;
    const rows = Array.isArray(instructions) ? instructions.filter((row) => row && row.treasury_wallet && row.token_contract) : [];
    if (!rows.length) {
      node.innerHTML = `<div class="empty-prompt"><strong>${htmlEscape(tr("empty.deposit", "No deposit details yet."))}</strong><p>${htmlEscape(tr("empty.depositCopy", "Sign in again once your account is ready. Never send funds to an address shown outside this panel."))}</p></div>`;
      return;
    }
    node.innerHTML = rows.map((row) => `<article class="deposit-route"><div class="deposit-route-head"><div><strong>${htmlEscape(row.asset || "USDT")} · ${htmlEscape(tr("deposit.network", "network"))} ${htmlEscape(row.chain_id)}</strong><small>${htmlEscape(tr("deposit.confirmations", "Your balance updates after {{count}} confirmations", { count: row.min_confirmations ?? tr("deposit.required", "the required number of") }))}</small></div><span class="secure-badge">${htmlEscape(tr("deposit.checked", "CHECKED DETAILS"))}</span></div><div class="deposit-address"><span>${htmlEscape(tr("deposit.destination", "DESTINATION"))}</span><code>${htmlEscape(row.treasury_wallet)}</code><button class="copy-button" type="button" data-deposit-copy="${htmlEscape(row.treasury_wallet)}">${htmlEscape(tr("wallet.copyButton", "Copy"))}</button></div><div class="deposit-address"><span>${htmlEscape(tr("deposit.token", "TOKEN"))}</span><code>${htmlEscape(row.token_contract)}</code><button class="copy-button" type="button" data-deposit-copy="${htmlEscape(row.token_contract)}">${htmlEscape(tr("wallet.copyButton", "Copy"))}</button></div></article>`).join("");
  }

  async function loadDepositInstructions(generation = authGeneration) {
    if (!appState.session) return renderDepositInstructions([]);
    try {
      const result = await api("/api/deposits/instructions");
      if (generation !== authGeneration) return;
      appState.depositInstructions = Array.isArray(result) ? result : [];
      renderDepositInstructions(appState.depositInstructions);
    } catch (error) {
      if (generation !== authGeneration) return;
      appState.depositInstructions = [];
      renderDepositInstructions([]);
      handleError(error, false);
    }
  }

  function renderMatchList(matches) {
    const list = $("#scheduledMatchList");
    const nextTitle = $("#nextScheduledTitle");
    const nextCopy = $("#nextScheduledCopy");
    const metrics = $("#nextScheduledMetrics");
    if (!list) return;
    if (!matches.length) {
      list.innerHTML = `<div class="empty-prompt"><strong>${htmlEscape(tr("empty.matches", "No room is open right now."))}</strong><p>${htmlEscape(tr("empty.matchesCopy", "Check back for the next five-player match."))}</p></div>`;
      if (nextTitle) nextTitle.textContent = tr("schedule.none", "No scheduled room published");
      if (nextCopy) nextCopy.textContent = tr("schedule.noneCopy", "The next $100 five-player room will appear here when it opens.");
      if (metrics) metrics.innerHTML = `<span><b>—</b> ${htmlEscape(tr("schedule.seatsReserved", "seats reserved"))}</span><span><b>—</b> ${htmlEscape(tr("schedule.nextStart", "next start"))}</span>`;
      return;
    }
    const next = matches[0];
    if (nextTitle) nextTitle.textContent = `$100 ChestPlayer · ${next.players_joined ?? 0}/${next.max_players ?? 5} ${tr("schedule.seats", "seats")}`;
    if (nextCopy) nextCopy.textContent = next.status === "live" ? tr("schedule.liveCopy", "This room is live. Join now to play.") : tr("schedule.fullCopy", "Five seats are required. If the room is not full, everyone gets their entry back.");
    if (metrics) metrics.innerHTML = `<span><b>${htmlEscape(next.players_joined ?? 0)} / ${htmlEscape(next.max_players ?? 5)}</b> ${htmlEscape(tr("schedule.seatsReserved", "seats reserved"))}</span><span><b>${htmlEscape(formatDate(next.scheduled_at))}</b> ${htmlEscape(tr("schedule.nextStart", "next start"))}</span>`;
    list.innerHTML = matches.map((match) => `<article class="server-match-row"><div><strong>${htmlEscape(match.status === "live" ? tr("schedule.live", "Live scheduled match") : tr("schedule.title", "Scheduled match"))}</strong><small>${htmlEscape(formatDate(match.scheduled_at))} · ${htmlEscape(match.players_joined ?? 0)}/${htmlEscape(match.max_players ?? 5)} ${htmlEscape(tr("schedule.seats", "seats"))} · $100 USDT</small></div><button class="small-purple" type="button" data-join-match="${htmlEscape(match.id)}" data-join-mode="box" data-join-status="${htmlEscape(match.status)}">${htmlEscape(match.status === "live" ? tr("schedule.open", "Open room") : tr("schedule.join", "Join room"))} <span>→</span></button></article>`).join("");
  }

  async function loadAccount(generation = authGeneration) {
    if (!appState.session) return renderSignedOut();
    try {
      const account = await api("/api/account");
      if (generation !== authGeneration) return;
      renderAccount(account);
      await loadPayoutHistory(generation);
      await loadPayoutSources(generation);
      return true;
    }
    catch (error) {
      if (generation !== authGeneration) return;
      if (error.message === "ACCOUNT_NOT_ONBOARDED") {
        appState.account = null;
        $("#accountStatus").textContent = tr("dashboard.completeSetup", "Complete one-time setup");
        $("#availableBalance").innerHTML = "$0.00 <span>USDT</span>";
        $("#reservedBalance").textContent = "$0.00";
        const onboardingWallet = $("#onboardingWallet");
        if (onboardingWallet) onboardingWallet.disabled = false;
        return false;
      } else handleError(error);
      return false;
    }
  }

  async function loadPayoutHistory(generation = authGeneration) {
    try {
      const rows = await api("/api/payouts/history");
      if (generation !== authGeneration) return;
      const history = Array.isArray(rows) ? rows : [];
      $("#payoutHistory").innerHTML = history.length
        ? history.map((row) => `<div class="history-row"><strong>${htmlEscape(formatUsdt(row.amount_base_units))}</strong><span>${htmlEscape(shortAddress(row.wallet_address_snapshot))}</span><span><i class="mini-dot blue-dot"></i> ${htmlEscape(row.review_tier || tr("dashboard.manualReview", "Manual review"))}</span><b class="status-text ${row.status === "paid" ? "green" : "amber"}">${htmlEscape(localizedPayoutStatus(row.status))}</b></div>`).join("")
        : `<div class="empty-prompt"><strong>${htmlEscape(tr("dashboard.payoutHistoryEmpty", "No payout requests yet."))}</strong><p>${htmlEscape(tr("dashboard.payoutHistoryCopy", "Your requests will appear here after you submit one."))}</p></div>`;
    } catch (error) { if (error.message !== "ACCOUNT_NOT_ONBOARDED") handleError(error, false); }
  }

  async function loadPayoutSources(generation = authGeneration) {
    if (!appState.session) return;
    try {
      const rows = await api("/api/payouts/sources");
      if (generation !== authGeneration) return;
      appState.payoutSources = Array.isArray(rows) ? rows : [];
      const select = $("#payoutSourceMatch");
      if (!select) return;
      const current = select.value;
      select.replaceChildren(new Option(tr("payout.noSource", "No match source selected"), ""));
      for (const row of appState.payoutSources) {
        if (!row || !row.match_id) continue;
        const modeLabel = row.match_mode === "flash_10" ? tr("nav.flash", "10-10 Flash Trivia") : tr("nav.scheduled", "Scheduled matches");
        const recordingStatusKey = { uploaded: "recording.statusUploaded", uploading: "recording.statusUploading", capturing: "recording.statusCapturing", retry: "recording.statusRetry", stopped: "recording.statusStopped", blocked: "recording.statusBlocked", not_active: "recording.statusNotActive" }[String(row.recording_status || "").toLowerCase()];
        const recordingStatus = recordingStatusKey ? tr(recordingStatusKey, String(row.recording_status).replaceAll("_", " ")) : tr("recording.none", "no recording");
        const label = `${modeLabel} ${formatDate(row.completed_at || row.scheduled_at)} · ${formatUsdt(row.prize_base_units)} ${tr("payout.prize", "prize")} · ${recordingStatus}`;
        select.appendChild(new Option(label, String(row.match_id)));
      }
      if ([...select.options].some((option) => option.value === current)) select.value = current;
    } catch (error) {
      if (generation !== authGeneration) return;
      appState.payoutSources = [];
      const select = $("#payoutSourceMatch");
      if (select) select.replaceChildren(new Option(tr("payout.noSource", "No match source selected"), ""));
      if (error.message !== "ACCOUNT_NOT_ONBOARDED") handleError(error, false);
    }
  }

  async function loadMatches(mode = "box_5x5", generation = authGeneration) {
    if (!appState.session) return renderSignedOut();
    try {
      const result = await api(`/api/matches?mode=${encodeURIComponent(mode)}&limit=50`);
      if (generation !== authGeneration) return;
      appState.matches = Array.isArray(result) ? result : [];
      if (mode === "box_5x5") renderMatchList(appState.matches);
    } catch (error) { handleError(error, false); }
  }

  function renderFlashCategories() {
    const node = $("#flashCategoryStrip");
    if (node) node.innerHTML = FLASH_CATEGORIES.map(([key, label]) => `<button class="category-chip" type="button" data-market-category="${key}">${htmlEscape(tr(`category.${key}`, label))}</button>`).join("");
  }

  function renderFlashMarket() {
    const grid = $("#flashMarketGrid");
    const offersNode = $("#flashOfferGrid");
    if (!grid || !offersNode) return;
    grid.innerHTML = appState.market.length
      ? appState.market.map((row) => `<article class="market-card${row.is_you ? " market-you" : ""}"><div class="market-card-top"><span class="market-avatar">${row.is_you ? htmlEscape(tr("market.you", "YOU")) : htmlEscape(String(row.requester_label || tr("market.player", "PLAYER")).slice(-4))}</span><div><strong>${row.is_you ? htmlEscape(tr("market.yourListing", "Your listing")) : htmlEscape(row.requester_label || tr("market.playerName", "Player"))}</strong><small>${htmlEscape(tr(`category.${row.category}`, FLASH_CATEGORIES.find(([key]) => key === row.category)?.[1] || row.category))} · ${htmlEscape(tr("market.seeking", "seeking"))}</small></div><b>${htmlEscape(formatUsdt(row.requested_entry_base_units))}</b></div>${row.is_you ? `<button class="small-outline full-width" data-market-action="cancel" data-market-id="${htmlEscape(row.request_id)}">${htmlEscape(tr("market.cancel", "Cancel listing"))}</button>` : `<div class="market-card-actions"><button class="small-primary" data-market-action="offer" data-market-id="${htmlEscape(row.request_id)}" data-market-amount="${htmlEscape(formatUnitsForInput(row.requested_entry_base_units))}">${htmlEscape(tr("market.match", "Match"))} ${htmlEscape(formatUsdt(row.requested_entry_base_units))}</button><button class="small-outline" data-market-action="offer" data-market-id="${htmlEscape(row.request_id)}">${htmlEscape(tr("market.offer", "Offer amount"))}</button></div>`}</article>`).join("")
      : `<div class="empty-prompt"><strong>${htmlEscape(tr("empty.market", "No one is seeking this category right now."))}</strong><p>${htmlEscape(tr("empty.marketCopy", "Create a listing to appear in the authenticated market."))}</p></div>`;
    const offers = appState.offers.filter((row) => row.is_request_owner && row.status === "pending");
    offersNode.innerHTML = offers.length
      ? `<div class="market-section-label">${htmlEscape(tr("market.offersToListings", "OFFERS TO YOUR LISTINGS"))}</div>${offers.map((offer) => `<article class="market-card"><div class="market-card-top"><span class="market-avatar">${htmlEscape(String(offer.offerer_label || tr("market.player", "PLAYER")).slice(-4))}</span><div><strong>${htmlEscape(offer.offerer_label || tr("market.playerName", "Player"))}</strong><small>${htmlEscape(tr(`category.${offer.category}`, FLASH_CATEGORIES.find(([key]) => key === offer.category)?.[1] || offer.category))} · ${htmlEscape(tr("market.offerShort", "offer"))}</small></div><b>${htmlEscape(formatUsdt(offer.offered_entry_base_units))}</b></div><div class="market-card-actions"><button class="small-primary" data-market-action="respond" data-market-id="${htmlEscape(offer.offer_id)}" data-market-accept="true">${htmlEscape(tr("market.accept", "Accept"))}</button><button class="small-outline" data-market-action="respond" data-market-id="${htmlEscape(offer.offer_id)}" data-market-accept="false">${htmlEscape(tr("market.deny", "Deny"))}</button></div></article>`).join("")}` : "";
  }

  async function loadFlashMarket(generation = authGeneration) {
    renderFlashCategories();
    if (!appState.session) return renderSignedOut();
    const category = $("#flashMarketCategory")?.value || "us_football";
    try {
      const [market, offers] = await Promise.all([
        api(`/api/flash/market?category=${encodeURIComponent(category)}&locale=${encodeURIComponent(localLocale())}&limit=100`),
        api("/api/flash/offers"),
      ]);
      if (generation !== authGeneration) return;
      appState.market = Array.isArray(market) ? market : [];
      appState.offers = Array.isArray(offers) ? offers : [];
      renderFlashMarket();
    } catch (error) { handleError(error, false); }
  }

  async function seekFlashMatch() {
    const amount = $("#flashMarketAmount")?.value?.trim();
    const category = $("#flashMarketCategory")?.value;
    if (!amount || !category) return toast(tr("market.choose", "Choose a category and wager."));
    try {
      await api("/api/flash/requests", { method: "POST", body: { category, locale: localLocale(), amountUsdt: amount, idempotencyKey: requestId() } });
      toast(tr("market.listingLive", "Your match listing is live."));
      await loadFlashMarket();
    } catch (error) { handleError(error); }
  }

  async function handleMarketAction(event) {
    const button = event.target.closest("[data-market-action]");
    if (!button) return;
    try {
      if (button.dataset.marketAction === "cancel") {
        await api(`/api/flash/requests/${button.dataset.marketId}/cancel`, { method: "POST", body: {} });
      } else if (button.dataset.marketAction === "respond") {
        const result = await api(`/api/flash/offers/${button.dataset.marketId}/respond`, { method: "POST", body: { accept: button.dataset.marketAccept === "true" } });
        if (result?.match_id || result?.matchId) {
          toast(tr("market.offerAccepted", "Offer accepted. Opening your match…"));
          await openServerGame("flash", result.match_id || result.matchId, "live", result.state || null);
          return;
        }
      } else {
        const amount = button.dataset.marketAmount || $("#flashMarketAmount")?.value?.trim();
        if (!amount) return toast(tr("market.offerRequired", "Enter an offer amount first."));
        await api(`/api/flash/requests/${button.dataset.marketId}/offers`, { method: "POST", body: { amountUsdt: amount, idempotencyKey: requestId() } });
      }
      toast(tr("market.choiceSaved", "Your choice was saved."));
      await loadFlashMarket();
    } catch (error) { handleError(error); }
  }

  function clearGameTimers() { window.clearInterval(gameTimer); window.clearInterval(gamePoller); gameTimer = null; gamePoller = null; }

  async function openServerGame(mode, matchId, knownStatus = null, initialState = null) {
    if (!matchId) { showView(mode === "box" ? "box" : "flash"); return toast(tr("game.chooseRoom", "Choose an open room before starting the game.")); }
    const generation = authGeneration;
    const userId = appState.session?.user?.id || null;
    try {
      const state = initialState || (knownStatus === "live"
        ? await api(`/api/matches/${matchId}/state?locale=${encodeURIComponent(localLocale())}`)
        : await api(`/api/matches/${matchId}/join`, { method: "POST", body: { idempotencyKey: requestId() } }));
      if (generation !== authGeneration || appState.session?.user?.id !== userId) return;
      appState.game = { mode, matchId, state, busy: false, deadline: 0, timeoutPending: false, recording: null };
      // Joining establishes the seat; this read stores the player’s selected
      // language and returns the same clue in that language.
      appState.game.state = await api(`/api/matches/${matchId}/state?locale=${encodeURIComponent(localLocale())}`);
      $("#gameModal").hidden = false;
      $("#flashGame").hidden = mode !== "flash";
      $("#boxGame").hidden = mode !== "box";
      $("#gameEyebrow").textContent = mode === "flash" ? tr("game.liveFlash", "LIVE MATCH · 1V1") : tr("game.liveBox", "LIVE MATCH · FIVE SEATS");
      $("#gameTitle").textContent = mode === "flash" ? tr("nav.flash", "10-10 Flash Trivia") : tr("landing.scheduledTitle", "5x5 ChestPlayer");
      renderGame();
      await loadRecordingState(generation);
      if (generation !== authGeneration || appState.game?.matchId !== matchId) return;
      // Recording is part of entering a paid room, not an optional control the
      // player has to remember to click after the clock starts.
      if (!appState.game.recording?.consented
        && !["completed", "cancelled", "voided"].includes(appState.game.state?.status)) {
        void startRecording();
      }
      startGamePolling();
    } catch (error) { handleError(error); }
  }

  function startGamePolling() {
    clearGameTimers();
    gameTimer = window.setInterval(updateGameClock, 100);
    gamePoller = window.setInterval(async () => {
      const activeGame = appState.game;
      const generation = authGeneration;
      if (!activeGame) return;
      const matchId = activeGame.matchId;
      try {
        const state = await api(`/api/matches/${matchId}/state?locale=${encodeURIComponent(localLocale())}`);
        if (generation !== authGeneration || appState.game !== activeGame || appState.game.matchId !== matchId) return;
        activeGame.state = state;
        activeGame.deadline = state.prompt?.remaining_ms ? Date.now() + Number(state.prompt.remaining_ms) : 0;
        renderGame();
        if (["completed", "cancelled", "voided"].includes(state.status)) { await stopRecording(true); clearGameTimers(); }
      } catch (error) { handleError(error, false); }
    }, 1500);
  }

  function updateGameClock() {
    const game = appState.game;
    if (!game || !game.state?.prompt) return;
    const remaining = Math.max(0, game.deadline - Date.now());
    $("#flashTimer").textContent = (remaining / 1000).toFixed(1);
    $("#boxTimer").textContent = (remaining / 1000).toFixed(1);
    if (remaining === 0 && game.state.prompt.is_your_turn && !game.busy && !game.timeoutPending) { game.timeoutPending = true; void submitGameAttempt(true); }
  }

  function playerScore(state, isYou) { return (state.players || []).find((player) => Boolean(player.is_you) === isYou)?.score ?? 0; }

  function renderGame() {
    const game = appState.game;
    if (!game) return;
    if (game.state?.prompt?.remaining_ms && !game.deadline) game.deadline = Date.now() + Number(game.state.prompt.remaining_ms);
    if (game.mode === "flash") renderFlashGame(game); else renderBoxGame(game);
  }

  function renderFlashGame(game) {
    const state = game.state || {};
    const prompt = state.prompt;
    const answerNode = $("#flashAnswer");
    const promptKey = prompt ? `${prompt.id || ""}:${prompt.current_attempt_index || 0}:${prompt.current_turn_seat ?? ""}` : null;
    if (game.answerPromptKey !== promptKey) {
      game.answerPromptKey = promptKey;
      if (answerNode) answerNode.value = "";
    }
    const selectedAnswer = answerNode?.value || "";
    $("#flashProgress").textContent = prompt ? `${String(prompt.question_no || 1).padStart(2, "0")} / 10` : "— / 10";
    $("#flashTurn").textContent = prompt?.is_your_turn ? tr("game.yourTry", "YOUR TRY") : prompt ? tr("game.opponentTurn", "OPPONENT TURN") : tr(`status.${String(state.status || "waiting").toLowerCase()}`, String(state.status || "waiting").toUpperCase());
    $("#flashCategory").textContent = localizedCategory(prompt?.category || state.match_category || "mixed").toUpperCase();
    $("#flashAttemptLabel").textContent = prompt ? tr("game.singleAttempt", "ONE ATTEMPT") : tr("game.waiting", "WAITING");
    $("#flashQuestion").textContent = prompt?.question_text || (state.status === "open" ? tr("game.waitOpponent", "Waiting for an opponent…") : state.status === "completed" ? tr("game.matchComplete", "Match complete.") : tr("game.nextQuestion", "Getting the next question…"));
    $("#flashYouScore").textContent = String(playerScore(state, true));
    $("#flashOppScore").textContent = String(playerScore(state, false));
    $("#flashProgressLine").style.width = prompt ? `${Math.min(100, ((Number(prompt.question_no || 1) - 1) / 10) * 100)}%` : "0%";
    const recordingReady = Boolean(game.recording?.consented);
    const choices = $("#flashChoices");
    choices.replaceChildren();
    for (const choice of Array.isArray(prompt?.choices) ? prompt.choices : []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-button";
      button.dataset.flashChoice = String(choice);
      button.textContent = String(choice);
      button.disabled = !prompt?.is_your_turn || game.busy || !recordingReady;
      button.classList.toggle("selected", String(choice) === selectedAnswer);
      choices.appendChild(button);
    }
    $("#flashSubmit").disabled = !prompt?.is_your_turn || game.busy || !recordingReady;
    $("#flashTimeout").disabled = !prompt?.is_your_turn || game.busy || !recordingReady;
    $("#flashAnswerForm").hidden = !prompt || state.status !== "live" || !recordingReady;
    $("#flashHint").textContent = recordingReady
      ? tr("game.answerNormalization", "Answers ignore case, punctuation, and extra spacing.")
      : tr("game.allowBeforeAnswer", "Allow camera and microphone capture above before answering.");
    // Flash questions are single-attempt questions. A miss or timeout is
    // resolved server-side and never handed to the opponent. The public state
    // also never contains the correct answer, so the UI has nothing to reveal.
    $("#flashPassBanner").classList.toggle("show", Boolean(prompt));
    $("#flashResult").hidden = !["completed", "cancelled", "voided"].includes(state.status);
    if (!$("#flashResult").hidden) {
      $("#flashResultTitle").textContent = state.status === "completed" ? tr("game.matchComplete", "Match complete.") : tr("game.matchClosed", "Match closed.");
      $("#flashResultCopy").textContent = state.status === "completed" ? tr("game.scoreReady", "Your final score is ready.") : tr("game.closed", "This room closed before play could finish.");
    }
  }

  function renderBoxGame(game) {
    const state = game.state || {};
    const players = Array.isArray(state.players) ? state.players : [];
    $("#boxScoreboard").innerHTML = players.map((player) => `<div class="box-player${player.is_you ? " you" : ""}${player.seat === state.current_turn_seat ? " active" : ""}"><span>${player.is_you ? htmlEscape(tr("game.you", "YOU")) : `${htmlEscape(tr("game.seat", "SEAT"))} ${Number(player.seat) + 1}`}</span><strong>${htmlEscape(player.score ?? 0)}</strong></div>`).join("");
    $("#boxSelector").textContent = state.current_question_id ? `${tr("game.seat", "SEAT")} ${Number(state.current_turn_seat ?? 0) + 1}` : state.current_selector_seat === undefined ? "—" : `${tr("game.seat", "SEAT")} ${Number(state.current_selector_seat) + 1}`;
    const recordingReady = Boolean(game.recording?.consented);
    $("#liveBoxBoard").innerHTML = (Array.isArray(state.board) ? state.board : []).map((tile) => `<button type="button" title="${htmlEscape(localizedCategory(tile.category))} · ${htmlEscape(tile.value)}" data-box-question="${htmlEscape(tile.id)}" class="${htmlEscape(tile.state)}"${tile.state !== "available" || !state.can_select_tile || game.busy || !recordingReady ? " disabled" : ""}>${htmlEscape(tile.value)}</button>`).join("");
    const prompt = state.prompt;
    const promptNode = $("#boxPrompt");
    if (!prompt) {
      promptNode.classList.remove("active-prompt");
      promptNode.innerHTML = `<div class="empty-prompt"><span class="prompt-icon">▦</span><strong>${htmlEscape(state.status === "open" ? tr("game.waitFive", "Waiting for five seats.") : tr("game.chooseTile", "Choose an available tile when it is your turn."))}</strong><p>${htmlEscape(state.status === "live" ? tr("game.clueAfterChoice", "The clue will appear after the current player chooses a tile.") : tr("game.roomReady", "The room is getting ready."))}</p></div>`;
    } else {
      promptNode.classList.add("active-prompt");
      promptNode.innerHTML = `<div class="prompt-kicker"><span>${htmlEscape(localizedCategory(prompt.category).toUpperCase())}</span><span>${htmlEscape(prompt.point_value || "")} ${htmlEscape(tr("game.points", "POINTS"))} · ${prompt.is_your_turn ? htmlEscape(tr("game.yourTry", "YOUR TRY")) : `${htmlEscape(tr("game.seat", "SEAT"))} ${Number(prompt.current_turn_seat) + 1} ${htmlEscape(tr("game.try", "TRY"))}`}</span></div><h4></h4>`;
      promptNode.querySelector("h4").textContent = String(prompt.question_text || "");
    }
    $("#boxAnswerForm").hidden = !prompt || !prompt.is_your_turn || state.status !== "live" || !recordingReady;
    $("#boxSubmit").disabled = game.busy || !recordingReady;
    $("#boxTimeout").disabled = game.busy || !recordingReady;
    $("#boxPassBanner").classList.toggle("show", Boolean(prompt && Number(prompt.current_attempt_index || 0) > 0));
    if (["completed", "cancelled", "voided"].includes(state.status)) {
      promptNode.innerHTML = `<div class="prompt-kicker"><span>${htmlEscape(tr("game.roomClosed", "ROOM CLOSED"))}</span><span>${htmlEscape(tr(`status.${String(state.status).toLowerCase()}`, String(state.status).toUpperCase()))}</span></div><h4>${htmlEscape(tr("game.roomComplete", "This room is complete."))}</h4>`;
      $("#boxAnswerForm").hidden = true;
    }
    renderRecordingUi();
  }

  async function selectTile(questionId) {
    const game = appState.game;
    if (!game || game.busy) return;
    game.busy = true;
    renderGame();
    try { game.state = await api(`/api/matches/${game.matchId}/select`, { method: "POST", body: { questionId } }); game.deadline = game.state.prompt?.remaining_ms ? Date.now() + Number(game.state.prompt.remaining_ms) : 0; }
    catch (error) { handleError(error); }
    finally { game.busy = false; renderGame(); }
  }

  async function submitGameAttempt(timedOut = false) {
    const game = appState.game;
    const prompt = game?.state?.prompt;
    if (!game || !prompt || game.busy || !prompt.is_your_turn) return;
    const answer = game.mode === "flash" ? $("#flashAnswer").value : $("#boxAnswer").value;
    if (!timedOut && !String(answer || "").trim()) return toast(tr("game.answerRequired", "Enter or choose an answer first."));
    game.busy = true;
    try {
      game.state = await api(`/api/matches/${game.matchId}/${timedOut ? "expire" : "answer"}`, { method: "POST", body: { questionId: prompt.id, ...(timedOut ? {} : { answer }), clientNonce: requestId() } });
      game.deadline = game.state.prompt?.remaining_ms ? Date.now() + Number(game.state.prompt.remaining_ms) : 0;
      if (game.mode === "box") $("#boxAnswer").value = "";
    } catch (error) { handleError(error); }
    finally { game.busy = false; game.timeoutPending = false; renderGame(); }
  }

  function closeGame() {
    const status = appState.game?.state?.status;
    if (status && !["completed", "cancelled", "voided"].includes(status)) {
      toast(tr("game.keepOpen", "Keep this match open until it finishes; camera and microphone capture are required for the full game."));
      return;
    }
    void stopRecording(true);
    clearGameTimers();
    appState.game = null;
    $("#gameModal").hidden = true;
  }

  function recordingMimeType() {
    const choices = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
    return window.MediaRecorder?.isTypeSupported ? choices.find((mime) => window.MediaRecorder.isTypeSupported(mime)) || "video/webm" : "video/webm";
  }

  async function hashBlob(blob) {
    if (!window.crypto?.subtle) return null;
    const digest = await window.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function renderRecordingUi() {
    const game = appState.game;
    if (!game) return;
    const recording = game.recording;
    const active = recording?.recorder?.state === "recording";
    const terminal = ["completed", "cancelled", "voided"].includes(game.state?.status);
    const retryable = Boolean(recording?.error && recording?.chunks?.length && terminal);
    const statusPair = recording?.uploaded ? ["recording.statusUploaded", "UPLOADED"] : recording?.uploading ? ["recording.statusUploading", "UPLOADING"] : active ? ["recording.statusCapturing", "CAPTURING"] : retryable ? ["recording.statusRetry", "RETRY"] : recording?.stopped ? ["recording.statusStopped", "STOPPED"] : recording?.error ? ["recording.statusBlocked", "BLOCKED"] : ["recording.statusNotActive", "NOT ACTIVE"];
    const status = tr(statusPair[0], statusPair[1]);
    const message = recording?.uploaded ? tr("recording.savedShort", "Saved for fair-play review") : recording?.uploading ? tr("recording.saving", "Saving your recording…") : active ? tr("recording.active", "Camera + microphone recording") : retryable ? tr("recording.retry", "Upload failed; try again") : recording?.stopped ? tr("recording.stopped", "Capture stopped; finishing up") : recording?.error || tr("recording.allow", "Allow camera and microphone before answering");
    const statusNode = $("#recordingStatus");
    if (statusNode) {
      statusNode.textContent = status;
      statusNode.classList.toggle("active", active);
    }
    const indicator = $("#recordingIndicator");
    if (indicator) {
      const dot = document.createElement("span");
      dot.className = "status-dot";
      const copy = document.createElement("span");
      copy.textContent = message;
      indicator.replaceChildren(dot, copy);
      indicator.classList.toggle("active", active);
    }
    $("#recordingConsentButton").hidden = Boolean(active || recording?.uploading || recording?.uploaded || recording?.stopped || retryable);
    // Stopping capture during a live room would create an unrecorded match.
    // The recorder is stopped automatically only after the server reports a
    // terminal match state.
    $("#recordingStopButton").hidden = !(active && terminal);
    $("#recordingRetryButton").hidden = !retryable || Boolean(recording?.uploading);
    $("#recordingPreview").hidden = !active;
  }

  async function loadRecordingState(generation = authGeneration) {
    const game = appState.game;
    if (!game) return;
    try {
      const state = await api(`/api/matches/${game.matchId}/recording/state`);
      if (generation !== authGeneration || appState.game !== game) return;
      game.recordingId = state?.recording_id || null;
      game.recording = { ...(game.recording || {}), consented: Boolean(state?.consented) };
      renderGame();
    } catch (error) { handleError(error, false); }
  }

  async function startRecording() {
    const game = appState.game;
    if (!game || game.recording?.recorder?.state === "recording") return;
    const generation = authGeneration;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast(tr("recording.notSupported", "This browser cannot use camera and microphone capture."));
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (generation !== authGeneration || appState.game !== game) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mime = recordingMimeType();
      let recorder;
      try { recorder = new MediaRecorder(stream, { mimeType: mime }); } catch (_) { recorder = new MediaRecorder(stream); }
      const recording = { stream, recorder, chunks: [], startedAt: Date.now(), durationMs: null, mimeType: (recorder.mimeType || mime).split(";", 1)[0].toLowerCase(), uploaded: false };
      game.recording = recording;
      recorder.addEventListener("dataavailable", (event) => { if (event.data?.size) recording.chunks.push(event.data); });
      recorder.addEventListener("error", () => { recording.error = tr("recording.captureFailed", "Capture failed."); renderRecordingUi(); });
      $("#recordingPreview").srcObject = stream;
      recorder.start(1000);
      // Start the local recorder before granting the server-side consent. This
      // removes the race where the server could start the room after consent
      // while MediaRecorder construction was still failing.
      const consent = await api(`/api/matches/${game.matchId}/recording/consent`, { method: "POST", body: { cameraGranted: true, microphoneGranted: true, consentVersion: "game-recording-v2" } });
      if (generation !== authGeneration || appState.game !== game) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      game.recordingId = consent?.recording_id || game.recordingId;
      recording.consented = true;
      recording.stopTimer = window.setTimeout(() => { void stopRecording(true); }, 1_200_000);
      renderRecordingUi();
      toast(tr("recording.ready", "Camera and microphone are ready."));
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      game.recording = { error: error.message === "AUTH_REQUIRED" ? tr("recording.signIn", "Sign in to record.") : tr("recording.consentIncomplete", "Consent was not completed.") };
      renderRecordingUi();
      handleError(error, false);
    }
  }

  async function stopRecording(upload) {
    const game = appState.game;
    const recording = game?.recording;
    if (!game || !recording || recording.stopping || recording.uploaded) return;
    recording.stopping = true;
    if (recording.stopTimer) window.clearTimeout(recording.stopTimer);
    recording.stopTimer = null;
    if (recording.recorder && recording.recorder.state !== "inactive") await new Promise((resolve) => { recording.recorder.addEventListener("stop", resolve, { once: true }); recording.recorder.stop(); });
    recording.stream?.getTracks().forEach((track) => track.stop());
    $("#recordingPreview").srcObject = null;
    const blob = new Blob(recording.chunks || [], { type: recording.mimeType || "video/webm" });
    if (!upload || !game.recordingId || !blob.size) {
      recording.stopped = Boolean(blob.size);
      recording.stopping = false;
      renderRecordingUi();
      return;
    }
    try {
      recording.error = null;
      recording.stopped = true;
      recording.uploading = true;
      renderRecordingUi();
      const durationMs = recording.durationMs || Math.max(1000, Math.min(Date.now() - recording.startedAt, 1_200_000));
      recording.durationMs = durationMs;
      const clientSha256 = await hashBlob(blob);
      const prepared = await api(`/api/matches/${game.matchId}/recording/upload-url`, { method: "POST", body: { recordingId: game.recordingId, mimeType: recording.mimeType, bytes: blob.size, durationMs } });
      const uploadResponse = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "content-type": recording.mimeType, "x-upsert": "true" }, body: blob });
      if (!uploadResponse.ok) throw new Error("RECORDING_UPLOAD_FAILED");
      await api(`/api/matches/${game.matchId}/recording/complete`, { method: "POST", body: { recordingId: game.recordingId, mimeType: recording.mimeType, durationMs, clientSha256 } });
      recording.uploading = false;
      recording.uploaded = true;
      toast(tr("recording.saved", "Your recording was saved for fair-play review."));
    } catch (error) {
      recording.uploading = false;
      recording.stopping = false;
      recording.error = tr("recording.uploadFailed", "Recording upload failed; the match result is unaffected.");
      handleError(error, false);
    }
    renderRecordingUi();
  }

  function giftLabel(code) { return { free_game_5: tr("gift.freeGame", "Free $5 game"), free_token: tr("gift.freeToken", "Free token"), deposit_bonus_5: tr("gift.depositBonus", "5% extra on your next deposit"), nothing: tr("gift.nothing", "Nothing this time") }[code] || tr("gift.recorded", "Reward recorded"); }

  function giftGlyph(god) { return { zeus: "ϟ", athena: "☉", poseidon: "♆", ares: "⚔", hermes: "➹" }[god] || "ϟ"; }

  function setWheelRotation(value) {
    const wheel = $("#dailyGiftWheel");
    if (!wheel) return;
    dailyWheelRotation = Number.isFinite(value) ? value : dailyWheelRotation;
    wheel.style.transform = `rotate(${dailyWheelRotation}deg)`;
  }

  function reducedMotion() {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  function cancelWheelMotion() {
    if (dailyWheelMotionFrame !== null) {
      window.cancelAnimationFrame?.(dailyWheelMotionFrame);
      dailyWheelMotionFrame = null;
    }
    const wheel = $("#dailyGiftWheel");
    if (wheel) {
      wheel.classList.remove("spinning");
      wheel.removeAttribute("aria-busy");
      wheel.style.transition = "none";
    }
  }

  function startWheelMotion() {
    const wheel = $("#dailyGiftWheel");
    if (!wheel) return;
    cancelWheelMotion();
    if (reducedMotion()) return;
    wheel.style.transition = "none";
    wheel.classList.add("spinning");
    wheel.setAttribute("aria-busy", "true");
    dailyWheelMotionLast = window.performance?.now?.() || Date.now();
    const tick = (now) => {
      if (!wheel.isConnected) return cancelWheelMotion();
      const elapsed = Math.max(0, Math.min(100, now - dailyWheelMotionLast));
      dailyWheelMotionLast = now;
      dailyWheelRotation += elapsed * 0.72;
      setWheelRotation(dailyWheelRotation);
      dailyWheelMotionFrame = window.requestAnimationFrame(tick);
    };
    dailyWheelMotionFrame = window.requestAnimationFrame(tick);
  }

  function setWheelGodInstant(god) {
    const index = SUPPORTED_GODS.indexOf(String(god || ""));
    if (index < 0) return cancelWheelMotion();
    cancelWheelMotion();
    // The pointer is at 12 o'clock. Point the center of the winning segment at it.
    const segmentCenter = index * 72 + 36;
    const turns = Math.round(dailyWheelRotation / 360);
    setWheelRotation(turns * 360 - segmentCenter);
  }

  async function animateWheelToGod(god) {
    const wheel = $("#dailyGiftWheel");
    const index = SUPPORTED_GODS.indexOf(String(god || ""));
    if (!wheel || index < 0) return cancelWheelMotion();
    if (reducedMotion()) return setWheelGodInstant(god);
    cancelWheelMotion();
    wheel.classList.add("spinning");
    wheel.setAttribute("aria-busy", "true");
    const segmentCenter = index * 72 + 36;
    const currentMod = ((dailyWheelRotation % 360) + 360) % 360;
    const alignment = ((-segmentCenter - currentMod) % 360 + 360) % 360;
    const target = dailyWheelRotation + (4 * 360) + alignment;
    wheel.style.transition = "transform 4.8s cubic-bezier(.12, .83, .18, 1)";
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        setWheelRotation(target);
        window.setTimeout(resolve, 4850);
      });
    });
    dailyWheelRotation = target;
    cancelWheelMotion();
    setWheelRotation(target);
  }

  function applyGiftVisual(result) {
    const god = String(result?.god_key || "");
    const container = document.querySelector(".daily-gift");
    const animation = $("#dailyGodAnimation");
    const godRow = $("#dailyGodRow");
    if (container) {
      container.classList.remove(...SUPPORTED_GODS.map((item) => `god-${item}`));
      if (god) container.classList.add(`god-${god}`);
    }
    if (animation) animation.textContent = giftGlyph(god);
    godRow?.querySelectorAll("[data-god]").forEach((node) => node.classList.toggle("active", node.dataset.god === god));
  }

  async function spinDailyGift() {
    if (!appState.session) return toast(tr("ui.signInFirst", "Sign in before claiming the daily gift."));
    const button = $("#dailyGiftSpin");
    if (button) button.disabled = true;
    startWheelMotion();
    try {
      const result = await api("/api/daily-gift", { method: "POST", body: {} });
      appState.dailyGift = result;
      applyGiftVisual(result);
      await animateWheelToGod(result.god_key);
      $("#dailyGiftResult").innerHTML = `<span class="gift-result-label">${htmlEscape(tr("gift.status", "TODAY’S GIFT"))}</span><strong>${htmlEscape(giftLabel(result.reward_code))}</strong><small>${htmlEscape(result.already_claimed ? tr("ui.alreadyClaimed", "Already claimed today.") : tr("gift.enjoy", "Enjoy your reward."))}</small>`;
    } catch (error) { cancelWheelMotion(); handleError(error); }
    finally { if (button) button.disabled = false; }
  }

  async function loadDailyGift(generation = authGeneration) {
    if (!appState.session) return;
    try {
      const result = await api("/api/daily-gift");
      if (generation !== authGeneration) return;
      appState.dailyGift = result;
      applyGiftVisual(result);
      if (result.god_key) setWheelGodInstant(result.god_key);
      $("#dailyGiftResult").innerHTML = result.claimed
        ? `<span class="gift-result-label">${htmlEscape(tr("gift.status", "TODAY’S GIFT"))}</span><strong>${htmlEscape(giftLabel(result.reward_code))}</strong><small>${htmlEscape(tr("ui.alreadyClaimed", "Already claimed today."))}</small>`
        : `<span class="gift-result-label">${htmlEscape(tr("gift.status", "TODAY’S GIFT"))}</span><strong>${htmlEscape(tr("gift.ready", "Ready to spin"))}</strong><small>${htmlEscape(tr("gift.savedAutomatically", "Your result is saved automatically."))}</small>`;
    } catch (error) { handleError(error, false); }
  }

  function updatePayoutTier() {
    const tier = $("#payoutTier");
    if (!tier) return;
    tier.querySelector("strong").textContent = tr("payout.identityRequired", "Identity check required");
    tier.querySelector("span:not(.tier-tag)").textContent = tr("payout.manualReview", "Every payout includes a quick manual identity review.");
    tier.querySelector(".tier-tag").textContent = tr("payout.required", "REQUIRED");
  }

  async function submitPayout() {
    const amount = $("#payoutAmount")?.value?.trim();
    const cashoutCode = $("#cashoutCode")?.value || "";
    if (!amount || !cashoutCode) return toast(tr("payout.securityFields", "Enter an amount and your saved cashout code."));
    try {
      const result = await api("/api/payouts/request", { method: "POST", body: { amountUsdt: amount, cashoutCode, idempotencyKey: requestId(), sourceMatchId: $("#payoutSourceMatch")?.value || null } });
      toast(tr("payout.sent", "Payout request sent for review."));
      $("#cashoutCode").value = "";
      if (appState.account?.kyc_status !== "verified") $("#kycModal").hidden = false;
      await loadAccount();
    } catch (error) { handleError(error); }
  }

  async function completeOnboarding() {
    if (!$("#termsAccepted")?.checked || !$("#privacyAccepted")?.checked) {
      return toast(tr("error.policyRequired", "Please accept the Terms of Use and Privacy Policy before saving your setup."));
    }
    const termsSections = [...document.querySelectorAll('[data-policy-section="terms"]')].filter((input) => input.checked).map((input) => input.value);
    const privacySections = [...document.querySelectorAll('[data-policy-section="privacy"]')].filter((input) => input.checked).map((input) => input.value);
    if (termsSections.length !== 10 || privacySections.length !== 10) {
      return toast(tr("error.policySections", "Review and confirm every Terms and Privacy section before saving your setup."));
    }
    const securityAnswer = $("#securityAnswer")?.value || "";
    const cashoutCode = $("#onboardingCashoutCode")?.value || "";
    if ((securityAnswer && !cashoutCode) || (!securityAnswer && cashoutCode)) {
      return toast(tr("onboarding.securityPair", "Enter both withdrawal-security fields, or leave both blank for now."));
    }
    const body = { walletAddress: $("#onboardingWallet")?.value?.trim(), chainId: Number($("#onboardingChain")?.value), securityQuestionKey: $("#securityQuestionKey")?.value, securityAnswer, cashoutCode, termsAccepted: true, privacyAccepted: true, termsVersion: POLICY_VERSIONS.terms, privacyVersion: POLICY_VERSIONS.privacy, termsSections, privacySections };
    try {
      await api("/api/account/create", { method: "POST", body });
      if (securityAnswer && cashoutCode) {
        await api("/api/onboarding/complete", { method: "POST", body });
      }
      $("#securityAnswer").value = "";
      $("#onboardingCashoutCode").value = "";
      toast(securityAnswer && cashoutCode ? tr("onboarding.securitySaved", "Your account and payout security are saved.") : tr("onboarding.accountCreated", "Your account is created. Add withdrawal security before requesting a payout."));
      await loadAccount();
    } catch (error) { handleError(error); }
  }

  async function startKyc() {
    const button = $("#startKyc");
    const selfie = $("#kycSelfie")?.files?.[0];
    const photoId = $("#kycPhotoId")?.files?.[0];
    const files = { selfie, photo_id_address: photoId };
    if (!$("#kycPrivacyConsent")?.checked) return toast(tr("error.kycConsent", "Confirm the KYC privacy consent before submitting."));
    if (!selfie || !photoId) return toast(tr("error.kycDocuments", "Select both a selfie and a photo ID showing your address."));
    for (const file of Object.values(files)) {
      if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type.toLowerCase())) return toast(tr("error.kycFormat", "KYC files must be JPG, PNG, or WebP images."));
      if (file.size < 1 || file.size > 8_000_000) return toast(tr("error.kycSize", "Each KYC image must be 8 MB or smaller."));
    }
    const body = {
      privacyConsent: true,
      legalFirstName: $("#kycLegalFirstName")?.value || "",
      legalLastName: $("#kycLegalLastName")?.value || "",
      dateOfBirth: $("#kycDateOfBirth")?.value || "",
      countryCode: $("#kycCountryCode")?.value || "",
      addressLine1: $("#kycAddressLine1")?.value || "",
      addressLine2: $("#kycAddressLine2")?.value || "",
      city: $("#kycCity")?.value || "",
      region: $("#kycRegion")?.value || "",
      postalCode: $("#kycPostalCode")?.value || "",
    };
    if (button) button.disabled = true;
    try {
      const prepared = await api("/api/kyc/prepare", { method: "POST", body });
      const preparedDocs = Array.isArray(prepared?.documents) ? prepared.documents : [];
      const byType = new Map(preparedDocs.map((doc) => [doc.documentType, doc]));
      const uploaded = {};
      for (const documentType of ["selfie", "photo_id_address"]) {
        const doc = byType.get(documentType);
        const file = files[documentType];
        if (!doc?.documentId || !doc.uploadUrl || !file) throw new Error("KYC_UPLOAD_PREPARE_FAILED");
        const uploadResponse = await fetch(doc.uploadUrl, {
          method: "PUT",
          headers: { "content-type": file.type.toLowerCase(), "x-upsert": "true" },
          body: file,
        });
        if (!uploadResponse.ok) throw new Error("KYC_UPLOAD_FAILED");
        const sha256 = await hashBlob(file);
        if (!sha256) throw new Error("KYC_DOCUMENT_HASH_INVALID");
        uploaded[documentType] = { documentId: doc.documentId, bytes: file.size, mimeType: file.type.toLowerCase(), sha256 };
      }
      await api("/api/kyc/complete", { method: "POST", body: { submissionId: prepared.submissionId, documents: uploaded } });
      $("#kycModal").hidden = true;
      toast(tr("kyc.submitted", "Your identity documents were submitted for review."));
      await loadAccount();
    } catch (error) { handleError(error); }
    finally { if (button) button.disabled = false; }
  }

  function handleError(error, show = true) {
    const code = error instanceof Error ? error.message : "REQUEST_FAILED";
    if (show) {
      const messages = { API_NOT_CONFIGURED: "error.apiConfigured", AUTH_REQUIRED: "error.authRequired", ACCOUNT_NOT_ONBOARDED: "error.notOnboarded", INSUFFICIENT_BALANCE: "error.insufficient", KYC_CONSENT_REQUIRED: "error.kycConsent", KYC_DOCUMENTS_REQUIRED: "error.kycDocuments", KYC_UPLOAD_FAILED: "error.kycUpload", KYC_DOCUMENT_INTEGRITY_FAILED: "error.kycIntegrity", POLICY_ACCEPTANCE_REQUIRED: "error.policyRequired", POLICY_VERSION_INVALID: "error.policyVersion", SUPABASE_SDK_INVALID: "error.sdk", METAMASK_AUTH_UNAVAILABLE: "error.metaMaskUnavailable", METAMASK_UNAVAILABLE: "error.metaMaskUnavailable", WALLET_IDENTITY_MISMATCH: "error.walletMismatch", UNSUPPORTED_CHAIN: "error.unsupportedChain" };
      const friendly = messages[code] ? (window.TriviaI18n?.t?.(messages[code]) || code) : null;
      const diagnostic = diagnosticError(error, error?.route);
      toast(friendly ? `${friendly} ${diagnostic}` : diagnostic);
    }
    console.error("[ChestPlayer]", diagnosticError(error, error?.route));
    return code;
  }

  function bindEvents() {
    $$("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
    $$("[data-close-game]").forEach((button) => button.addEventListener("click", closeGame));
    $$("[data-close-modal]").forEach((button) => button.addEventListener("click", () => { $("#kycModal").hidden = true; }));
    $("#kycModal")?.addEventListener("click", (event) => { if (event.target.id === "kycModal") event.currentTarget.hidden = true; });
    $("#dailyGiftSpin")?.addEventListener("click", () => void spinDailyGift());
    $("#flashMarketCategory")?.addEventListener("change", () => void loadFlashMarket());
    $("#seekFlashMatch")?.addEventListener("click", () => void seekFlashMatch());
    $("#flashMarketGrid")?.addEventListener("click", (event) => void handleMarketAction(event));
    $("#flashOfferGrid")?.addEventListener("click", (event) => void handleMarketAction(event));
    $("#flashCategoryStrip")?.addEventListener("click", (event) => { const button = event.target.closest("[data-market-category]"); if (button) { $("#flashMarketCategory").value = button.dataset.marketCategory; void loadFlashMarket(); } });
    $("#scheduledMatchList")?.addEventListener("click", (event) => { const button = event.target.closest("[data-join-match]"); if (button) void openServerGame(button.dataset.joinMode === "box" ? "box" : "flash", button.dataset.joinMatch, button.dataset.joinStatus || null); });
    $$("[data-open-game]").forEach((button) => button.addEventListener("click", () => void openServerGame(button.dataset.openGame, button.dataset.matchId || null)));
    $$("[data-restart-game]").forEach((button) => button.addEventListener("click", () => { closeGame(); showView(button.dataset.restartGame === "box" ? "box" : "flash"); }));
    $("#flashAnswerForm")?.addEventListener("submit", (event) => { event.preventDefault(); void submitGameAttempt(false); });
    $("#flashChoices")?.addEventListener("click", (event) => { const button = event.target.closest("[data-flash-choice]"); if (!button) return; $("#flashAnswer").value = button.dataset.flashChoice; const prompt = appState.game?.state?.prompt; if (prompt) appState.game.answerPromptKey = `${prompt.id || ""}:${prompt.current_attempt_index || 0}:${prompt.current_turn_seat ?? ""}`; $$("#flashChoices button").forEach((choice) => choice.classList.toggle("selected", choice === button)); });
    $("#flashTimeout")?.addEventListener("click", () => void submitGameAttempt(true));
    $("#boxAnswerForm")?.addEventListener("submit", (event) => { event.preventDefault(); void submitGameAttempt(false); });
    $("#boxTimeout")?.addEventListener("click", () => void submitGameAttempt(true));
    $("#liveBoxBoard")?.addEventListener("click", (event) => { const button = event.target.closest("[data-box-question]"); if (button) void selectTile(button.dataset.boxQuestion); });
    $("#recordingConsentButton")?.addEventListener("click", () => void startRecording());
    $("#recordingStopButton")?.addEventListener("click", () => void stopRecording(["completed", "cancelled", "voided"].includes(appState.game?.state?.status)));
    $("#recordingRetryButton")?.addEventListener("click", () => void stopRecording(true));
    $("#payoutAmount")?.addEventListener("input", updatePayoutTier);
    $("#submitPayout")?.addEventListener("click", () => void submitPayout());
    $("#completeOnboarding")?.addEventListener("click", () => void completeOnboarding());
    $("#startKyc")?.addEventListener("click", () => void startKyc());
    $("#copyWallet")?.addEventListener("click", async () => { const value = appState.account?.wallet_address; if (!value) return toast(tr("wallet.noLinked", "No linked wallet is available.")); try { await navigator.clipboard.writeText(value); toast(tr("clipboard.copied", "Wallet address copied.")); } catch (_) { toast(tr("clipboard.unavailable", "Copy is unavailable in this browser.")); } });
    $("#depositInstructions")?.addEventListener("click", async (event) => { const button = event.target.closest("[data-deposit-copy]"); if (!button) return; try { await navigator.clipboard.writeText(button.dataset.depositCopy || ""); toast(tr("deposit.copied", "Deposit value copied.")); } catch (_) { toast(tr("clipboard.unavailable", "Copy is unavailable in this browser.")); } });
    window.addEventListener("trivia-locale-change", () => {
      showView(appState.view);
      const game = appState.game;
      if (game) {
        void api(`/api/matches/${game.matchId}/state?locale=${encodeURIComponent(localLocale())}`)
          .then((state) => {
            if (appState.game !== game) return;
            game.state = state;
            game.deadline = state.prompt?.remaining_ms ? Date.now() + Number(state.prompt.remaining_ms) : 0;
            renderGame();
          })
          .catch(() => { /* the normal game poller will retry */ });
      }
    });
  }

  async function onAuthChange(session) {
    const generation = ++authGeneration;
    const previousUserId = appState.session?.user?.id || null;
    const nextUserId = session?.user?.id || null;
    if (previousUserId !== nextUserId) {
      if (appState.game) {
        void stopRecording(false);
        clearGameTimers();
        appState.game = null;
        $("#gameModal").hidden = true;
      }
      if (session) renderSignedOut();
    }
    appState.session = session || null;
    renderRuntimeBanner();
    if (!session) { clearGameTimers(); appState.account = null; return renderSignedOut(); }
    try {
      const wallet = window.TriviaArenaAuth?.getWalletAddress?.() || "";
      const onboardingWallet = $("#onboardingWallet");
      if (wallet && onboardingWallet && !onboardingWallet.value) onboardingWallet.value = wallet;
    } catch (_) { /* server verifies identity */ }
    const accountReady = await loadAccount(generation);
    if (generation !== authGeneration || !appState.session) return;
    // Authenticated wallet users may view deposit instructions, but the
    // application account is not created until the agreement-gated setup is
    // submitted successfully.
    if (!accountReady) {
      if (document.body?.dataset?.page === "dashboard") {
        const params = new URLSearchParams(window.location.search);
        const language = params.get("lang") || window.TriviaI18n?.locale;
        window.location.replace(`onboarding.html${language ? `?lang=${encodeURIComponent(language)}` : ""}`);
        return;
      }
      await loadDepositInstructions(generation);
      return;
    }
    await Promise.allSettled([loadDepositInstructions(generation), loadMatches("box_5x5", generation), loadFlashMarket(generation), loadDailyGift(generation), loadPayoutSources(generation)]);
  }

  bindEvents();
  renderFlashCategories();
  renderRuntimeBanner();
  const requestedView = new URLSearchParams(window.location.search).get("view");
  showView(["arena", "flash", "box", "wallet", "security", "faq"].includes(requestedView) ? requestedView : "arena");
  window.addEventListener("trivia-auth-change", (event) => { void onAuthChange(event.detail?.session || null); });
  refreshTimer = window.setInterval(() => { if (!appState.session || appState.game) return; if (appState.view === "box") void loadMatches("box_5x5"); if (appState.view === "flash") void loadFlashMarket(); }, 15_000);
  void refreshTimer;
})();
