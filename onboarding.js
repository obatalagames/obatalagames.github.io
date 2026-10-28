(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const config = window.TRIVIA_ARENA_CONFIG || {};
  const state = { ready: false, busy: false };
  const policyVersions = Object.freeze({ terms: "2026-10-18", privacy: "2026-10-18" });

  function tr(key, fallback, vars = {}) {
    const translated = window.TriviaI18n?.t?.(key, vars);
    return translated && translated !== key ? translated : fallback;
  }

  function setStatus(message, tone = "") {
    const node = $("#onboardingState");
    if (node) { node.textContent = String(message); node.dataset.tone = tone; }
  }

  function languageQuery() {
    const value = window.TriviaI18n?.locale || new URLSearchParams(window.location.search).get("lang");
    return value ? `?lang=${encodeURIComponent(value)}` : "";
  }

  function go(page) { window.location.assign(`${page}${languageQuery()}`); }

  async function token() {
    const value = await window.TriviaArenaAuth?.getAccessToken?.();
    return typeof value === "string" ? value : value?.access_token || null;
  }

  async function api(path, options = {}) {
    const accessToken = await token();
    if (!accessToken) throw new Error("AUTH_REQUIRED");
    // Account creation is owned by the Auth boundary. It forwards the
    // validated session to the account service without exposing Supabase or
    // service credentials to the browser.
    const base = String(config.authOrigin || config.apiOrigin || "").replace(/\/$/, "");
    if (!/^https:\/\//i.test(base)) throw new Error("API_NOT_CONFIGURED");
    const headers = new Headers(options.headers || {});
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("accept", "application/json");
    if (options.body !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(`${base}${path}`, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(body?.error || `HTTP_${response.status}`); error.status = response.status; throw error; }
    return body;
  }

  async function checkAccount() {
    try {
      await api("/api/account");
      go("dashboard.html");
    } catch (error) {
      if (error.message === "ACCOUNT_NOT_ONBOARDED") {
        const wallet = window.TriviaArenaAuth?.getWalletAddress?.() || "";
        $("#onboardingWallet").value = wallet;
        state.ready = true;
        setStatus(tr("onboarding.statusReview", "Review the agreements and create your account."));
        return;
      }
      if (error.message === "AUTH_REQUIRED" || error.message === "AUTH_INVALID") return go("index.html");
      setStatus(`${tr("onboarding.accountCheckFailed", "Account check failed")}: ${String(error.message || tr("error.unknown", "unknown error"))}. ${tr("error.tryAgain", "Try again.")}`, "error");
    }
  }

  function selectedSections(kind) {
    return [...document.querySelectorAll(`[data-policy-section="${kind}"]`)].filter((node) => node.checked).map((node) => node.value);
  }

  async function submit(event) {
    event.preventDefault();
    if (!state.ready || state.busy) return;
    if (!$("#termsAccepted").checked || !$("#privacyAccepted").checked) return setStatus(tr("onboarding.errorAccept", "Accept both agreements before creating your account."), "error");
    const termsSections = selectedSections("terms");
    const privacySections = selectedSections("privacy");
    if (termsSections.length !== 10 || privacySections.length !== 10) return setStatus(tr("onboarding.errorSections", "Confirm all ten Terms and all ten Privacy sections."), "error");
    const securityAnswer = $("#securityAnswer").value.trim();
    const cashoutCode = $("#onboardingCashoutCode").value;
    const username = $("#onboardingUsername").value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) return setStatus(tr("onboarding.usernameInvalid", "Choose a username with 3–24 letters, numbers, or underscores; it must start with a letter."), "error");
    if ((securityAnswer && !cashoutCode) || (!securityAnswer && cashoutCode)) return setStatus(tr("onboarding.securityPair", "Enter both payout-security fields, or leave both blank for now."), "error");
    state.busy = true;
    $("#completeOnboarding").disabled = true;
    try {
      const body = {
        username,
        walletAddress: $("#onboardingWallet").value.trim(),
        chainId: Number($("#onboardingChain").value),
        securityQuestionKey: $("#securityQuestionKey").value,
        securityAnswer,
        cashoutCode,
        termsAccepted: true,
        privacyAccepted: true,
        termsVersion: policyVersions.terms,
        privacyVersion: policyVersions.privacy,
        termsSections,
        privacySections,
      };
      await api("/api/account/create", { method: "POST", body });
      if (securityAnswer && cashoutCode) await api("/api/onboarding/complete", { method: "POST", body });
      setStatus(tr("onboarding.statusCreated", "Account created. Opening your dashboard…"));
      window.setTimeout(() => go("dashboard.html"), 350);
    } catch (error) {
      setStatus(`${tr("onboarding.setupFailed", "Account setup failed")}: ${String(error.message || tr("error.unknown", "unknown error"))}.`, "error");
    } finally {
      state.busy = false;
      $("#completeOnboarding").disabled = false;
    }
  }

  function bind() {
    $("#onboardingForm")?.addEventListener("submit", submit);
    window.addEventListener("trivia-auth-change", (event) => {
      if (!state.ready && event.detail?.session) void checkAccount();
    });
    window.addEventListener("trivia-auth-ready", (event) => {
      if (event.detail?.session) void checkAccount();
      else go("index.html");
    });
    window.addEventListener("trivia-locale-change", () => {
      if (state.ready && !state.busy) setStatus(tr("onboarding.statusReview", "Review the agreements and create your account."));
    });
  }

  bind();
})();
