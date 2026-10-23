const config = window.TRIVIA_ARENA_CONFIG || {};
const AUTH_WORKER_ERROR = "AUTH_WORKER_UNAVAILABLE";
const $ = (selector) => document.querySelector(selector);
let clientPromise;
let providers = [];
let currentSession = null;
let signInInFlight = false;
let sessionMonitor = null;
let lastActivityAt = 0;
const walletListeners = new WeakSet();
const AUTH_SESSION_MARKER = "chestplayer.auth.session.v1";
const AUTH_SESSION_ID = "chestplayer.auth.session_id";
const AUTH_SESSION_STARTED = "chestplayer.auth.started_at";
const AUTH_SESSION_ACTIVITY = "chestplayer.auth.last_activity_at";
const AUTH_SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const AUTH_IDLE_TIMEOUT_MS = 45 * 60 * 1000;

function tr(key, fallback) {
  return window.TriviaI18n?.t?.(key) || fallback || key;
}

function readableError(error, fallback) {
  const message = String(error?.message || error || "");
  const errorCode = String(error?.code ?? "");
  const normalized = message.toLowerCase();
  if (errorCode === "4001" || /user rejected|user denied|request rejected|cancelled|canceled/.test(normalized)) {
    return tr("auth.signInCancelled", fallback || "Wallet sign-in was cancelled.");
  }
  if (errorCode === "-32002" || /already pending|request already open/.test(normalized)) {
    return tr("auth.signInPending", fallback || "A wallet sign-in request is already open. Finish it in your wallet first.");
  }
  if (/eth_requestaccounts is missing or invalid|no compatible ethereum wallet|wallet_no_account/.test(normalized)) {
    return tr("auth.walletRequestFailed", fallback || "MetaMask did not respond. Unlock it, close any pending request, and try again.");
  }
  const keys = {
    METAMASK_AUTH_UNAVAILABLE: "error.metaMaskUnavailable",
    SUPABASE_SDK_INVALID: "error.sdk",
  };
  return keys[message] ? tr(keys[message], fallback) : (message || fallback);
}

function configured() {
  const url = String(config.supabaseUrl || "").trim();
  const key = String(config.supabasePublishableKey || "").trim();
  const sdkUrl = String(config.supabaseSdkUrl || "").trim();
  const statement = String(config.walletStatement || "").trim();
  return /^https:\/\//i.test(url)
    && !/your_project|your-domain|replace-with|YOUR_SUPABASE|YOUR_PROJECT/i.test(url)
    && key.length > 20
    && !/YOUR_SUPABASE|PUBLISHABLE_OR_ANON|replace-with/i.test(key)
    && /^https:\/\//i.test(sdkUrl)
    && statement.length >= 20
    && !/your-domain\.example|replace-with-your-domain|YOUR_PROJECT|YOUR_SUPABASE/i.test(statement);
}

function authWorkerOrigin() {
  const value = String(config.authOrigin || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(value) || /your-domain|replace-with|YOUR_/i.test(value)) return "";
  return value;
}

function apiOrigin() {
  const value = String(config.apiOrigin || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(value) || /your-domain|replace-with|YOUR_/i.test(value)) return "";
  return value;
}

