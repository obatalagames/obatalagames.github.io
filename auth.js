(() => {
  "use strict";

  const config = window.CHESTPLAYER_AUTH_CONFIG || {};
  const SESSION_MARKER = "chestplayer.auth.v2.marker";
  const SESSION_ID = "chestplayer.auth.v2.session_id";
  const SESSION_STARTED = "chestplayer.auth.v2.started_at";
  const SESSION_ACTIVITY = "chestplayer.auth.v2.last_activity_at";
  const MAX_SESSION_AGE_MS = 4 * 60 * 60 * 1000;
  const IDLE_TIMEOUT_MS = 45 * 60 * 1000;

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

  function diagnostic(error, fallback = "Authentication failed.") {
    const message = safe(error?.message || fallback || "Authentication failed.");
    const code = safe(error?.code || error?.status || "UNKNOWN");
    const stage = safe(error?.stage || "auth.client");
    const returnedRequestId = safe(error?.requestId || "not returned");
    const origin = safe(window.location?.origin || "unknown");
    const page = safe(window.location?.href || "unknown", 300);
    let nextCheck = "Check the browser console and the matching Auth Worker log entry.";
    if (/uri|redirect|origin|allowed/i.test(message)) {
      nextCheck = "Add the exact page URL to Supabase Auth redirect URLs, or allow https://chestplayer.us/**.";
    } else if (/metamask|wallet|ethereum|provider|account/i.test(message)) {
      nextCheck = "Unlock MetaMask, close any pending wallet prompt, and retry from the top-level site window.";
    } else if (/cors|origin_not_allowed/i.test(message)) {
      nextCheck = "Add the address-bar origin to the Auth Worker allowed-origin list; do not use the GitHub repository URL unless you open that URL.";
    }
    return [
      `Authentication failed at ${stage}: ${message}.`,
      `Code: ${code}.`,
      `Request ID: ${returnedRequestId}.`,
      `Browser origin: ${origin}.`,
      `Page: ${page}.`,
      nextCheck
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
        body
      });
    }
    return { body, requestId: responseRequestId };
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

  function providerIsMetaMask(provider, detail) {
    return Boolean(provider && typeof provider.request === "function" && (
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
    if (!provider || typeof provider.request !== "function") {
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

  function clearWindowSession() {
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

  function validWindowSession(session) {
    if (!session || storageGet(SESSION_MARKER) !== "metamask") return false;
    const started = Number(storageGet(SESSION_STARTED));
    const activity = Number(storageGet(SESSION_ACTIVITY));
    const now = Date.now();
    if (!Number.isFinite(started) || now - started >= MAX_SESSION_AGE_MS) return false;
    if (!Number.isFinite(activity) || now - activity >= IDLE_TIMEOUT_MS) return false;
    if (Number.isFinite(Number(session.expires_at)) && Number(session.expires_at) * 1000 <= now) return false;
    lastActivityAt = activity;
    return true;
  }

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function emitChanged() {
    emit("chestplayer-auth-changed", { session: currentSession, walletAddress: walletAddress(currentSession) });
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

  function beginSessionMonitor() {
    window.clearInterval(sessionMonitor);
    sessionMonitor = window.setInterval(() => {
      if (!currentSession) return;
      const now = Date.now();
      const started = Number(storageGet(SESSION_STARTED));
      const activity = Number(storageGet(SESSION_ACTIVITY)) || lastActivityAt;
      if (!Number.isFinite(started) || now - started >= MAX_SESSION_AGE_MS || !Number.isFinite(activity) || now - activity >= IDLE_TIMEOUT_MS) {
        void signOut("expired");
      }
    }, 60_000);
  }

  async function signOut(reason = "manual") {
    const session = currentSession;
    const token = session?.access_token || null;
    clearWindowSession();
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
    let topLevel = true;
    try { topLevel = window.top === window.self; } catch (_) { topLevel = false; }
    if (!topLevel) throw makeError("AUTH_MUST_BE_TOP_LEVEL", "Open ChestPlayer directly in a browser tab to connect MetaMask.", { stage: "auth.frame_check" });

    const provider = findMetaMaskProvider();
    if (!provider) throw makeError("METAMASK_UNAVAILABLE", "MetaMask was not detected in this browser.", { stage: "auth.wallet_detect" });
    attachWalletListeners(provider);
    signInInFlight = true;
    emit("chestplayer-auth-progress", { state: "wallet_request" });
    try {
      // Keep this as the first wallet operation so the browser treats it as a user-initiated request.
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
        options: { url: currentPageUrl() }
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
      error.diagnostic = diagnostic(error);
      emit("chestplayer-auth-error", { error, diagnostic: error.diagnostic });
      throw error;
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
      clearWindowSession();
      return null;
    }
    if (!validWindowSession(session)) {
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

  async function boot() {
    discoverWallets();
    ["pointerdown", "keydown", "touchstart"].forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }));
    if (!isConfigured()) {
      const error = makeError("AUTH_CONFIG_INVALID", "The public authentication configuration is incomplete.", { stage: "auth.config" });
      error.diagnostic = diagnostic(error);
      emit("chestplayer-auth-ready", { session: null, error, diagnostic: error.diagnostic });
      return { session: null, error };
    }
    try {
      const client = await getSupabaseClient();
      if (!authSubscriptionAttached) {
        client.auth.onAuthStateChange((event, nextSession) => {
          if (event === "SIGNED_OUT" || !nextSession) {
            currentSession = null;
            clearWindowSession();
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
      emit("chestplayer-auth-ready", { session, error: null });
      return { session, error: null };
    } catch (error) {
      error.diagnostic = diagnostic(error);
      currentSession = null;
      emit("chestplayer-auth-ready", { session: null, error, diagnostic: error.diagnostic });
      return { session: null, error };
    }
  }

  const ready = boot();
  window.ChestPlayerAuth = Object.freeze({
    ready,
    configured: isConfigured,
    getSession,
    getAccessToken,
    getSupabaseClient,
    getWalletAddress: () => walletAddress(currentSession),
    getShortWallet: () => shortWallet(walletAddress(currentSession)),
    signInWithMetaMask,
    signOut,
    formatDiagnostic: diagnostic,
    walletMessageUrl: currentPageUrl
  });
})();
