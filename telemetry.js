(() => {
  "use strict";

  const reported = new Set();
  const config = window.TRIVIA_ARENA_CONFIG || {};
  const safe = (value, max = 240) => typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : null;

  async function hash(value) {
    if (!value || !window.crypto?.subtle) return null;
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function report(error, context = {}) {
    const message = safe(error?.message || error || "client_error") || "client_error";
    const stackFingerprint = await hash(safe(error?.stack, 2000));
    const fingerprint = `${message}:${stackFingerprint || "none"}:${safe(context.route || location.pathname, 120)}`;
    if (reported.has(fingerprint)) return;
    reported.add(fingerprint);
    const apiOrigin = String(config.apiOrigin || "").trim();
    if (!/^https:\/\//i.test(apiOrigin) || /your-domain\.example|replace-with-your-domain|YOUR_/i.test(apiOrigin)) return;
    const headers = { "content-type": "application/json", "x-client-version": "chestplayer-ui-2" };
    try {
      const token = await window.TriviaArenaAuth?.getAccessToken?.();
      if (token) headers.authorization = `Bearer ${token}`;
      await fetch(`${apiOrigin.replace(/\/$/, "")}/api/client-errors`, {
        method: "POST",
        headers,
        keepalive: true,
        body: JSON.stringify({
          eventType: context.eventType || "client.error",
          message,
          route: safe(context.route || location.pathname, 160),
          locale: safe(window.TriviaI18n?.locale || document.documentElement.lang, 16),
          clientVersion: "chestplayer-ui-2",
          stackFingerprint,
          errorCode: safe(error?.code || error?.message, 96),
          sourceCode: safe(error?.sourceCode, 96),
          diagnosticCode: safe(error?.diagnostic?.diagnosticCode || error?.diagnosticCode, 128),
          httpStatus: Number.isInteger(error?.status) ? error.status : null,
          retryable: typeof error?.diagnostic?.retryable === "boolean" ? error.diagnostic.retryable : null,
          stage: safe(error?.diagnostic?.stage || error?.stage, 160),
        }),
      });
    } catch (_) { /* telemetry must never interrupt the page */ }
  }

  window.TriviaArenaTelemetry = Object.freeze({ report });
  window.addEventListener("error", (event) => { void report(event.error || event.message, { eventType: "client.unhandled_error" }); });
  window.addEventListener("unhandledrejection", (event) => { void report(event.reason, { eventType: "client.unhandled_rejection" }); });
})();
