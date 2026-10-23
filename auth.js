(() => {
  "use strict";

  const config = window.CHESTPLAYER_AUTH_CONFIG || window.TRIVIA_ARENA_CONFIG || {};
  const SESSION_MARKER = "chestplayer.auth.v2.marker";
  const SESSION_ID = "chestplayer.auth.v2.session_id";
  const SESSION_STARTED = "chestplayer.auth.v2.started_at";
  const SESSION_ACTIVITY = "chestplayer.auth.v2.last_activity_at";
  const AUTH_SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;
  const AUTH_IDLE_TIMEOUT_MS = 45 * 60 * 1000;

  let clientPromise = null;
  let currentSession = null;
  let sessionMonitor = null;
  let signInInFlight = false;
  let authSubscriptionAttached = false;
  let lastActivityAt = 0;
  const announcedProviders = [];
  const listenedProviders = new WeakSet();

  function safe(value, limit = 240) {
    return String(value ?? "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, limit);
  }

  function makeError(code, message, details = {}) {
    const error = new Error(message || code);
    error.code = code;
    Object.assign(error, details);
    return error;
  }

  function isConfigured() {
    const url = safe(config.supabaseUrl, 300);
    const authOrigin = safe(config.authOrigin, 300);
    const key = safe(config.supabasePublishableKey, 300);
    const sdkUrl = safe(config.supabaseSdkUrl, 300);
    const statement = safe(config.walletStatement, 300);
    return /^https:\/\//i.test(url)
      && /^https:\/\//i.test(authOrigin)
      && key.length > 20
      && !/replace|your_|YOUR_|PUBLISHABLE_OR_ANON/i.test(key)
      && /^https:\/\//i.test(sdkUrl)
      && statement.length >= 8
      && !/replace|your_|YOUR_/i.test(statement);
  }

  function workerOrigin() {
    const origin = safe(config.authOrigin, 300).replace(/\/+$/, "");
    return /^https:\/\//i.test(origin) && !/replace|your_|YOUR_/i.test(origin) ? origin : "";
  }

  function apiOrigin() {
    const origin = safe(config.apiOrigin || config.authOrigin, 300).replace(/\/+$/, "");
    return /^https:\/\//i.test(origin) && !/replace|your_|YOUR_/i.test(origin) ? origin : "";
  }

  function accountSourceCode(body, status) {
    const candidates = [body?.error, body?.error?.sourceCode, body?.sourceCode, body?.diagnostic?.sourceCode, body?.diagnostic?.source_code];
    const value = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
    return safe(value || `HTTP_${status}`, 96).replace(/[^A-Za-z0-9_.:-]/g, "_").toUpperCase();
  }

  function storageGet(key) {
    try { return window.sessionStorage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(key, value) {
    try { window.sessionStorage.setItem(key, String(value)); } catch (_) { /* optional browser storage */ }
  }

  function storageRemove(key) {
    try { window.sessionStorage.removeItem(key); } catch (_) { /* optional browser storage */ }
  }

  function requestId() {
    try { return crypto.randomUUID(); } catch (_) { return `cp-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  }

  function currentPageUrl() {
    try {
      const url = new URL(window.location.href);
      url.search = "";
      url.hash = "";
      if (url.pathname.endsWith("/index.html")) {
        url.pathname = url.pathname.slice(0, -"index.html".length) || "/";
      }
      return url.href;
    } catch (_) {
      return `${safe(window.location.origin, 300)}/`;
    }
  }

  function walletMessageUrl() {
    return currentPageUrl();
  }

  function isEmbeddedFrame() {
    try { return window.top !== window.self; } catch (_) { return true; }
  }

  function stageCode(stage) {
    const value = String(stage || "auth.client")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase();
    return value || "AUTH_CLIENT";
  }

  function usableErrorCode(value) {
    const code = safe(value, 100);
    return code && !/^(unknown|none|null|undefined|n\/a)$/i.test(code) ? code : "";
  }

  function classifyError(error, stage = error?.stage || "auth.client") {
    const explicit = usableErrorCode(error?.code);
    if (explicit) {
      const normalized = explicit.replace(/[^A-Za-z0-9_.:-]/g, "_").toUpperCase();
      if (/^(INVALID_GRANT|UNAUTHORIZED|BAD_JWT|INVALID_SIGNATURE)$/.test(normalized)) return "AUTH_PROVIDER_REJECTED";
      return normalized;
    }
    const message = safe(error?.message || error).toLowerCase();
    const prefix = stageCode(stage);
    const status = Number(error?.status);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return `${prefix}_HTTP_${status}`;
    if (/user rejected|user denied|request rejected|cancelled|canceled/.test(message)) return "WALLET_REQUEST_REJECTED";
    if (/already pending|request already open/.test(message)) return "WALLET_REQUEST_PENDING";
    if (/uri|redirect.*not allowed|not allowed.*uri/.test(message)) return "AUTH_REDIRECT_URI_NOT_ALLOWED";
    if (/invalid_grant|bad_jwt|unauthorized|invalid signature/.test(message)) return "AUTH_PROVIDER_REJECTED";
    if (/cors|cross-origin|access-control|origin_not_allowed/.test(message)) return `${prefix}_CORS_FAILURE`;
    if (/failed to fetch|networkerror|network error|load failed|fetch failed/.test(message)) return `${prefix}_NETWORK_FAILURE`;
    if (/metamask|wallet|ethereum|provider|eth_/.test(message)) return "WALLET_PROVIDER_FAILURE";
    return `${prefix}_CLIENT_FAILURE`;
  }

  function normalizeError(error, stage = "auth.client") {
    const normalized = error instanceof Error
      ? error
      : makeError("AUTH_CLIENT_FAILURE", safe(error || "Authentication failed."));
    if (!normalized.stage) normalized.stage = stage;
    if (!usableErrorCode(normalized.code)) normalized.code = classifyError(normalized, normalized.stage);
    const catalog = window.ChestPlayerErrorCatalog || window.__CP_ERROR_CATALOG;
    if (catalog?.fromError) {
      normalized.diagnosticRecord = catalog.fromError(normalized, {
        service: "auth",
        route: window.location?.pathname || "/login.html",
        method: "BROWSER",
      });
    }
    return normalized;
  }

  function diagnostic(error, fallback = "Authentication failed.") {
    const normalized = normalizeError(error, error?.stage || "auth.client");
    const message = safe(normalized.message || fallback || "Authentication failed.");
    const stage = safe(normalized.stage || "auth.client");
    const code = classifyError(normalized, stage);
    const returnedRequestId = safe(normalized.requestId || normalized.body?.requestId || "not available");
    const origin = safe(window.location?.origin || "not available");
    const page = safe(window.location?.href || "not available", 300);
    const serverDiagnostic = normalized.body?.diagnostic && typeof normalized.body.diagnostic === "object"
      ? normalized.body.diagnostic
      : null;
    const record = serverDiagnostic || normalized.diagnosticRecord || (window.ChestPlayerErrorCatalog?.resolve?.(code, {
      service: "auth",
      route: window.location?.pathname || "/login.html",
      method: "BROWSER",
      status: Number.isInteger(normalized.status) ? normalized.status : 0,
      requestId: returnedRequestId,
      stage,
    }));
    const supportCode = record?.diagnosticCode || code;
    const sourceCode = record?.sourceCode || code;
    const analysis = record ? [
      `Category: ${safe(record.category || "application")}.`,
      `Failure point: ${safe(record.stage || stage)}.`,
      `Likely cause: ${safe(record.likelyCause || "Inspect the request ID and first failing boundary.")}`,
      `Checks: ${Array.isArray(record.checks) ? record.checks.slice(0, 3).map((item) => safe(item)).join(" | ") : "Inspect the matching Worker and Supabase logs."}.`,
      `Next action: ${safe(record.nextAction || "Send the diagnostic code and request ID to support.")}`,
      `Retryable: ${record.retryable === true ? "yes" : "no"}.`,
    ].join(" ") : "Pre-analysis unavailable; preserve the code, page, and request ID for support.";
    return [
      `Authentication failed at ${stage}: ${message}.`,
      `Diagnostic code: ${safe(supportCode)}. Source code: ${safe(sourceCode)}.`,
      `Request ID: ${returnedRequestId}.`,
      `Browser origin: ${origin}.`,
      `Page: ${page}.`,
      analysis
    ].join(" ");
  }

  async function authWorkerRequest(path, options = {}) {
    const origin = workerOrigin();
    if (!origin) throw makeError("AUTH_WORKER_NOT_CONFIGURED", "The authentication Worker URL is not configured.", { stage: "auth.worker_config" });
    const headers = new Headers({ accept: "application/json" });
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (options.token) headers.set("authorization", `Bearer ${options.token}`);
    const clientRequestId = requestId();
    let response;
    try {
      response = await fetch(`${origin}${path}`, {
        method: options.method || "GET",
        headers,
        credentials: "omit",
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch (error) {
      throw makeError("AUTH_WORKER_UNAVAILABLE", "The authentication Worker could not be reached.", {
        stage: `auth.worker.${path}`,
        cause: error,
        requestId: clientRequestId
      });
    }
    const body = await response.json().catch(() => null);
    const responseRequestId = response.headers.get("x-request-id") || clientRequestId;
    if (!response.ok) {
      const code = safe(body?.error || `AUTH_WORKER_HTTP_${response.status}`, 100);
      throw makeError(code, code, {
        stage: `auth.worker.${path}`,
        status: response.status,
        requestId: responseRequestId,
        body,
        diagnostic: body?.diagnostic
      });
    }
    return { body, requestId: responseRequestId };
  }

  async function checkAuthGateway() {
    const origin = workerOrigin();
    if (!origin) throw makeError("AUTH_WORKER_NOT_CONFIGURED", "The authentication Worker URL is not configured.", { stage: "auth.gateway_health" });
    const clientRequestId = requestId();
    let response;
    try {
      response = await fetch(`${origin}/health`, {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "omit",
        cache: "no-store"
      });
    } catch (error) {
      throw makeError("AUTH_GATEWAY_NETWORK_FAILURE", "The public authentication gateway could not be reached.", {
        stage: "auth.gateway_health",
        cause: error,
        requestId: clientRequestId
      });
    }
    const body = await response.json().catch(() => null);
    const responseRequestId = response.headers.get("x-request-id") || clientRequestId;
    if (!response.ok) {
      const code = usableErrorCode(body?.error) || `AUTH_GATEWAY_HTTP_${response.status}`;
      throw makeError(code, code, {
        stage: "auth.gateway_health",
        status: response.status,
        requestId: responseRequestId,
        body,
        diagnostic: body?.diagnostic
      });
    }
    return body;
  }

  async function getSupabaseClient() {
    if (!isConfigured()) throw makeError("AUTH_CONFIG_INVALID", "The public authentication configuration is incomplete.", { stage: "auth.config" });
    if (!clientPromise) {
      clientPromise = import(config.supabaseSdkUrl).then(({ createClient }) => {
        if (typeof createClient !== "function") throw makeError("SUPABASE_SDK_INVALID", "The Supabase browser SDK did not load.", { stage: "auth.sdk_load" });
        return createClient(config.supabaseUrl, config.supabasePublishableKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
      }).catch((error) => {
        if (error?.stage) throw error;
        throw makeError("SUPABASE_SDK_LOAD_FAILED", "The Supabase browser SDK could not be loaded.", { stage: "auth.sdk_load", cause: error });
      });
    }
    return clientPromise;
  }

  function walletProviderAvailable(provider) {
    return Boolean(provider && typeof provider.request === "function");
  }

  function providerIsMetaMask(provider, detail) {
    return Boolean(walletProviderAvailable(provider) && (
      provider.isMetaMask === true
      || detail?.info?.rdns === "io.metamask"
      || /metamask/i.test(String(detail?.info?.name || ""))
    ));
  }

  function addProvider(detail) {
    if (!providerIsMetaMask(detail?.provider, detail)) return;
    if (!announcedProviders.some((item) => item.provider === detail.provider)) announcedProviders.push(detail);
    attachWalletListeners(detail.provider);
  }

  function findMetaMaskProvider() {
    const announced = announcedProviders.find((detail) => providerIsMetaMask(detail.provider, detail));
    if (announced?.provider) return announced.provider;
    if (window.ethereum?.isMetaMask) return window.ethereum;
    return null;
  }

  function attachWalletListeners(provider) {
    if (!provider || typeof provider.on !== "function" || listenedProviders.has(provider)) return;
    listenedProviders.add(provider);
    provider.on("accountsChanged", (accounts) => {
      if (!currentSession) return;
      const next = typeof accounts?.[0] === "string" && /^0x[0-9a-f]{40}$/i.test(accounts[0]) ? accounts[0].toLowerCase() : "";
      if (!next || next !== walletAddress(currentSession)) void signOut("wallet_changed");
    });
    provider.on("chainChanged", (chainId) => {
      if (currentSession && String(chainId || "").toLowerCase() !== "0x1") void signOut("network_changed");
    });
  }

  function discoverWallets() {
    window.addEventListener("eip6963:announceProvider", (event) => addProvider(event.detail));
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    if (window.ethereum?.isMetaMask) addProvider({ provider: window.ethereum, info: { name: "MetaMask", rdns: "io.metamask" } });
  }

  async function requestWalletAccounts(provider) {
    if (!walletProviderAvailable(provider)) {
      throw makeError("METAMASK_UNAVAILABLE", "MetaMask was not detected in this browser.", { stage: "auth.wallet_detect" });
    }
    let accounts;
    try {
      accounts = await provider.request({ method: "eth_requestAccounts" });
    } catch (error) {
      const code = String(error?.code ?? "");
      if (code === "4001") throw makeError("WALLET_REQUEST_REJECTED", "The MetaMask request was rejected.", { stage: "auth.wallet_request", cause: error });
      if (code === "-32002") throw makeError("WALLET_REQUEST_PENDING", "A MetaMask request is already open.", { stage: "auth.wallet_request", cause: error });
      throw makeError("WALLET_REQUEST_FAILED", safe(error?.message || "MetaMask did not return an account."), { stage: "auth.wallet_request", cause: error });
    }
    if (!Array.isArray(accounts) || !/^0x[0-9a-f]{40}$/i.test(String(accounts[0] || ""))) {
      throw makeError("WALLET_ACCOUNT_MISSING", "MetaMask did not return a valid wallet account.", { stage: "auth.wallet_request" });
    }
    return accounts;
  }

  function walletAddress(session) {
    const identities = Array.isArray(session?.user?.identities) ? session.user.identities : [];
    for (const identity of identities) {
      const data = identity?.identity_data && typeof identity.identity_data === "object" ? identity.identity_data : {};
      const claims = data.custom_claims && typeof data.custom_claims === "object" ? data.custom_claims : {};
      const candidate = [data.address, data.wallet_address, data.sub, claims.address, claims.wallet_address]
        .find((value) => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value));
      if (candidate) return candidate.toLowerCase();
    }
    const metadata = session?.user?.user_metadata && typeof session.user.user_metadata === "object" ? session.user.user_metadata : {};
    const fallback = [metadata.address, metadata.wallet_address]
      .find((value) => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value));
    return fallback ? fallback.toLowerCase() : "";
  }

  function shortWallet(address) {
    const value = String(address || "");
    return /^0x[0-9a-f]{40}$/i.test(value) ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
  }

  function markWindowSession(remoteSessionId = "") {
    const now = Date.now();
    storageSet(SESSION_MARKER, "metamask");
    storageSet(SESSION_STARTED, now);
    storageSet(SESSION_ACTIVITY, now);
    if (/^[A-Za-z0-9._:-]{8,160}$/.test(String(remoteSessionId))) storageSet(SESSION_ID, remoteSessionId);
    lastActivityAt = now;
  }

  function clearWalletSessionMarker() {
    storageRemove(SESSION_MARKER);
    storageRemove(SESSION_ID);
    storageRemove(SESSION_STARTED);
    storageRemove(SESSION_ACTIVITY);
    lastActivityAt = 0;
  }

  function markActivity() {
    if (!currentSession) return;
    lastActivityAt = Date.now();
    storageSet(SESSION_ACTIVITY, lastActivityAt);
  }

  function validWalletSession(session) {
    if (!session || storageGet(SESSION_MARKER) !== "metamask") return false;
    const started = Number(storageGet(SESSION_STARTED));
    const activity = Number(storageGet(SESSION_ACTIVITY));
    const now = Date.now();
    if (!Number.isFinite(started) || now - started >= AUTH_SESSION_MAX_AGE_MS) return false;
    if (!Number.isFinite(activity) || now - activity >= AUTH_IDLE_TIMEOUT_MS) return false;
    if (Number.isFinite(Number(session.expires_at)) && Number(session.expires_at) * 1000 <= now) return false;
    lastActivityAt = activity;
    return true;
  }

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function emitChanged() {
    const detail = { session: currentSession, walletAddress: walletAddress(currentSession) };
    emit("chestplayer-auth-changed", detail);
    // The full game client listens for the legacy event name. Emitting both
    // keeps the auth-only pages and the game dashboard on one session source.
    emit("trivia-auth-change", detail);
  }

  async function verifyWorkerSession(session) {
    const token = session?.access_token;
    if (!token) throw makeError("AUTH_SESSION_MISSING", "Supabase returned no access token.", { stage: "auth.session_token" });
    const result = await authWorkerRequest("/session", {
      token,
    });
    const body = result.body || {};
    const localId = String(session.user?.id || "");
    const remoteId = String(body.user?.id || "");
    if (body.authenticated !== true || !localId || remoteId !== localId) {
      throw makeError("AUTH_SESSION_REJECTED", "The Auth Worker did not verify the Supabase session.", {
        stage: "auth.worker_session_verify",
        requestId: result.requestId,
        status: 401
      });
    }
    return body;
  }

  // Account status is read from the authenticated API. It is intentionally
  // separate from wallet authentication: signing in proves wallet control,
  // while the API decides whether agreement-gated onboarding is complete.
  async function checkOnboardingStatus(session = currentSession) {
    const activeSession = session || currentSession;
    const token = activeSession?.access_token;
    if (!activeSession || !token) return { status: "signed_out", sourceCode: "AUTH_REQUIRED" };
    const origin = apiOrigin();
    if (!origin) return { status: "error", sourceCode: "API_ORIGIN_NOT_CONFIGURED", requestId: null };
    const clientRequestId = requestId();
    try {
      const response = await fetch(`${origin}/api/account`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          "x-client-version": "chestplayer-auth-v5",
        },
        credentials: "omit",
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      const responseRequestId = body?.requestId || response.headers.get("x-request-id") || clientRequestId;
      const sourceCode = accountSourceCode(body, response.status);
      if (response.ok) return { status: "ready", sourceCode: "ACCOUNT_READY", account: body, requestId: responseRequestId };
      if (sourceCode === "ACCOUNT_NOT_ONBOARDED") return { status: "required", sourceCode, requestId: responseRequestId, diagnostic: body?.diagnostic || null };
      return { status: "error", sourceCode, httpStatus: response.status, requestId: responseRequestId, diagnostic: body?.diagnostic || null };
    } catch (error) {
      return {
        status: "error",
        sourceCode: "ONBOARDING_STATUS_NETWORK_FAILED",
        requestId: clientRequestId,
        message: safe(error?.message || error || "The account status request failed.", 160),
      };
    }
  }

  function beginSessionMonitor() {
    window.clearInterval(sessionMonitor);
    sessionMonitor = window.setInterval(() => {
      if (!currentSession) return;
      const now = Date.now();
      const started = Number(storageGet(SESSION_STARTED));
      const activity = Number(storageGet(SESSION_ACTIVITY)) || lastActivityAt;
      if (!Number.isFinite(started) || now - started >= AUTH_SESSION_MAX_AGE_MS || !Number.isFinite(activity) || now - activity >= AUTH_IDLE_TIMEOUT_MS) {
        void signOut("expired");
      }
    }, 60_000);
  }

  async function signOut(reason = "manual") {
    const session = currentSession;
    const token = session?.access_token || null;
    clearWalletSessionMarker();
    currentSession = null;
    window.clearInterval(sessionMonitor);
    sessionMonitor = null;
    emitChanged();

    let remoteError = null;
    if (token) {
      try {
        await authWorkerRequest("/logout", { method: "POST", token });
      } catch (error) {
        remoteError = error;
        console.warn("[ChestPlayer Auth] remote sign-out failed; local cleanup continued", diagnostic(error, "Remote sign-out failed."));
      }
    }
    try {
      const client = await getSupabaseClient();
      await client.auth.signOut({ scope: "local" });
    } catch (error) {
      remoteError ||= error;
      console.warn("[ChestPlayer Auth] local sign-out cleanup failed", diagnostic(error, "Local sign-out failed."));
    }
    if (reason !== "manual") emit("chestplayer-auth-notice", { reason });
    return { signedOut: true, remoteError };
  }

  async function signInWithMetaMask() {
    if (signInInFlight) throw makeError("SIGN_IN_IN_PROGRESS", "A wallet sign-in request is already open.", { stage: "auth.sign_in" });
    if (!isConfigured()) throw makeError("AUTH_CONFIG_INVALID", "The public authentication configuration is incomplete.", { stage: "auth.config" });
    if (isEmbeddedFrame()) throw makeError("AUTH_MUST_BE_TOP_LEVEL", "Open ChestPlayer directly in a browser tab to connect MetaMask.", { stage: "auth.frame_check" });

    const provider = findMetaMaskProvider();
    if (!provider) throw makeError("METAMASK_UNAVAILABLE", "MetaMask was not detected in this browser.", { stage: "auth.wallet_detect" });
    attachWalletListeners(provider);
    signInInFlight = true;
    emit("chestplayer-auth-progress", { state: "wallet_request" });
    try {
      // Keep this as the first wallet operation so the browser treats it as a user-initiated request.
      await checkAuthGateway();
      await requestWalletAccounts(provider);
      emit("chestplayer-auth-progress", { state: "signature_request" });
      const client = await getSupabaseClient();
      if (typeof client.auth?.signInWithWeb3 !== "function") {
        throw makeError("METAMASK_AUTH_UNAVAILABLE", "This Supabase Auth client does not expose MetaMask sign-in.", { stage: "auth.web3_capability" });
      }
      const result = await client.auth.signInWithWeb3({
        chain: "ethereum",
        statement: config.walletStatement,
        wallet: provider,
        options: { url: walletMessageUrl() }
      });
      if (result.error) {
        const error = result.error;
        error.stage = "auth.web3_sign_in";
        throw error;
      }
      let session = result.data?.session || null;
      if (!session) {
        const current = await client.auth.getSession();
        if (current.error) {
          current.error.stage = "auth.get_session";
          throw current.error;
        }
        session = current.data?.session || null;
      }
      if (!session) throw makeError("AUTH_SESSION_NOT_CREATED", "Supabase did not return a session after the wallet signature.", { stage: "auth.session_create" });
      const remote = await verifyWorkerSession(session);
      markWindowSession(remote.sessionId);
      currentSession = session;
      beginSessionMonitor();
      emitChanged();
      emit("chestplayer-auth-progress", { state: "signed_in" });
      return session;
    } catch (error) {
      const normalized = normalizeError(error, error?.stage || "auth.web3_sign_in");
      normalized.diagnostic = diagnostic(normalized);
      emit("chestplayer-auth-error", { error: normalized, diagnostic: normalized.diagnostic });
      throw normalized;
    } finally {
      signInInFlight = false;
    }
  }

  async function loadVerifiedSession() {
    const client = await getSupabaseClient();
    const result = await client.auth.getSession();
    if (result.error) {
      result.error.stage = "auth.get_session";
      throw result.error;
    }
    const session = result.data?.session || null;
    if (!session) {
      currentSession = null;
      clearWalletSessionMarker();
      return null;
    }
    if (!validWalletSession(session)) {
      await signOut("expired");
      return null;
    }
    try {
      await verifyWorkerSession(session);
    } catch (error) {
      if (Number(error.status) === 401 || error.code === "AUTH_INVALID" || error.code === "AUTH_SESSION_REJECTED") {
        await signOut("invalid");
        return null;
      }
      throw error;
    }
    currentSession = session;
    beginSessionMonitor();
    return session;
  }

  async function getSession() {
    return loadVerifiedSession();
  }

  async function getAccessToken() {
    const session = await getSession();
    return session?.access_token || null;
  }

  function updateUi(signedSession) {
    signedSession ||= currentSession;
    const signedIn = Boolean(signedSession);
    const wallet = walletAddress(signedSession);
    document.querySelectorAll("#signInMetaMask").forEach((button) => {
      button.hidden = signedIn;
      if (!signInInFlight) button.disabled = false;
    });
    document.querySelectorAll("#authAccount").forEach((panel) => { panel.hidden = !signedIn; });
    document.querySelectorAll("#authWalletAddress").forEach((node) => {
      node.textContent = signedIn ? shortWallet(wallet) : "—";
      node.title = signedIn ? wallet : "";
    });
    document.querySelectorAll("#authState").forEach((node) => {
      node.classList.toggle("is-success", signedIn);
      node.classList.toggle("is-error", false);
      node.textContent = signedIn ? "Wallet verified." : "Connect a wallet to continue.";
    });
  }

  function setUiMessage(message, tone = "") {
    document.querySelectorAll("#authState").forEach((node) => {
      node.className = `auth-state ${tone}`.trim();
      node.textContent = String(message || "");
    });
  }

  function bindAuthUi() {
    document.querySelectorAll("#signInMetaMask").forEach((button) => {
      if (button.dataset.authBound === "true") return;
      button.dataset.authBound = "true";
      button.addEventListener("click", async () => {
        if (signInInFlight) return;
        button.disabled = true;
        setUiMessage("Waiting for MetaMask…");
        try {
          const session = await signInWithMetaMask();
          updateUi(session);
          document.querySelector("#authModal")?.setAttribute("hidden", "");
        } catch (error) {
          setUiMessage(diagnostic(error), "is-error");
        } finally {
          if (!currentSession) button.disabled = false;
          updateUi(currentSession);
        }
      });
    });
    document.querySelectorAll("#signOutAuth").forEach((button) => {
      if (button.dataset.authBound === "true") return;
      button.dataset.authBound = "true";
      button.addEventListener("click", async () => {
        button.disabled = true;
        setUiMessage("Signing out…");
        try { await signOut(); } finally { button.disabled = false; updateUi(currentSession); }
      });
    });
    window.addEventListener("chestplayer-auth-ready", (event) => {
      updateUi(event.detail?.session || null);
      if (event.detail?.error) setUiMessage(diagnostic(event.detail.error), "is-error");
    });
    window.addEventListener("chestplayer-auth-changed", (event) => updateUi(event.detail?.session || null));
    window.addEventListener("chestplayer-auth-progress", (event) => {
      if (event.detail?.state === "wallet_request") setUiMessage("Waiting for MetaMask…");
      if (event.detail?.state === "signature_request") setUiMessage("Review the sign-in request in MetaMask…");
    });
    window.addEventListener("chestplayer-auth-error", (event) => setUiMessage(diagnostic(event.detail?.error), "is-error"));
    updateUi(currentSession);
  }

  async function boot() {
    discoverWallets();
    ["pointerdown", "keydown", "touchstart"].forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }));
    if (!isConfigured()) {
      const error = makeError("AUTH_CONFIG_INVALID", "The public authentication configuration is incomplete.", { stage: "auth.config" });
      error.diagnostic = diagnostic(error);
      emit("chestplayer-auth-ready", { session: null, error, diagnostic: error.diagnostic });
      emit("trivia-auth-ready", { session: null, error, diagnostic: error.diagnostic });
      return { session: null, error };
    }
    try {
      const client = await getSupabaseClient();
      if (!authSubscriptionAttached) {
        client.auth.onAuthStateChange((event, nextSession) => {
          if (event === "SIGNED_OUT" || !nextSession) {
            currentSession = null;
            clearWalletSessionMarker();
            window.clearInterval(sessionMonitor);
            sessionMonitor = null;
            emitChanged();
          } else if (event === "TOKEN_REFRESHED" && currentSession && nextSession.user?.id === currentSession.user?.id) {
            currentSession = nextSession;
            emitChanged();
          }
        });
        authSubscriptionAttached = true;
      }
      const session = await loadVerifiedSession();
      emitChanged();
      emit("chestplayer-auth-ready", { session, error: null });
      emit("trivia-auth-ready", { session, error: null });
      return { session, error: null };
    } catch (error) {
      const normalized = normalizeError(error, error?.stage || "auth.boot");
      normalized.diagnostic = diagnostic(normalized);
      currentSession = null;
      emit("chestplayer-auth-ready", { session: null, error: normalized, diagnostic: normalized.diagnostic });
      emit("trivia-auth-ready", { session: null, error: normalized, diagnostic: normalized.diagnostic });
      return { session: null, error: normalized };
    }
  }

  const ready = boot();
  const api = Object.freeze({
    ready,
    configured: isConfigured,
    getSession,
    getAccessToken,
    checkOnboardingStatus,
    getSupabaseClient,
    getWalletAddress: () => walletAddress(currentSession),
    getShortWallet: () => shortWallet(walletAddress(currentSession)),
    signInWithMetaMask,
    signOut,
    formatDiagnostic: diagnostic,
    walletMessageUrl: currentPageUrl
  });
  window.ChestPlayerAuth = api;
  window.TriviaArenaAuth = api;
  bindAuthUi();
})();
