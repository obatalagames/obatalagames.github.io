(() => {
  "use strict";

  const DEFAULT_ORIGINS = Object.freeze({
    edge: "https://edge.chestplayer.us",
    auth: "https://athina.chestplayer.us",
    api: "https://apollo.chestplayer.us",
    game: "https://olympia.chestplayer.us",
    anticheat: "https://afentiko.chestplayer.us",
    admin: "https://attica.chestplayer.us",
  });
  const LOG_VERSION = "chestplayer-backend-test-1";
  const REQUEST_TIMEOUT_MS = 30_000;
  const logs = [];
  let latestLog = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const text = (value) => String(value ?? "");
  const valueOf = (id, fallback = "") => text(document.getElementById(id)?.value || fallback).trim();
  const locale = () => valueOf("globalLocale", "en") || "en";

  function sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function htmlEscape(value) {
    return text(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function jsonDefault(value) {
    return JSON.stringify(value ?? {}, null, 2);
  }

  function currentOrigins() {
    const origins = {};
    for (const key of Object.keys(DEFAULT_ORIGINS)) {
      const input = document.querySelector(`[data-origin="${key}"]`);
      const raw = text(input?.value || DEFAULT_ORIGINS[key]).trim().replace(/\/+$/, "");
      origins[key] = /^https:\/\//i.test(raw) ? raw : DEFAULT_ORIGINS[key];
    }
    return origins;
  }

  function buildPath(path) {
    return typeof path === "function" ? path() : path;
  }

  function uuid(id) {
    return valueOf(id, "00000000-0000-4000-8000-000000000000");
  }

  function nonce(prefix) {
    if (window.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function routeLabel(endpoint) {
    return `${endpoint.method} ${endpoint.displayPath || buildPath(endpoint.path)}`;
  }

  function endpoint(definition) {
    return Object.freeze({
      mutation: false,
      dangerous: false,
      requiresAuth: false,
      body: null,
      note: "",
      ...definition,
    });
  }

  // This is the complete browser-facing HTTP surface in the current Workers.
  // Scheduled-only callbacks are documented below because Cloudflare does not
  // expose a safe browser route for invoking them.
  const ENDPOINTS = [
    {
      section: "Edge gateway",
      items: [
        endpoint({ id: "edge-health", title: "Edge health", method: "GET", target: "edge", path: "/edge/health", note: "Confirms the canonical gateway is alive and reports session-verification mode." }),
      ],
    },
    {
      section: "Auth and session · Athina",
      items: [
        endpoint({ id: "auth-wallet-sign-in", title: "MetaMask wallet sign-in", method: "WALLET", target: "auth", special: "signIn", displayPath: "/auth/v1/token?grant_type=web3", note: "Runs the real MetaMask → Supabase Web3 flow. The page records only whether a session was created; tokens are never logged." }),
        endpoint({ id: "auth-health", title: "Auth Worker health", method: "GET", target: "auth", path: "/health", note: "Checks the Athina Worker through its edge alias." }),
        endpoint({ id: "auth-config", title: "Public auth config", method: "GET", target: "auth", path: "/config", note: "Safe public configuration only. A publishable key may appear; a service key must never appear." }),
        endpoint({ id: "auth-settings", title: "Supabase Auth settings", method: "GET", target: "auth", path: "/auth/v1/settings", note: "Checks the Supabase Auth proxy path without signing in." }),
        endpoint({ id: "auth-session", title: "Validate current session", method: "GET", target: "auth", path: "/session", requiresAuth: true, note: "Checks bearer-token validity and the server-side login-session record path." }),
        endpoint({ id: "auth-logout", title: "Remote logout", method: "POST", target: "auth", path: "/logout", requiresAuth: true, mutation: true, dangerous: true, body: {}, note: "Revokes the current remote session. Use the top Sign out button if you also want the page UI to clean up immediately." }),
        endpoint({ id: "auth-account", title: "Auth → account proxy", method: "GET", target: "edge", path: "/api/account", requiresAuth: true, note: "Verifies the segmented Auth Worker can forward account lookup to Apollo." }),
      ],
    },
    {
      section: "API boundary · Apollo",
      items: [
        endpoint({ id: "api-health", title: "API health", method: "GET", target: "api", path: "/api/health", note: "Checks Apollo's public health route. This is /api/health, not /health." }),
        endpoint({ id: "api-translations", title: "Load UI translations", method: "GET", target: "edge", path: () => `/api/translations?locale=${encodeURIComponent(locale())}`, note: "Reads the server-side translation dictionary for the selected locale." }),
        endpoint({ id: "api-client-errors", title: "Write a diagnostic client-error event", method: "POST", target: "edge", path: "/api/client-errors", mutation: true, body: () => ({ eventType: "backend-test.synthetic_probe", message: "Intentional backend test probe", route: "/api/client-errors", locale: locale(), clientVersion: LOG_VERSION, errorCode: "TEST_PROBE" }), note: "Creates one observability event by design. It does not touch a balance or game." }),
        endpoint({ id: "api-classify-payout", title: "Classify a payout amount", method: "POST", target: "edge", path: "/api/payouts/classify", requiresAuth: true, mutation: true, body: { amountUsdt: "100.00" }, note: "Runs the payout policy classifier without creating a payout. A session is still required at the edge." }),
      ],
    },
    {
      section: "Account and onboarding",
      items: [
        endpoint({ id: "account-create", title: "Create account with policy acceptance", method: "POST", target: "edge", path: "/api/account/create", requiresAuth: true, mutation: true, dangerous: true, body: { termsAccepted: false, privacyAccepted: false, termsVersion: "2026-10-18", privacyVersion: "2026-10-18", termsSections: [], privacySections: [], walletAddress: "0x0000000000000000000000000000000000000000", chainId: 1 }, note: "Default body intentionally fails at policy validation. Replace only in a controlled test account." }),
        endpoint({ id: "onboarding-complete", title: "Complete onboarding", method: "POST", target: "edge", path: "/api/onboarding/complete", requiresAuth: true, mutation: true, dangerous: true, body: { termsAccepted: false, privacyAccepted: false, termsVersion: "2026-10-18", privacyVersion: "2026-10-18", termsSections: [], privacySections: [], walletAddress: "0x0000000000000000000000000000000000000000", chainId: 1, securityQuestionKey: "first_pet", securityAnswer: "test-only", cashoutCode: "test-only-code" }, note: "Default body intentionally fails before any account state is changed." }),
      ],
    },
    {
      section: "Deposits, gifts, and payouts",
      items: [
        endpoint({ id: "deposit-instructions", title: "Deposit instructions", method: "GET", target: "edge", path: "/api/deposits/instructions", requiresAuth: true, note: "Loads the configured USDT destination and deposit instructions for the signed-in player." }),
        endpoint({ id: "deposit-credit", title: "Indexer deposit credit boundary", method: "POST", target: "edge", path: "/api/deposits/credit", mutation: true, body: { chainId: 1, tokenContract: "0x0000000000000000000000000000000000000000", txHash: "0x0000000000000000000000000000000000000000000000000000000000000000", logIndex: 0, fromWallet: "0x0000000000000000000000000000000000000000", toWallet: "0x0000000000000000000000000000000000000000", amountBaseUnits: "1", confirmations: 0 }, note: "Indexer-only route. A browser call has no DEPOSIT_INDEXER_SIGNATURE and should be rejected before ledger credit." }),
        endpoint({ id: "daily-gift-get", title: "Read daily gift", method: "GET", target: "edge", path: "/api/daily-gift", requiresAuth: true, note: "Reads today's Greek-god gift state without claiming it." }),
        endpoint({ id: "daily-gift-claim", title: "Claim daily gift", method: "POST", target: "edge", path: "/api/daily-gift", requiresAuth: true, mutation: true, dangerous: true, body: {}, note: "Claims the daily gift. The database makes this idempotent for the day." }),
        endpoint({ id: "payout-history", title: "Payout history", method: "GET", target: "edge", path: "/api/payouts/history", requiresAuth: true, note: "Reads the signed-in player's withdrawal history." }),
        endpoint({ id: "payout-sources", title: "Payout sources", method: "GET", target: "edge", path: "/api/payouts/sources", requiresAuth: true, note: "Lists eligible match sources for a withdrawal request." }),
        endpoint({ id: "payout-request", title: "Submit payout request", method: "POST", target: "edge", path: "/api/payouts/request", requiresAuth: true, mutation: true, dangerous: true, body: () => ({ amountUsdt: "5.00", cashoutCode: "test-only-placeholder", idempotencyKey: nonce("backend-test-payout"), sourceMatchId: null }), note: "Creates a real withdrawal only if the body contains a valid cashout code and eligible balance. Leave the placeholder unchanged for a safe validation probe." }),
      ],
    },
    {
      section: "KYC",
      items: [
        endpoint({ id: "kyc-status", title: "KYC status", method: "GET", target: "edge", path: "/api/kyc/status", requiresAuth: true, note: "Reads the signed-in player's KYC status." }),
        endpoint({ id: "kyc-prepare", title: "Prepare KYC submission", method: "POST", target: "edge", path: "/api/kyc/prepare", requiresAuth: true, mutation: true, dangerous: true, body: { privacyConsent: false, legalFirstName: "Test", legalLastName: "User", dateOfBirth: "1990-01-01", countryCode: "US", addressLine1: "1 Test Street", addressLine2: "", city: "Test City", region: "TS", postalCode: "00000" }, note: "Default privacyConsent=false intentionally stops before a submission is created. Valid data creates two signed upload slots." }),
        endpoint({ id: "kyc-start-alias", title: "Prepare KYC via /start compatibility alias", method: "POST", target: "edge", path: "/api/kyc/start", requiresAuth: true, mutation: true, dangerous: true, body: { privacyConsent: false }, note: "Checks the legacy /start alias; the current handler accepts /start and /prepare." }),
        endpoint({ id: "kyc-complete", title: "Complete KYC submission", method: "POST", target: "edge", path: "/api/kyc/complete", requiresAuth: true, mutation: true, dangerous: true, body: () => ({ submissionId: uuid("kycSubmissionId"), documents: {} }), note: "Default body intentionally fails before storage integrity verification. Never paste real KYC content into the response log." }),
      ],
    },
    {
      section: "10-10 Flash Trivia market · Olympia",
      items: [
        endpoint({ id: "flash-market", title: "List open flash market", method: "GET", target: "game", path: () => `/api/flash/market?category=us_football&locale=${encodeURIComponent(locale())}&limit=5`, requiresAuth: true, note: "Lists players seeking a 10-10 match. Change locale above to verify multilingual market reads." }),
        endpoint({ id: "flash-offers", title: "List my flash offers", method: "GET", target: "game", path: "/api/flash/offers", requiresAuth: true, note: "Lists offers visible to the signed-in player." }),
        endpoint({ id: "flash-request-create", title: "Create flash match request", method: "POST", target: "game", path: "/api/flash/requests", requiresAuth: true, mutation: true, dangerous: true, body: () => ({ category: "us_football", locale: locale(), amountUsdt: "5.00", idempotencyKey: nonce("backend-test-flash") }), note: "Creates a real open request if the account has sufficient balance. Keep the amount and placeholder account state in mind." }),
        endpoint({ id: "flash-request-cancel", title: "Cancel flash request", method: "POST", target: "game", path: () => `/api/flash/requests/${uuid("flashRequestId")}/cancel`, requiresAuth: true, mutation: true, dangerous: true, body: {}, note: "Cancels only the request ID supplied above." }),
        endpoint({ id: "flash-offer-create", title: "Make a flash offer", method: "POST", target: "game", path: () => `/api/flash/requests/${uuid("flashRequestId")}/offers`, requiresAuth: true, mutation: true, dangerous: true, body: () => ({ amountUsdt: "5.00", idempotencyKey: nonce("backend-test-offer"), giftCreditType: null }), note: "Creates an offer against the supplied request ID." }),
        endpoint({ id: "flash-offer-respond", title: "Accept or deny flash offer", method: "POST", target: "game", path: () => `/api/flash/offers/${uuid("flashOfferId")}/respond`, requiresAuth: true, mutation: true, dangerous: true, body: { accept: false, giftCreditType: null }, note: "Default accept=false is the safer probe; it still requires a real offer ID to act." }),
      ],
    },
    {
      section: "Matches · Olympia",
      items: [
        endpoint({ id: "matches-list-flash", title: "List flash matches", method: "GET", target: "game", path: "/api/matches?mode=flash_10&limit=5", requiresAuth: true, note: "Lists the signed-in player's 10-10 matches." }),
        endpoint({ id: "matches-list-scheduled", title: "List scheduled matches", method: "GET", target: "game", path: "/api/matches?mode=box_5x5&limit=5", requiresAuth: true, note: "Lists the signed-in player's scheduled 5x5 matches." }),
        endpoint({ id: "match-state", title: "Read match state", method: "GET", target: "game", path: () => `/api/matches/${uuid("matchId")}/state?locale=${encodeURIComponent(locale())}`, requiresAuth: true, note: "Loads the server-authoritative state and translated prompt for the supplied match." }),
        endpoint({ id: "match-join", title: "Join match", method: "POST", target: "game", path: () => `/api/matches/${uuid("matchId")}/join`, requiresAuth: true, mutation: true, dangerous: true, body: () => ({ idempotencyKey: nonce("backend-test-join") }), note: "Joins only the supplied match ID and may reserve an entry balance." }),
        endpoint({ id: "match-select", title: "Select 5x5 tile", method: "POST", target: "game", path: () => `/api/matches/${uuid("matchId")}/select`, requiresAuth: true, mutation: true, dangerous: true, body: () => ({ questionId: uuid("questionId") }), note: "Selects one server-issued tile for a scheduled match." }),
        endpoint({ id: "match-answer", title: "Submit answer", method: "POST", target: "game", path: () => `/api/matches/${uuid("matchId")}/answer`, requiresAuth: true, mutation: true, dangerous: true, body: () => ({ questionId: uuid("questionId"), answer: "test answer", clientNonce: nonce("backend-test-answer") }), note: "Submits a server-timed answer. A real question ID can advance game state." }),
        endpoint({ id: "match-expire", title: "Expire timed-out attempt", method: "POST", target: "game", path: () => `/api/matches/${uuid("matchId")}/expire`, requiresAuth: true, mutation: true, dangerous: true, body: () => ({ questionId: uuid("questionId"), clientNonce: nonce("backend-test-expire") }), note: "Marks an attempt expired only when the server says its deadline has passed." }),
      ],
    },
    {
      section: "Recording and anti-cheat · Afentiko",
      items: [
        endpoint({ id: "recording-state", title: "Read recording state", method: "GET", target: "anticheat", path: () => `/api/matches/${uuid("matchId")}/recording/state`, requiresAuth: true, note: "Checks the all-match recording gate for the supplied match." }),
        endpoint({ id: "recording-consent", title: "Record camera/microphone consent", method: "POST", target: "anticheat", path: () => `/api/matches/${uuid("matchId")}/recording/consent`, requiresAuth: true, mutation: true, dangerous: true, body: { cameraGranted: true, microphoneGranted: true, consentVersion: "game-recording-v2" }, note: "Records consent for the supplied match. It does not start a camera in this test page." }),
        endpoint({ id: "recording-upload-url", title: "Prepare recording upload URL", method: "POST", target: "anticheat", path: () => `/api/matches/${uuid("matchId")}/recording/upload-url`, requiresAuth: true, mutation: true, dangerous: true, body: () => ({ recordingId: uuid("recordingId"), mimeType: "video/webm", bytes: 1024, durationMs: 1000 }), note: "Prepares a private Storage upload URL when the match and recording ID are eligible. Any returned URL is redacted in this page's log." }),
        endpoint({ id: "recording-upload-info-compat", title: "Recording upload-info compatibility route", method: "POST", target: "anticheat", path: () => `/api/matches/${uuid("matchId")}/recording/upload-info`, requiresAuth: true, mutation: true, body: () => ({ recordingId: uuid("recordingId") }), note: "The current public handler exposes upload-url and complete; this button detects an accidental stale upload-info route." }),
        endpoint({ id: "recording-complete", title: "Complete recording upload", method: "POST", target: "anticheat", path: () => `/api/matches/${uuid("matchId")}/recording/complete`, requiresAuth: true, mutation: true, dangerous: true, body: () => ({ recordingId: uuid("recordingId"), mimeType: "video/webm", durationMs: 1000, clientSha256: null }), note: "Finalizes only after the server hashes a real private Storage object. The placeholder should fail without touching a valid recording." }),
      ],
    },
    {
      section: "Admin and payout review · Attica",
      items: [
        endpoint({ id: "admin-health", title: "Admin Worker health", method: "GET", target: "admin", path: "/health", note: "Checks Attica without an operator action." }),
        endpoint({ id: "admin-recording-queue", title: "List recording review queue", method: "GET", target: "admin", path: "/api/admin/recordings?status=uploaded&limit=10", requiresAuth: true, note: "Requires an ops/admin role plus the authorized admin wallet." }),
        endpoint({ id: "admin-withdrawal-queue", title: "List withdrawal review queue", method: "GET", target: "admin", path: "/api/admin/withdrawals?status=pending&limit=10", requiresAuth: true, note: "Loads manually reviewed payout requests." }),
        endpoint({ id: "admin-kyc-queue", title: "List KYC review queue", method: "GET", target: "admin", path: "/api/admin/kyc?status=submitted&limit=10", requiresAuth: true, note: "Loads KYC submissions for manual review." }),
        endpoint({ id: "admin-audit", title: "List audit events", method: "GET", target: "admin", path: "/api/admin/audit?limit=20", requiresAuth: true, note: "Reads the protected operator audit stream." }),
        endpoint({ id: "admin-recording-review-url", title: "Get recording review URL", method: "GET", target: "admin", path: () => `/api/admin/recordings/${uuid("recordingId")}/review-url`, requiresAuth: true, note: "Returns a short-lived private review URL. The URL is redacted in this console." }),
        endpoint({ id: "admin-kyc-review-url", title: "Get KYC document review URL", method: "GET", target: "admin", path: () => `/api/admin/kyc/${uuid("kycSubmissionId")}/documents/${uuid("kycDocumentId")}/review-url`, requiresAuth: true, note: "Returns a short-lived private KYC document URL. The URL is redacted in this console." }),
        endpoint({ id: "admin-recording-review", title: "Review a recording", method: "POST", target: "admin", path: () => `/api/admin/recordings/${uuid("recordingId")}/review`, requiresAuth: true, mutation: true, dangerous: true, body: { action: "flag", note: "Backend test probe" }, note: "Changes a recording review status only for the supplied recording ID." }),
        endpoint({ id: "admin-kyc-review", title: "Review KYC submission", method: "POST", target: "admin", path: () => `/api/admin/kyc/${uuid("kycSubmissionId")}/review`, requiresAuth: true, mutation: true, dangerous: true, body: { action: "needs_info", signature: "test-only-operator-signature", justification: "Backend test probe; no decision requested." }, note: "The placeholder signature and ID should fail safely. A valid test payload changes KYC state." }),
        endpoint({ id: "admin-withdrawal-review", title: "Review payout", method: "POST", target: "admin", path: () => `/api/admin/withdrawals/${uuid("withdrawalId")}/review`, requiresAuth: true, mutation: true, dangerous: true, body: { action: "hold", signature: "test-only-operator-signature", justification: "Backend test probe; hold only." }, note: "Payout review is a protected money operation. Use a dedicated test request and operator wallet." }),
        endpoint({ id: "admin-delete-recording", title: "Delete payout recording", method: "POST", target: "admin", path: () => `/api/admin/withdrawals/${uuid("withdrawalId")}/recording/delete`, requiresAuth: true, mutation: true, dangerous: true, body: () => ({ recordingId: uuid("recordingId"), signature: "test-only-operator-signature", justification: "Backend test probe; do not delete a real recording." }), note: "Destructive. It deletes a private Storage object and finalizes deletion in the database." }),
        endpoint({ id: "admin-reconcile", title: "Run scheduled reconciliation", method: "POST", target: "admin", path: "/api/admin/reconcile", requiresAuth: true, mutation: true, dangerous: true, body: {}, note: "Runs scheduled-match reconciliation immediately. Use only in a controlled environment." }),
      ],
    },
  ].map((section) => ({ ...section, items: section.items.map((item) => Object.freeze(item)) }));

  function safeKey(key) {
    return ["access_token", "refresh_token", "token", "authorization", "apikey", "service_role", "secret", "private_key", "cashoutcode", "securityanswer", "signature", "uploadurl", "reviewurl", "signedurl", "objectpath"].some((part) => key.toLowerCase().replaceAll("_", "").includes(part));
  }

  function redactText(value) {
    return text(value)
      .replace(/eyJ[A-Za-z0-9_-]{20,}/g, "[redacted-jwt]")
      .replace(/([?&](?:token|signature|access_token|refresh_token|apikey|code)=)[^&\s]+/gi, "$1[redacted]")
      .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[redacted]");
  }

  function redact(value, key = "") {
    if (safeKey(key)) return "[redacted]";
    if (typeof value === "string") return redactText(value);
    if (Array.isArray(value)) return value.map((item) => redact(item, key));
    if (value && typeof value === "object") {
      const output = {};
      for (const [childKey, childValue] of Object.entries(value)) output[childKey] = redact(childValue, childKey);
      return output;
    }
    return value;
  }

  function safeHeaders(response) {
    const names = ["content-type", "cache-control", "retry-after", "cf-ray", "x-request-id", "x-error-code", "x-error-source", "x-error-category", "x-content-type-options"];
    const output = {};
    for (const name of names) {
      const value = response.headers.get(name);
      if (value) output[name] = redactText(value);
    }
    return output;
  }

  async function readBody(response) {
    const raw = await response.text();
    if (!raw) return { value: null, raw: "" };
    try {
      return { value: redact(JSON.parse(raw)), raw: redactText(raw) };
    } catch (_) {
      return { value: redactText(raw), raw: redactText(raw) };
    }
  }

  function responseDiagnostic(body, headers, endpointDef, status) {
    const object = body && typeof body === "object" && !Array.isArray(body) ? body : {};
    const nested = object.error && typeof object.error === "object" && !Array.isArray(object.error) ? object.error : {};
    const diagnostic = object.diagnostic && typeof object.diagnostic === "object" && !Array.isArray(object.diagnostic)
      ? object.diagnostic
      : nested.diagnostic && typeof nested.diagnostic === "object" && !Array.isArray(nested.diagnostic) ? nested.diagnostic : {};
    const sourceCode = text(diagnostic.sourceCode || nested.sourceCode || headers["x-error-source"] || (typeof object.error === "string" ? object.error : object.code) || (status >= 400 ? `HTTP_${status}` : "OK"));
    const requestId = text(headers["x-request-id"] || object.requestId || diagnostic.requestId || "");
    const service = text(diagnostic.service || endpointDef.target || "browser");
    const route = text(diagnostic.route || buildPath(endpointDef.path || endpointDef.displayPath || ""));
    const stage = text(diagnostic.stage || `${service}.${route.replace(/^\/+/, "").replaceAll("/", ".")}`);
    const hasResponse = status !== null;
    return {
      failurePoint: hasResponse ? `${service} · ${stage}` : "browser.fetch · no HTTP response",
      requestId: requestId || "not returned",
      diagnosticCode: text(diagnostic.diagnosticCode || headers["x-error-code"] || "not returned"),
      sourceCode,
      category: text(diagnostic.category || headers["x-error-category"] || (hasResponse ? "http" : "browser_network")),
      stage,
      status: hasResponse ? status : "no HTTP response",
      title: text(diagnostic.title || (hasResponse ? (status >= 400 ? "HTTP response rejected" : "Request completed") : "Browser could not read an HTTP response")),
      summary: text(diagnostic.summary || (hasResponse ? "The page received a response from the selected route." : "fetch() rejected before a response was available to JavaScript.")),
      likelyCause: text(diagnostic.likelyCause || (hasResponse ? "The selected Worker returned this status." : "CORS, DNS, TLS, an extension, network failure, or a browser policy blocked the response.")),
      nextAction: text(diagnostic.nextAction || (hasResponse ? "Use the source code, stage, and request ID to correlate Worker and Supabase logs." : "Open DevTools Network and the edge Worker logs; there is no server request ID to correlate.")),
      retryable: typeof diagnostic.retryable === "boolean" ? diagnostic.retryable : null,
      checks: Array.isArray(diagnostic.checks) ? diagnostic.checks.map((item) => text(item)) : [],
    };
  }

  function updateSessionStatus(message, tone = "") {
    const node = $("#authState");
    if (!node) return;
    node.className = `auth-state ${tone}`.trim();
    node.replaceChildren();
    const dot = document.createElement("span");
    dot.className = "status-dot";
    const copy = document.createElement("span");
    copy.textContent = text(message);
    node.append(dot, copy);
  }

  async function activeToken() {
    if (!$("#attachToken")?.checked) return null;
    if ($( "#useManualToken")?.checked) return valueOf("manualToken") || null;
    try {
      return await window.TriviaArenaAuth?.getAccessToken?.() || null;
    } catch (error) {
      return null;
    }
  }

  function makeUrl(endpointDef) {
    const origin = currentOrigins()[endpointDef.target];
    const path = buildPath(endpointDef.path || endpointDef.displayPath || "/");
    return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  }

  function requestBodyFromCard(card, endpointDef) {
    if (endpointDef.method === "GET" || endpointDef.method === "WALLET") return undefined;
    const editor = $(".body-editor", card);
    const raw = editor?.value.trim() || "{}";
    try {
      return JSON.parse(raw);
    } catch (error) {
      const parseError = new Error("CLIENT_JSON_BODY_INVALID");
      parseError.detail = error?.message || "JSON.parse failed";
      throw parseError;
    }
  }

  function displayPath(endpointDef) {
    return endpointDef.displayPath || (typeof endpointDef.path === "string" ? endpointDef.path : "dynamic route; see inputs above");
  }

  function renderSections() {
    const root = $("#endpointSections");
    if (!root) return;
    root.replaceChildren();
    for (const section of ENDPOINTS) {
      const sectionNode = document.createElement("section");
      sectionNode.className = "endpoint-section";
      const heading = document.createElement("div");
      heading.className = "section-title";
      const title = document.createElement("h2");
      title.textContent = section.section;
      const count = document.createElement("span");
      count.textContent = `${section.items.length} function${section.items.length === 1 ? "" : "s"}`;
      heading.append(title, count);
      const grid = document.createElement("div");
      grid.className = "endpoint-grid";
      for (const endpointDef of section.items) grid.appendChild(renderCard(endpointDef));
      sectionNode.append(heading, grid);
      root.appendChild(sectionNode);
    }
  }

  function renderCard(endpointDef) {
    const card = document.createElement("article");
    card.className = "endpoint-card";
    card.dataset.endpointId = endpointDef.id;
    const header = document.createElement("header");
    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    const method = document.createElement("span");
    method.className = `method ${endpointDef.method.toLowerCase()}`;
    method.textContent = endpointDef.method;
    title.append(method, document.createTextNode(endpointDef.title));
    const description = document.createElement("p");
    description.textContent = endpointDef.note;
    titleWrap.append(title, description);
    const authBadge = document.createElement("span");
    authBadge.className = "status-pill";
    authBadge.textContent = endpointDef.requiresAuth ? "bearer" : "public";
    header.append(titleWrap, authBadge);

    const route = document.createElement("div");
    route.className = "route-meta";
    const target = document.createElement("span");
    target.className = "target";
    target.textContent = endpointDef.target;
    route.append(target, document.createTextNode(` · ${displayPath(endpointDef)}`));

    const body = document.createElement("div");
    body.className = "card-body";
    if (endpointDef.mutation) {
      const writeNote = document.createElement("p");
      writeNote.className = "probe-note write-note";
      writeNote.textContent = endpointDef.dangerous ? "Write probe: mutation switch required; use a test record." : "Write probe: mutation switch required.";
      body.appendChild(writeNote);
    }
    if (endpointDef.method !== "GET" && endpointDef.method !== "WALLET") {
      const controls = document.createElement("div");
      controls.className = "card-controls single";
      const label = document.createElement("label");
      label.textContent = "JSON body (editable)";
      const editor = document.createElement("textarea");
      editor.className = "body-editor";
      const initial = typeof endpointDef.body === "function" ? endpointDef.body() : endpointDef.body;
      editor.value = jsonDefault(initial || {});
      editor.spellcheck = false;
      label.appendChild(editor);
      controls.appendChild(label);
      body.appendChild(controls);
    }
    const footer = document.createElement("div");
    footer.className = "card-footer";
    const last = document.createElement("span");
    last.className = "last-result";
    last.textContent = "not run";
    const run = document.createElement("button");
    run.className = `button ${endpointDef.dangerous ? "danger" : "primary"}`;
    run.type = "button";
    run.textContent = endpointDef.method === "WALLET" ? "Run wallet flow" : "Run function";
    run.addEventListener("click", () => void runEndpoint(endpointDef, card, run, last));
    footer.append(last, run);
    body.appendChild(footer);
    card.append(header, route, body);
    return card;
  }

  function blockedLog(endpointDef, reason) {
    const entry = {
      time: new Date().toISOString(),
      kind: "blocked",
      endpointId: endpointDef.id,
      endpoint: endpointDef.title,
      method: endpointDef.method,
      target: endpointDef.target,
      url: makeUrl(endpointDef),
      durationMs: 0,
      response: null,
      diagnostic: {
        failurePoint: "browser.guard · no request sent",
        requestId: "not applicable",
        diagnosticCode: "CLIENT_MUTATION_CONFIRMATION_REQUIRED",
        sourceCode: "CLIENT_MUTATION_CONFIRMATION_REQUIRED",
        category: "browser_guard",
        stage: "browser.guard",
        status: "not sent",
        title: "Write probe blocked by page safety switch",
        summary: "The page refused to send a mutation because the write switch is off.",
        likelyCause: reason,
        nextAction: "Enable 'Enable write/destructive probes' only when using a controlled test account and record.",
        retryable: false,
        checks: [],
      },
      headers: {},
      body: null,
    };
    appendLog(entry);
    return entry;
  }

  async function runWalletFlow(endpointDef) {
    const started = performance.now();
    try {
      if (typeof window.TriviaArenaAuth?.signInWithMetaMask !== "function") throw new Error("AUTH_MODULE_NOT_LOADED");
      updateSessionStatus("Waiting for MetaMask…");
      await window.TriviaArenaAuth.signInWithMetaMask();
      await sleep(120);
      const token = await window.TriviaArenaAuth?.getAccessToken?.();
      const stateText = $("#authState")?.textContent || "";
      const ok = Boolean(token);
      const entry = {
        time: new Date().toISOString(),
        kind: ok ? "success" : "failure",
        endpointId: endpointDef.id,
        endpoint: endpointDef.title,
        method: endpointDef.method,
        target: endpointDef.target,
        url: `${currentOrigins().auth}/auth/v1/token?grant_type=web3`,
        durationMs: Math.round(performance.now() - started),
        response: ok ? { sessionCreated: true, token: "[redacted]" } : { sessionCreated: false, authState: redactText(stateText) },
        diagnostic: ok ? {
          failurePoint: "auth · Supabase Web3 session created",
          requestId: "see subsequent /session check",
          diagnosticCode: "OK",
          sourceCode: "OK",
          category: "authentication",
          stage: "auth.web3.sign_in",
          status: 200,
          title: "Wallet sign-in completed",
          summary: "MetaMask and Supabase created a browser session.",
          likelyCause: "The wallet signature and Auth proxy completed normally.",
          nextAction: "Run Validate current session to verify the bearer path.",
          retryable: false,
          checks: [],
        } : {
          failurePoint: "browser.wallet · no session created",
          requestId: "not returned",
          diagnosticCode: "AUTH_SIGN_IN_NO_SESSION",
          sourceCode: "AUTH_SIGN_IN_NO_SESSION",
          category: "authentication",
          stage: "auth.web3.sign_in",
          status: "no session",
          title: "Wallet sign-in did not create a session",
          summary: "The sign-in helper completed without an accessible Supabase session.",
          likelyCause: stateText || "MetaMask rejected the request, the Auth proxy failed, or Supabase did not return a session.",
          nextAction: "Inspect the Auth Worker and browser console at the same timestamp; run /config and /auth/v1/settings next.",
          retryable: true,
          checks: [],
        },
        headers: {},
        body: null,
      };
      appendLog(entry);
      if (ok) updateSessionStatus("Session available", "ready");
      return entry;
    } catch (error) {
      const entry = clientFailure(endpointDef, `${currentOrigins().auth}/auth/v1/token?grant_type=web3`, started, error, "browser.wallet");
      appendLog(entry);
      updateSessionStatus(`Wallet flow failed: ${text(error?.message || error)}`, "warn");
      return entry;
    }
  }

  function clientFailure(endpointDef, url, started, error, point = "browser.fetch") {
    const message = redactText(error?.message || error || "Unknown browser error");
    return {
      time: new Date().toISOString(),
      kind: "failure",
      endpointId: endpointDef.id,
      endpoint: endpointDef.title,
      method: endpointDef.method,
      target: endpointDef.target,
      url,
      durationMs: Math.round(performance.now() - started),
      response: null,
      diagnostic: {
        failurePoint: `${point} · no HTTP response`,
        requestId: "not returned because fetch did not produce a Response",
        diagnosticCode: text(error?.code || "BROWSER_FETCH_FAILED"),
        sourceCode: message,
        category: "browser_network",
        stage: point,
        status: "no HTTP response",
        title: point === "browser.wallet" ? "Wallet flow failed before a usable session" : "Browser fetch failed before an HTTP response",
        summary: message,
        likelyCause: point === "browser.wallet" ? "The wallet provider or Supabase Web3 flow rejected the request." : "The browser blocked or could not complete the cross-origin request.",
        nextAction: point === "browser.wallet" ? "Check MetaMask, Auth URL configuration, and the Auth Worker logs." : "Check DevTools Network, the exact URL/origin, DNS/TLS, and edge CORS allowlisting.",
        retryable: true,
        checks: ["No HTTP response was available to JavaScript; a Worker request ID cannot be known from this page."],
      },
      headers: {},
      body: { browserError: message },
    };
  }

  async function runEndpoint(endpointDef, card, button, last) {
    if (endpointDef.mutation && !$("#allowMutations")?.checked) {
      blockedLog(endpointDef, "This endpoint is marked as a write or destructive operation.");
      last.textContent = "blocked by safety switch";
      return;
    }
    if (endpointDef.special === "signIn") {
      const entry = await runWalletFlow(endpointDef);
      last.textContent = `${entry.kind} · ${entry.diagnostic.sourceCode}`;
      return;
    }

    let body;
    try {
      body = requestBodyFromCard(card, endpointDef);
    } catch (error) {
      const entry = clientFailure(endpointDef, makeUrl(endpointDef), performance.now(), error, "browser.json");
      entry.diagnostic.failurePoint = "browser.json · no request sent";
      entry.diagnostic.title = "Request body could not be parsed";
      entry.diagnostic.summary = `${text(error.detail || error.message)}; the Worker was not contacted.`;
      appendLog(entry);
      last.textContent = "invalid JSON; not sent";
      return;
    }

    const url = makeUrl(endpointDef);
    const started = performance.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort("CLIENT_REQUEST_TIMEOUT"), REQUEST_TIMEOUT_MS);
    button.disabled = true;
    last.textContent = "running…";
    $("#requestStatus").textContent = `${endpointDef.method} ${url}`;
    try {
      const headers = new Headers({ accept: "application/json", "x-client-version": LOG_VERSION });
      if (body !== undefined) headers.set("content-type", "application/json");
      const token = await activeToken();
      if (token) headers.set("authorization", `Bearer ${token}`);
      const response = await fetch(url, {
        method: endpointDef.method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      const parsed = await readBody(response);
      const responseHeaders = safeHeaders(response);
      const diagnostic = responseDiagnostic(parsed.value, responseHeaders, endpointDef, response.status);
      const entry = {
        time: new Date().toISOString(),
        kind: response.ok ? "success" : "failure",
        endpointId: endpointDef.id,
        endpoint: endpointDef.title,
        method: endpointDef.method,
        target: endpointDef.target,
        url,
        durationMs: Math.round(performance.now() - started),
        response: parsed.value,
        diagnostic,
        headers: responseHeaders,
        request: { bodySent: body !== undefined, bodyKeys: body && typeof body === "object" ? Object.keys(body) : [] },
      };
      appendLog(entry);
      last.textContent = `${response.status} · ${diagnostic.sourceCode}`;
      return entry;
    } catch (error) {
      const isAbort = error?.name === "AbortError" || text(error?.message).includes("CLIENT_REQUEST_TIMEOUT");
      const normalized = isAbort ? Object.assign(new Error("CLIENT_REQUEST_TIMEOUT"), { code: "CLIENT_REQUEST_TIMEOUT" }) : error;
      const entry = clientFailure(endpointDef, url, started, normalized, "browser.fetch");
      if (isAbort) {
        entry.diagnostic.title = "Browser request timed out";
        entry.diagnostic.summary = `No HTTP response arrived within ${REQUEST_TIMEOUT_MS / 1000} seconds.`;
        entry.diagnostic.likelyCause = "The edge route, service binding, upstream Worker, or Supabase dependency did not complete in time.";
        entry.diagnostic.nextAction = "Use the timestamp and route to inspect Cloudflare Worker logs; do not blindly repeat a money operation.";
      }
      appendLog(entry);
      last.textContent = `no response · ${entry.diagnostic.sourceCode}`;
      return entry;
    } finally {
      window.clearTimeout(timeout);
      button.disabled = false;
    }
  }

  function appendLog(entry) {
    logs.push(entry);
    latestLog = entry;
    renderLog();
    $("#requestStatus").textContent = `${entry.kind}: ${entry.diagnostic.failurePoint}`;
  }

  function diagnosticRows(diagnostic) {
    const rows = [
      ["Failure point", diagnostic.failurePoint],
      ["Status", diagnostic.status],
      ["Request ID", diagnostic.requestId],
      ["Diagnostic code", diagnostic.diagnosticCode],
      ["Source code", diagnostic.sourceCode],
      ["Category", diagnostic.category],
      ["Stage", diagnostic.stage],
      ["Title", diagnostic.title],
      ["Summary", diagnostic.summary],
      ["Likely cause", diagnostic.likelyCause],
      ["Next action", diagnostic.nextAction],
      ["Retryable", diagnostic.retryable === null ? "not specified" : diagnostic.retryable ? "yes" : "no"],
    ];
    if (diagnostic.checks?.length) rows.push(["Checks", diagnostic.checks.join("\n")]);
    return rows;
  }

  function renderLog() {
    const root = $("#responseLog");
    if (!root) return;
    $("#logCount").textContent = `${logs.length} entr${logs.length === 1 ? "y" : "ies"}`;
    root.replaceChildren();
    if (!logs.length) {
      const empty = document.createElement("div");
      empty.className = "empty-log";
      empty.textContent = "Run a button above. Responses stay in memory until you clear or leave this page.";
      root.appendChild(empty);
      return;
    }
    for (const entry of [...logs].reverse()) {
      const details = document.createElement("details");
      details.className = `log-entry ${entry.kind}`;
      const summary = document.createElement("summary");
      summary.className = "log-summary";
      const main = document.createElement("span");
      main.className = "log-summary-main";
      const status = document.createElement("span");
      status.className = `status-pill ${entry.kind}`;
      status.textContent = entry.kind;
      const title = document.createElement("strong");
      title.textContent = `${entry.method} · ${entry.endpoint}`;
      const point = document.createElement("span");
      point.className = "muted";
      point.textContent = entry.diagnostic.failurePoint;
      main.append(status, title, point);
      const meta = document.createElement("small");
      meta.textContent = `${entry.diagnostic.status} · ${entry.durationMs} ms · ${entry.time}`;
      summary.append(main, meta);

      const detail = document.createElement("div");
      detail.className = "log-detail";
      const diagBox = document.createElement("div");
      diagBox.className = "diagnostic-box";
      const diagTitle = document.createElement("h4");
      diagTitle.textContent = "Exact failure/completion point";
      const list = document.createElement("dl");
      list.className = "diagnostic-list";
      for (const [label, item] of diagnosticRows(entry.diagnostic)) {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.className = label === "Checks" || label === "Next action" || label === "Likely cause" ? "long" : "";
        dd.textContent = text(item);
        list.append(dt, dd);
      }
      diagBox.append(diagTitle, list);
      const jsonBox = document.createElement("div");
      jsonBox.className = "json-box";
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify({ url: entry.url, headers: entry.headers, request: entry.request, response: entry.response }, null, 2);
      jsonBox.appendChild(pre);
      detail.append(diagBox, jsonBox);
      details.append(summary, detail);
      root.appendChild(details);
    }
  }

  async function topSignIn() {
    const endpointDef = ENDPOINTS.flatMap((section) => section.items).find((item) => item.id === "auth-wallet-sign-in");
    if (endpointDef) await runWalletFlow(endpointDef);
  }

  async function topSignOut() {
    const endpointDef = ENDPOINTS.flatMap((section) => section.items).find((item) => item.id === "auth-logout");
    if (!endpointDef) return;
    if (!$("#allowMutations")?.checked) {
      blockedLog(endpointDef, "Remote logout is a state-changing operation.");
      return;
    }
    try {
      await window.TriviaArenaAuth?.signOut?.();
      appendLog({
        time: new Date().toISOString(), kind: "success", endpointId: endpointDef.id, endpoint: "Top-level sign out", method: "POST", target: "auth", url: `${currentOrigins().auth}/logout`, durationMs: 0, response: { localCleanup: true }, headers: {}, request: { bodySent: false, bodyKeys: [] }, diagnostic: { failurePoint: "browser.auth · local sign-out helper completed", requestId: "see /logout card for server request ID", diagnosticCode: "OK", sourceCode: "OK", category: "authentication", stage: "auth.logout.helper", status: 200, title: "Local sign-out helper completed", summary: "The auth helper was invoked.", likelyCause: "The browser removed its session marker.", nextAction: "Run Validate current session to confirm the server rejects the old token.", retryable: false, checks: [] },
      });
      updateSessionStatus("Signed out", "ready");
    } catch (error) {
      appendLog(clientFailure(endpointDef, `${currentOrigins().auth}/logout`, performance.now(), error, "browser.auth"));
    }
  }

  function resetOrigins() {
    for (const [key, origin] of Object.entries(DEFAULT_ORIGINS)) {
      const input = document.querySelector(`[data-origin="${key}"]`);
      if (input) input.value = origin;
    }
  }

  function clearLog() {
    logs.splice(0, logs.length);
    latestLog = null;
    renderLog();
    $("#requestStatus").textContent = "Log cleared; no test request has been sent.";
  }

  async function copyLatest() {
    if (!latestLog) return;
    const payload = JSON.stringify(latestLog, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      $("#requestStatus").textContent = "Latest diagnostic copied without tokens or signed URLs.";
    } catch (error) {
      $("#requestStatus").textContent = `Copy failed at browser.clipboard: ${text(error?.message || error)}`;
    }
  }

  function exportLog() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), pageOrigin: location.origin, entries: logs }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `chestplayer-backend-test-${new Date().toISOString().replaceAll(":", "-")}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function init() {
    renderSections();
    $("#resetOrigins")?.addEventListener("click", resetOrigins);
    $("#clearLog")?.addEventListener("click", clearLog);
    $("#copyLatest")?.addEventListener("click", () => void copyLatest());
    $("#exportLog")?.addEventListener("click", exportLog);
    $("#clearManualToken")?.addEventListener("click", () => { $("#manualToken").value = ""; });
    $("#testSignIn")?.addEventListener("click", () => void topSignIn());
    $("#testSignOut")?.addEventListener("click", () => void topSignOut());
    window.addEventListener("trivia-auth-ready", async () => {
      try {
        const token = await window.TriviaArenaAuth?.getAccessToken?.();
        updateSessionStatus(token ? "Session available" : "No active session", token ? "ready" : "");
      } catch (_) {
        updateSessionStatus("Auth helper unavailable", "warn");
      }
    });
  }

  init();
})();