function requestId() {
  return window.crypto?.randomUUID ? window.crypto.randomUUID() : `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function onboardingSourceCode(body, status) {
  const candidates = [
    body?.error,
    body?.error?.sourceCode,
    body?.sourceCode,
    body?.diagnostic?.sourceCode,
    body?.diagnostic?.source_code,
  ];
  const value = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  return String(value || `HTTP_${status}`).trim().toUpperCase().replace(/[^A-Z0-9_.:-]/g, "_").slice(0, 96);
}

async function authWorkerRequest(path, options = {}) {
  const origin = authWorkerOrigin();
  if (!origin) return null;
  const headers = new Headers(options.headers || {});
  headers.set("accept", "application/json");
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.sessionId) headers.set("x-cp-session-id", options.sessionId);
  const request = { ...options, headers, credentials: "omit" };
  delete request.token;
  delete request.sessionId;
  let response;
  try {
    response = await fetch(`${origin}${path}`, request);
  } catch (error) {
    error.code = AUTH_WORKER_ERROR;
    throw error;
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(typeof body?.error === "string" ? body.error : `AUTH_WORKER_HTTP_${response.status}`);
    error.status = response.status;
    error.code = error.message;
    throw error;
  }
  return body;
}

async function verifyAuthWorkerSession(session, { silent = true } = {}) {
  const token = session?.access_token;
  if (!token || !authWorkerOrigin()) return true;
  try {
    const body = await authWorkerRequest("/session", { token, sessionId: sessionStorageGet(AUTH_SESSION_ID) });
    if (body?.sessionId && /^[A-Za-z0-9._:-]{8,160}$/.test(String(body.sessionId))) sessionStorageSet(AUTH_SESSION_ID, String(body.sessionId));
    const localId = String(session.user?.id || "");
    const remoteId = String(body?.user?.id || "");
    if (body?.authenticated !== true || !localId || remoteId !== localId) return false;
    return true;
  } catch (error) {
    // The public API independently validates the same bearer token. A
    // transient auth Worker outage should not strand an already valid local
    // session, but an explicit 401 still fails closed.
    if (Number(error?.status) === 401) return false;
    if (!silent) console.warn("[ChestPlayer Auth] auth Worker session check unavailable", error);
    return true;
  }
}

// Account existence and onboarding are server decisions. The browser must
// never infer onboarding from wallet metadata or create an account while it
// is only checking status. The API's ACCOUNT_NOT_ONBOARDED response is the
// single routing signal for the agreement-gated onboarding page.
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
        "x-client-version": "chestplayer-ui-2",
        "x-cp-request-id": clientRequestId,
      },
      cache: "no-store",
      credentials: "omit",
    });
    const body = await response.json().catch(() => ({}));
    const responseRequestId = body?.requestId || response.headers.get("x-request-id") || clientRequestId;
    const sourceCode = onboardingSourceCode(body, response.status);
    if (response.ok) return { status: "ready", sourceCode: "ACCOUNT_READY", account: body, requestId: responseRequestId };
    if (sourceCode === "ACCOUNT_NOT_ONBOARDED") return { status: "required", sourceCode, requestId: responseRequestId, diagnostic: body?.diagnostic || null };
    return { status: "error", sourceCode, httpStatus: response.status, requestId: responseRequestId, diagnostic: body?.diagnostic || null };
  } catch (error) {
    return {
      status: "error",
      sourceCode: "ONBOARDING_STATUS_NETWORK_FAILED",
      requestId: clientRequestId,
      message: String(error?.message || error || "Network request failed").slice(0, 160),
    };
  }
}

function setState(message, tone = "") {
  const node = $("#authState");
  if (!node) return;
  node.className = `auth-state ${tone}`.trim();
  const dot = document.createElement("span");
  dot.className = "status-dot";
  const copy = document.createElement("span");
  copy.textContent = String(message || "");
  node.replaceChildren(dot, copy);
}

function authDiagnostic(error, fallback) {
  const message = String(error?.message || error || fallback || "Authentication failed")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 240);
  const rawCode = String(error?.code ?? (error?.status ? `AUTH_HTTP_${error.status}` : "DIAGNOSTIC_FALLBACK"))
    .replace(/[^A-Z0-9_.:-]/gi, "_")
    .slice(0, 80);
  const origin = String(window.location?.origin || "not available");
  const page = String(window.location?.href || "not available").split("#")[0].slice(0, 240);
  const supabase = String(config.supabaseUrl || "not configured").slice(0, 180);
  const analysis = window.ChestPlayerErrorCatalog?.resolve?.(rawCode, {
    service: "auth",
    route: window.location?.pathname || "/",
    method: "BROWSER",
    status: Number(error?.status) || 0,
    requestId: error?.requestId || "not available",
    stage: error?.stage || "auth.client",
  });
  const detail = analysis
    ? `Diagnostic code: ${analysis.diagnosticCode}. Source code: ${analysis.sourceCode}. Category: ${analysis.category}. Failure point: ${analysis.stage}. Likely cause: ${analysis.likelyCause} Checks: ${(analysis.checks || []).slice(0, 3).join(" | ")}. Next action: ${analysis.nextAction} Retryable: ${analysis.retryable ? "yes" : "no"}.`
    : "Pre-analysis unavailable; preserve the code and page details for support.";
  return `Authentication failed: ${message}. Browser origin: ${origin}. Page: ${page}. Supabase project: ${supabase}. ${detail}`;
}

function sessionStorageGet(key) {
  try { return window.sessionStorage.getItem(key); } catch (_) { return null; }
}

function sessionStorageSet(key, value) {
  try { window.sessionStorage.setItem(key, String(value)); } catch (_) { /* optional browser storage */ }
}

function sessionStorageRemove(key) {
  try { window.sessionStorage.removeItem(key); } catch (_) { /* optional browser storage */ }
}

function markSessionActivity() {
  lastActivityAt = Date.now();
  sessionStorageSet(AUTH_SESSION_ACTIVITY, lastActivityAt);
}

function markWalletSession() {
  const now = Date.now();
  sessionStorageSet(AUTH_SESSION_MARKER, "wallet");
  sessionStorageSet(AUTH_SESSION_STARTED, now);
  sessionStorageSet(AUTH_SESSION_ACTIVITY, now);
  lastActivityAt = now;
}

function clearWalletSessionMarker() {
  sessionStorageRemove(AUTH_SESSION_MARKER);
  sessionStorageRemove(AUTH_SESSION_ID);
  sessionStorageRemove(AUTH_SESSION_STARTED);
  sessionStorageRemove(AUTH_SESSION_ACTIVITY);
  lastActivityAt = 0;
}

function validWalletSession(session) {
  if (!session) return false;
  if (sessionStorageGet(AUTH_SESSION_MARKER) !== "wallet") return false;
  const startedAt = Number(sessionStorageGet(AUTH_SESSION_STARTED));
  const activityAt = Number(sessionStorageGet(AUTH_SESSION_ACTIVITY));
  const now = Date.now();
  if (!Number.isFinite(startedAt) || now - startedAt >= AUTH_SESSION_MAX_AGE_MS) return false;
  if (!Number.isFinite(activityAt) || now - activityAt >= AUTH_IDLE_TIMEOUT_MS) return false;
  if (Number.isFinite(Number(session.expires_at)) && Number(session.expires_at) * 1000 <= now) return false;
  lastActivityAt = activityAt;
  return true;
}

function startSessionMonitor() {
  window.clearInterval(sessionMonitor);
  sessionMonitor = window.setInterval(() => {
    if (!currentSession) return;
    const now = Date.now();
    const startedAt = Number(sessionStorageGet(AUTH_SESSION_STARTED));
    const activityAt = Number(sessionStorageGet(AUTH_SESSION_ACTIVITY)) || lastActivityAt;
    if (!Number.isFinite(startedAt) || now - startedAt >= AUTH_SESSION_MAX_AGE_MS || !Number.isFinite(activityAt) || now - activityAt >= AUTH_IDLE_TIMEOUT_MS) {
      void endSession("expired");
    }
  }, 60_000);
}

function attachWalletListeners(provider) {
  if (!provider || typeof provider.on !== "function" || walletListeners.has(provider)) return;
  walletListeners.add(provider);
  provider.on("accountsChanged", (accounts) => {
    const active = sessionAddress(currentSession);
    const next = typeof accounts?.[0] === "string" && /^0x[0-9a-f]{40}$/i.test(accounts[0]) ? accounts[0].toLowerCase() : "";
    if (currentSession && (!next || !active || next !== active)) void endSession("wallet_changed");
  });
  provider.on("chainChanged", (chainId) => {
    if (currentSession && String(chainId || "").toLowerCase() !== "0x1") void endSession("network_changed");
  });
}

async function endSession(reason = "manual") {
  const remoteToken = currentSession?.access_token || null;
  const remoteSessionId = sessionStorageGet(AUTH_SESSION_ID);
  clearWalletSessionMarker();
  window.clearInterval(sessionMonitor);
  sessionMonitor = null;
  currentSession = null;
  updateUi(null);
  let failure = null;
  if (remoteToken) {
    try { await authWorkerRequest("/logout", { method: "POST", token: remoteToken, sessionId: remoteSessionId }); }
    catch (error) { console.warn("[ChestPlayer Auth] remote sign-out unavailable; continuing with local cleanup", error); }
  }
  try {
    const supabase = await getSupabaseClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) failure = error;
  } catch (error) {
    failure = error;
  }
  if (failure) {
    console.error("[ChestPlayer Auth] local sign-out cleanup completed with Supabase error", failure);
    setState(authDiagnostic(failure, "Local sign-out completed, but Supabase could not revoke the remote session."), "is-warning");
  } else if (reason === "expired" || reason === "wallet_changed" || reason === "network_changed") {
    setState("Your wallet session ended. Sign in again to continue.", "is-warning");
  }
}

function shortAddress(address) {
  const value = String(address || "");
  return /^0x[0-9a-f]{10,}$/i.test(value) ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function sessionAddress(session) {
  for (const identity of session?.user?.identities || []) {
    const data = identity?.identity_data || {};
    const claims = data.custom_claims && typeof data.custom_claims === "object" ? data.custom_claims : {};
    const address = [data.address, data.wallet_address, data.sub, claims.address, claims.wallet_address].find((value) => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value));
    if (typeof address === "string" && /^0x[0-9a-f]{40}$/i.test(address)) return address.toLowerCase();
  }
  return "";
}

function updateUi(session) {
  currentSession = session || null;
  const address = sessionAddress(session);
  const triggerLabel = $("#authTriggerLabel");
  const account = $("#authAccount");
  const accountAddress = $("#authWalletAddress");
  const loginButton = $("#signInMetaMask");
  if (session) {
    if (triggerLabel) triggerLabel.textContent = shortAddress(address) || tr("auth.walletConnected", "Wallet connected");
    if (account) account.hidden = false;
    if (accountAddress) accountAddress.textContent = address || tr("auth.verifiedSession", "Verified Supabase session");
    if (loginButton) loginButton.querySelector("strong").textContent = tr("auth.walletConnected", "Wallet connected");
    setState(tr("auth.walletVerified", "Wallet verified by Supabase."), "is-ready");
  } else {
    if (triggerLabel) triggerLabel.textContent = tr("auth.signInSignUp", "Sign in / Sign up");
    if (account) account.hidden = true;
    if (loginButton) loginButton.querySelector("strong").textContent = tr("auth.metaMask", "Continue with MetaMask");
    setState(configured() ? tr("auth.connectWallet", "Connect a wallet to continue.") : tr("auth.configure", "Add your Supabase values to auth-config.js first."), configured() ? "" : "is-warning");
  }
  window.dispatchEvent(new CustomEvent("trivia-auth-change", { detail: { session: currentSession } }));
}

function addProvider(detail) {
  const name = String(detail?.info?.name || "");
  const rdns = String(detail?.info?.rdns || "");
  const provider = detail?.provider;
  if (!provider || !(provider.isMetaMask || rdns === "io.metamask" || /metamask/i.test(name))) return;
  if (providers.some((item) => item.provider === provider)) return;
  providers.push(detail);
  $("#authWalletList")?.replaceChildren();
}

function discoverWallets() {
  window.addEventListener("eip6963:announceProvider", (event) => {
    addProvider(event.detail);
    if (event.detail?.provider?.isMetaMask || event.detail?.info?.rdns === "io.metamask") {
      attachWalletListeners(event.detail.provider);
    }
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  if (window.ethereum?.isMetaMask) {
    addProvider({ provider: window.ethereum, info: { name: "MetaMask", rdns: "io.metamask" } });
    attachWalletListeners(window.ethereum);
  }
}

async function getSupabaseClient() {
  if (!configured()) throw new Error("Configure Supabase first.");
  if (!clientPromise) {
    clientPromise = import(config.supabaseSdkUrl).then(({ createClient }) => {
      if (typeof createClient !== "function") throw new Error("SUPABASE_SDK_INVALID");
      return createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    });
  }
  return clientPromise;
}

function findMetaMaskProvider() {
  const announced = providers.find((item) => {
    const name = String(item.info?.name || "");
    const rdns = String(item.info?.rdns || "");
    return rdns === "io.metamask" || /metamask/i.test(name) || item.provider?.isMetaMask;
  });
  if (announced?.provider) return announced.provider;
  if (window.ethereum?.isMetaMask) return window.ethereum;
  return null;
}

function isMetaMaskProvider(provider) {
  if (!provider) return false;
  if (provider.isMetaMask) return true;
  const detail = providers.find((item) => item.provider === provider);
  return detail?.info?.rdns === "io.metamask" || /metamask/i.test(String(detail?.info?.name || ""));
}

function isEmbeddedFrame() {
  try { return window.top !== window.self; } catch (_) { return true; }
}

function walletProviderAvailable(provider) {
  return Boolean(provider && typeof provider.request === "function");
}

// Call the wallet permission method immediately from the click handler. Some
// browsers and wallet extensions reject eth_requestAccounts when the first
// request happens only after an asynchronous SDK import.
function requestWalletAccounts(provider) {
  if (!walletProviderAvailable(provider)) throw new Error("METAMASK_UNAVAILABLE");
  const request = provider.request({ method: "eth_requestAccounts" });
  return Promise.resolve(request).then((accounts) => {
    if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !/^0x[0-9a-f]{40}$/i.test(accounts[0])) {
      throw new Error("WALLET_NO_ACCOUNT");
    }
    return accounts;
  });
}

// Supabase validates the URI embedded in the SIWE message against Auth's
// redirect allow-list. Locale query strings such as ?lang=es are UI state,
// not a different application. Pass the URL explicitly instead of mutating
// browser history: auth-js supports options.url and MetaMask can then see the
// exact URL that Supabase will validate. Keep the visible locale unchanged.
function walletMessageUrl() {
  const current = new URL(window.location.href);
  current.search = "";
  current.hash = "";
  if (current.pathname === "/index.html") current.pathname = "/";
  return current.href;
}

async function signInWithMetaMask(wallet) {
  if (!configured()) return setState(tr("auth.configureSignIn", "Edit auth-config.js with your Supabase URL and publishable key."), "is-warning");
  if (isEmbeddedFrame()) return setState(tr("auth.frameWallet", "Open chestplayer.us directly for wallet sign-in. Masked forwarding cannot securely connect MetaMask."), "is-warning");
  const provider = wallet || findMetaMaskProvider();
  if (!walletProviderAvailable(provider) || !isMetaMaskProvider(provider)) return setState(tr("auth.installWallet", "Install the MetaMask browser extension to continue."), "is-warning");
  attachWalletListeners(provider);
  if (signInInFlight) return setState(tr("auth.signInPending", "A wallet sign-in request is already open. Finish it in your wallet first."), "is-warning");
  signInInFlight = true;
  setState(tr("auth.waitingSignature", "Waiting for wallet signature…"));
  try {
    // This must be the first asynchronous wallet operation. Supabase will
    // request the accounts again while building the SIWE message; that second
    // call is safe after the permission has already been granted.
    await requestWalletAccounts(provider);
    const supabase = await getSupabaseClient();
    if (typeof supabase.auth?.signInWithWeb3 !== "function") throw new Error("METAMASK_AUTH_UNAVAILABLE");
    const { data, error } = await supabase.auth.signInWithWeb3({
      chain: "ethereum",
      statement: config.walletStatement,
      wallet: provider,
      options: { url: walletMessageUrl() },
    });
    if (error) throw error;
    let signedSession = data?.session || null;
    if (!data?.session) {
      const { data: current } = await supabase.auth.getSession();
      signedSession = current?.session || null;
      if (!signedSession) throw new Error("AUTH_SESSION_NOT_CREATED");
    }
    if (!(await verifyAuthWorkerSession(signedSession, { silent: false }))) throw new Error("AUTH_SESSION_REJECTED");
    markWalletSession();
    startSessionMonitor();
    // signInWithWeb3 can resolve before Supabase emits SIGNED_IN. Publish the
    // verified session here as well so the landing-page router always runs its
    // server-side onboarding check after a successful MetaMask sign-in.
    updateUi(signedSession);
    setState(tr("auth.walletVerified", "Wallet verified by Supabase."), "is-ready");
  } catch (error) {
    setState(authDiagnostic(error, tr("auth.walletRequestFailed", "MetaMask did not respond.")), "is-warning");
  } finally {
    signInInFlight = false;
  }
}

async function signOut() {
  await endSession("manual");
}

async function boot() {
  discoverWallets();
  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => window.addEventListener(eventName, markSessionActivity, { passive: true }));
  $("#authTrigger")?.addEventListener("click", () => { $("#authModal").hidden = false; });
  $("[data-close-auth]")?.addEventListener("click", () => { $("#authModal").hidden = true; });
  $("#authModal")?.addEventListener("click", (event) => { if (event.target.id === "authModal") event.currentTarget.hidden = true; });
  $("#signInMetaMask")?.addEventListener("click", () => signInWithMetaMask(findMetaMaskProvider()));
  $("#signOutAuth")?.addEventListener("click", signOut);
  updateUi(null);
  if (!configured()) {
    // Page routers must not wait forever when a deployment has a bad public
    // config. They can show the configuration state or return to the landing
    // page without treating an absent session as an authenticated user.
    window.dispatchEvent(new CustomEvent("trivia-auth-ready", { detail: { session: null, error: new Error("AUTH_CONFIG_REQUIRED") } }));
    return;
  }
  try {
    const supabase = await getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    const remoteValid = session ? await verifyAuthWorkerSession(session) : true;
    if (session && (!validWalletSession(session) || !remoteValid)) {
      await endSession("expired");
    } else {
      updateUi(session);
      if (session) startSessionMonitor();
    }
    supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!nextSession) {
        clearWalletSessionMarker();
        window.clearInterval(sessionMonitor);
        sessionMonitor = null;
        updateUi(null);
        return;
      }
      if (event === "SIGNED_IN") markWalletSession();
      if (validWalletSession(nextSession)) {
        updateUi(nextSession);
        startSessionMonitor();
      } else if (event !== "TOKEN_REFRESHED") {
        void endSession("expired");
      }
    });
    window.dispatchEvent(new CustomEvent("trivia-auth-ready", { detail: { session: currentSession } }));
  } catch (error) {
    setState(authDiagnostic(error, tr("auth.unavailable", "Supabase auth is unavailable.")), "is-warning");
    window.dispatchEvent(new CustomEvent("trivia-auth-ready", { detail: { session: null, error } }));
  }
}

window.TriviaArenaAuth = {
  getAccessToken: async () => {
    const supabase = await getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !validWalletSession(session)) {
      if (session) void endSession("expired");
      return null;
    }
    return session.access_token || null;
  },
  getWalletAddress: () => sessionAddress(currentSession),
  checkOnboardingStatus,
  getSupabaseClient,
  signInWithMetaMask: () => signInWithMetaMask(findMetaMaskProvider()),
  signOut,
};

boot();
