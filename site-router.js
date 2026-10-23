(() => {
  "use strict";

  const config = window.TRIVIA_ARENA_CONFIG || {};
  const status = document.querySelector("#routeStatus");
  const auth = () => window.TriviaArenaAuth;
  let onboardingCheckPromise = null;
  let onboardingCheckSessionKey = "";

  function tr(key, fallback, vars = {}) {
    const translated = window.TriviaI18n?.t?.(key, vars);
    return translated && translated !== key ? translated : fallback;
  }

  function languageQuery() {
    const value = window.TriviaI18n?.locale || new URLSearchParams(window.location.search).get("lang");
    return value ? `?lang=${encodeURIComponent(value)}` : "";
  }

  function go(page) {
    window.location.assign(`${page}${languageQuery()}`);
  }

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function sessionKey(session) {
    return String(session?.user?.id || session?.access_token || "authenticated");
  }

  function sourceCode(body, statusCode) {
    const candidates = [body?.error, body?.error?.sourceCode, body?.sourceCode, body?.diagnostic?.sourceCode, body?.diagnostic?.source_code];
    const value = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
    return String(value || `HTTP_${statusCode}`).trim().toUpperCase().replace(/[^A-Z0-9_.:-]/g, "_").slice(0, 96);
  }

  async function fallbackOnboardingStatus(session) {
    const token = await auth()?.getAccessToken?.();
    if (!token) return { status: "signed_out", sourceCode: "AUTH_REQUIRED" };
    const base = String(config.apiOrigin || "").replace(/\/$/, "");
    if (!/^https:\/\//i.test(base)) return { status: "error", sourceCode: "API_ORIGIN_NOT_CONFIGURED" };
    const response = await fetch(`${base}/api/account`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, cache: "no-store", credentials: "omit" });
    const body = await response.json().catch(() => ({}));
    const code = sourceCode(body, response.status);
    const requestId = body?.requestId || response.headers.get("x-request-id") || null;
    if (response.ok) return { status: "ready", sourceCode: "ACCOUNT_READY", requestId };
    if (code === "ACCOUNT_NOT_ONBOARDED") return { status: "required", sourceCode: code, requestId };
    return { status: "error", sourceCode: code, httpStatus: response.status, requestId };
  }

  async function resolveAuthenticatedDestination(session) {
    if (!session) return;
    const key = sessionKey(session);
    if (onboardingCheckPromise && onboardingCheckSessionKey === key) return onboardingCheckPromise;
    onboardingCheckSessionKey = key;
    setStatus(tr("onboarding.checking", "Checking your wallet session…"));
    const currentCheck = (async () => {
      let result;
      try {
        const checker = auth()?.checkOnboardingStatus;
        result = typeof checker === "function" ? await checker(session) : await fallbackOnboardingStatus(session);
      } catch (error) {
        result = { status: "error", sourceCode: "ONBOARDING_STATUS_CHECK_FAILED", message: String(error?.message || error || "Status check failed") };
      }
      if (result?.status === "ready") {
        setStatus(tr("dashboard.accountReady", "Account ready"));
        return go("dashboard.html");
      }
      if (result?.status === "required") {
        setStatus(tr("onboarding.checking", "Checking your wallet session…"));
        return go("onboarding.html");
      }
      if (result?.status === "signed_out") return setStatus(tr("auth.connectWallet", "Connect your wallet to continue."));
      const code = result?.sourceCode || "ONBOARDING_STATUS_CHECK_FAILED";
      const requestId = result?.requestId ? ` Request ID: ${String(result.requestId).slice(0, 64)}.` : "";
      setStatus(`${tr("route.accountLoadFailed", "We could not load your account yet")} (${code}).${requestId} ${tr("error.tryAgain", "Try again.")}`);
    })();
    onboardingCheckPromise = currentCheck;
    try {
      return await currentCheck;
    } finally {
      if (onboardingCheckPromise === currentCheck) {
        onboardingCheckPromise = null;
        onboardingCheckSessionKey = "";
      }
    }
  }

  function bind() {
    document.querySelector("#authTrigger")?.addEventListener("click", () => { document.querySelector("#authModal").hidden = false; });
    document.querySelector("[data-close-auth]")?.addEventListener("click", () => { document.querySelector("#authModal").hidden = true; });
    document.querySelector("#authModal")?.addEventListener("click", (event) => { if (event.target.id === "authModal") event.currentTarget.hidden = true; });
    document.querySelectorAll("[data-requires-auth]").forEach((node) => node.addEventListener("click", async (event) => {
      event.preventDefault();
      const target = node.getAttribute("href") || "dashboard.html";
      let accessToken = null;
      try { accessToken = await auth()?.getAccessToken?.(); } catch (_) { accessToken = null; }
      if (accessToken) return window.location.assign(target);
      const modal = document.querySelector("#authModal");
      if (modal) modal.hidden = false;
    }));
    window.addEventListener("trivia-auth-change", (event) => {
      const session = event.detail?.session || null;
      if (session) void resolveAuthenticatedDestination(session);
      else {
        onboardingCheckPromise = null;
        onboardingCheckSessionKey = "";
        setStatus(tr("landing.status", "Connect your wallet to sign in or create an account."));
      }
    });
    window.addEventListener("trivia-auth-ready", (event) => {
      const session = event.detail?.session || null;
      if (session) void resolveAuthenticatedDestination(session);
      else setStatus(tr("landing.status", "Connect your wallet to sign in or create an account."));
    });
  }

  bind();
})();
