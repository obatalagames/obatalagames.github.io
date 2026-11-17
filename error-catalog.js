/*
 * ChestPlayer diagnostic catalog.
 *
 * This file intentionally has no imports or exports. It can be bundled into a
 * Cloudflare Worker or loaded as a normal browser script. Every boundary calls
 * resolve() before returning an error. The fallback is itself a diagnosed,
 * stable boundary condition; no caller receives an empty or opaque error code.
 */
(() => {
  "use strict";

  const VERSION = "2026-10-22.1";
  const FALLBACK_CODE = "DIAGNOSTIC_FALLBACK";

  const KNOWN_CODES = Object.freeze([
    "ACCOUNT_NOT_ONBOARDED", "ACCOUNT_SERVICE_NOT_CONFIGURED", "AMOUNT_REQUIRED", "API_NOT_CONFIGURED",
    "ANTI_CHEAT_SERVICE_NOT_CONFIGURED", "AUTH_BODY_LIMIT_CONFIGURATION_INVALID",
    "AUTH_CONFIG_INVALID", "AUTH_CONFIG_REQUIRED", "AUTH_CLIENT_FAILURE", "AUTH_GATEWAY_NETWORK_FAILURE", "AUTH_INVALID",
    "AUTH_MUST_BE_TOP_LEVEL", "AUTH_PROVIDER_REJECTED", "AUTH_PROVIDER_UNAVAILABLE",
    "AUTH_REQUIRED", "AUTH_SESSION_MISSING", "AUTH_SESSION_NOT_CREATED",
    "AUTH_SESSION_REJECTED", "AUTH_WORKER_NOT_CONFIGURED", "AUTH_WORKER_UNAVAILABLE",
    "CAMERA_CONSENT_REQUIRED", "CASHOUT_CODE_INVALID", "CASHOUT_CODE_REQUIRED",
    "CONTENT_TYPE_NOT_ALLOWED", "DATABASE_CONSTRAINT", "DATABASE_REQUEST_FAILED",
    "DEPOSIT_INDEXER_NOT_CONFIGURED", "DEPOSIT_SIGNATURE_EXPIRED",
    "DEPOSIT_SIGNATURE_INVALID", "DIAGNOSTIC_FALLBACK", "DUPLICATE_OR_IDEMPOTENCY",
    "EDGE_BACKEND_NOT_CONFIGURED", "EDGE_BODY_LIMIT_CONFIGURATION_INVALID",
    "EDGE_HOST_CONFIGURATION_INVALID", "EDGE_HOST_NOT_CONFIGURED", "EDGE_NOT_CONFIGURED",
    "EDGE_ROUTE_NOT_CONFIGURED", "EDGE_SERVICE_NOT_CONFIGURED", "EDGE_SIGNATURE_EXPIRED",
    "EDGE_SIGNATURE_INVALID", "EDGE_UPSTREAM_FAILURE", "EMAIL_DELIVERY_NOT_CONFIGURED",
    "FLASH_CATEGORY_INVALID", "FLASH_ENTRY_OUT_OF_RANGE", "FREE_GAME_ENTRY_ONLY", "GAME_SERVICE_NOT_CONFIGURED",
    "GIFT_CREDIT_TYPE_INVALID", "INVALID_ANSWER", "INVALID_CHAIN_ID", "INVALID_CLIENT_NONCE",
    "INVALID_DEPOSIT_AMOUNT", "INVALID_JSON", "INVALID_LIMIT", "INVALID_MODE",
    "INVALID_ROUTE", "INVALID_SECURITY_QUESTION", "INVALID_TX_HASH",
    "INVALID_USDT_AMOUNT", "INVALID_WALLET_ADDRESS", "INTERNAL_ERROR", "INTERNAL_RPC_INVALID",
    "KYC_CONSENT_REQUIRED", "KYC_COUNTRY_INVALID", "KYC_DOB_INVALID",
    "KYC_DOCUMENTS_REQUIRED", "KYC_DOCUMENT_HASH_INVALID", "KYC_DOCUMENT_INTEGRITY_FAILED",
    "KYC_DOCUMENT_MIME_INVALID", "KYC_DOCUMENT_MIME_REQUIRED", "KYC_DOCUMENT_SIZE_INVALID",
    "KYC_DOCUMENT_TYPE_INVALID", "KYC_PROVIDER_NOT_CONFIGURED", "KYC_REVIEW_ACTION_INVALID", "KYC_UPLOAD_FAILED", "KYC_UPLOAD_PREPARE_FAILED",
    "KYC_STATUS_INVALID", "KYC_STORAGE_FAILED", "LOCALE_MISMATCH", "MATCH_NOT_FOUND",
    "METAMASK_AUTH_UNAVAILABLE", "METAMASK_UNAVAILABLE", "METHOD_NOT_ALLOWED", "NOT_FOUND",
    "OFFER_DECISION_REQUIRED", "OPS_REQUIRED", "OPS_WALLET_REQUIRED", "ORIGIN_NOT_ALLOWED",
    "POLICY_ACCEPTANCE_REQUIRED", "POLICY_SECTIONS_REQUIRED", "POLICY_VERSION_INVALID",
    "RATE_LIMITED", "RATE_LIMITER_UNAVAILABLE", "RECORDING_CONSENT_REQUIRED",
    "RECORDING_CONSENT_VERSION_INVALID", "RECORDING_DURATION_INVALID", "RECORDING_HASH_INVALID",
    "RECORDING_HASH_MISMATCH", "RECORDING_MIME_INVALID", "RECORDING_MIME_MISMATCH",
    "RECORDING_MIME_REQUIRED", "RECORDING_REVIEW_ACTION_INVALID", "RECORDING_SIZE_INVALID",
    "RECORDING_SIZE_MISMATCH", "RECORDING_STORAGE_FAILED", "RECORDING_UPLOAD_FAILED", "RECORDING_UPLOAD_NOT_FOUND",
    "REQUEST_TOO_LARGE", "RPC_MISSING", "SIGN_IN_IN_PROGRESS", "SUPABASE_AUTH_UNAVAILABLE",
    "SUPABASE_NOT_CONFIGURED", "SUPABASE_SDK_INVALID", "SUPABASE_SDK_LOAD_FAILED",
    "TILE_NOT_AVAILABLE", "TURN_NOT_ACTIVE", "UNSUPPORTED_CHAIN", "UNSUPPORTED_LOCALE",
    "UPSTREAM_UNAVAILABLE", "WALLET_ACCOUNT_MISSING", "WALLET_CHAIN_MISMATCH", "WALLET_NO_ACCOUNT",
    "WALLET_IDENTITY_MISMATCH", "WALLET_REQUEST_FAILED", "WALLET_REQUEST_PENDING",
    "WALLET_REQUEST_REJECTED", "WEB3_IDENTITY_REQUIRED", "WEB3_PROVIDER_DISABLED",
    "WEB3_URI_ORIGIN_MISMATCH", "WITHDRAWAL_AMOUNT_MUST_BE_POSITIVE",
    "WITHDRAWAL_STATUS_INVALID", "AUTH_REDIRECT_URI_NOT_ALLOWED", "MICROPHONE_CONSENT_REQUIRED",
    "INVALID_REVIEW_ACTION", "INVALID_SINCE", "INVALID_STATUS", "INVALID_DOCUMENT_TYPE",
    "INVALID_GIFT_CREDIT", "BROWSER_FETCH_FAILED", "CLIENT_FETCH_FAILURE"
  ]);

  const KNOWN = new Set(KNOWN_CODES);

  const EXACT = Object.freeze({
    AUTH_PROVIDER_REJECTED: {
      category: "authentication",
      severity: "warning",
      title: "Authentication provider rejected the request",
      summary: "Supabase Auth returned a provider-level rejection before a session was created.",
      likelyCause: "The wallet signature, provider payload, redirect URI, project configuration, or Auth policy did not match.",
      checks: ["Inspect the provider response status and request ID.", "Verify the exact origin, SIWE URI, and Supabase Auth configuration.", "Sign a fresh message after correcting configuration."],
      nextAction: "Correct the reported Auth configuration or wallet state, then retry once with a new signature.",
      retryable: false,
    },
    ORIGIN_NOT_ALLOWED: {
      category: "request_boundary",
      severity: "warning",
      title: "Browser origin rejected",
      summary: "The request was blocked before authentication or application logic ran.",
      likelyCause: "The exact HTTPS origin in the browser address bar is not in the Worker allowlist.",
      checks: ["Compare the Origin header with the Worker allowlist, including scheme and port.", "Check chestplayer.us and cofrejugador.com separately; each origin must be listed exactly."],
      nextAction: "Add the exact browser origin to the affected allowed-origin variable, redeploy that Worker, and retry from a fresh page.",
      retryable: false,
    },
    AUTH_REQUIRED: {
      category: "authentication",
      severity: "info",
      title: "Sign-in required",
      summary: "The request did not contain a usable Supabase bearer session.",
      likelyCause: "The wallet is signed out, the session expired, or the frontend did not attach Authorization.",
      checks: ["Confirm MetaMask sign-in completed and returned a session.", "Inspect only whether Authorization is present; never log its value."],
      nextAction: "Sign in again, let the session finish loading, and retry once.",
      retryable: false,
    },
    AUTH_INVALID: {
      category: "authentication",
      severity: "warning",
      title: "Session rejected",
      summary: "Supabase rejected the supplied session token.",
      likelyCause: "The token is expired, revoked, malformed, or belongs to another Supabase project.",
      checks: ["Confirm the frontend and Worker use the same ChestPlayer project.", "Check Supabase Auth logs at the request timestamp without exposing the token."],
      nextAction: "Sign out locally, reload, and complete a fresh MetaMask sign-in.",
      retryable: false,
    },
    AUTH_GATEWAY_NETWORK_FAILURE: {
      category: "network",
      severity: "error",
      title: "Authentication gateway could not be reached",
      summary: "The browser could not complete the health request to the public authentication gateway.",
      likelyCause: "The edge hostname is misrouted, DNS/TLS failed, the response was blocked by CORS, or the Worker is unavailable.",
      checks: ["Open the gateway /health URL and confirm it returns JSON with ok=true.", "Inspect the browser Network panel for the OPTIONS and GET response.", "Verify the exact browser origin is allowed by the edge Worker."],
      nextAction: "Fix the edge hostname or CORS route first; do not repeatedly sign wallet messages while the gateway is unreachable.",
      retryable: true,
    },
    AUTH_WORKER_UNAVAILABLE: {
      category: "network",
      severity: "error",
      title: "Authentication Worker could not be reached",
      summary: "The browser could not contact the authentication session boundary.",
      likelyCause: "DNS, TLS, CORS, Worker routing, or a transient network failure interrupted the request.",
      checks: ["Check the request URL and browser Origin header.", "Open the Auth Worker /health endpoint directly.", "Compare the deployed hostname with authOrigin in the public config."],
      nextAction: "Correct the Worker route or allowed origin, then reload the page and retry once.",
      retryable: true,
    },
    EDGE_HOST_NOT_CONFIGURED: {
      category: "service_configuration",
      severity: "error",
      title: "Public edge hostname is not attached to the gateway",
      summary: "The requested hostname reached a Worker that does not have the ChestPlayer edge route configured.",
      likelyCause: "The custom domain is attached to an older Worker, the deployed Worker is stale, or the hostname is not attached as a custom domain.",
      checks: ["Open https://edge.chestplayer.us/health and inspect the service field.", "Confirm the hostname is attached to the current edge Worker, not a backend Worker.", "Confirm the deployed Worker returns service chestplayer-edge."],
      nextAction: "Attach the hostname to the edge gateway Worker, deploy the current edge bundle, and verify /health returns HTTP 200 before testing Auth.",
      retryable: false,
    },
    EDGE_ROUTE_NOT_CONFIGURED: {
      category: "request_boundary",
      severity: "warning",
      title: "Gateway route is not configured",
      summary: "The edge gateway received the hostname but no service owns the requested path.",
      likelyCause: "The frontend is using an old route or the gateway route table does not include the requested endpoint.",
      checks: ["Compare the request path with the current /auth/v1, /api, and /config contract.", "Check the edge request log for host, path, and target."],
      nextAction: "Use the current gateway path or add the route deliberately and redeploy the edge Worker.",
      retryable: false,
    },
    WEB3_URI_ORIGIN_MISMATCH: {
      category: "authentication",
      severity: "warning",
      title: "Wallet signature belongs to another site",
      summary: "The sign-in message URI does not match the active site configuration.",
      likelyCause: "Supabase Auth URLs, the canonical origin, the visible site, or the signed wallet URL are inconsistent.",
      checks: ["Compare the address-bar origin with the SIWE message URI.", "Verify Supabase Site URL and Redirect URLs.", "Clear the old session and sign a new message after configuration changes."],
      nextAction: "Align the exact site origin and redirect configuration, then start a fresh MetaMask sign-in.",
      retryable: false,
    },
    AUTH_REDIRECT_URI_NOT_ALLOWED: {
      category: "authentication",
      severity: "warning",
      title: "Redirect URL is not allowed",
      summary: "Supabase Auth rejected the page URL used by the wallet sign-in flow.",
      likelyCause: "The current site origin or login page is missing from Supabase Auth URL Configuration.",
      checks: ["Verify Site URL is the canonical site origin.", "Add the exact login page and a wildcard for the site path if appropriate."],
      nextAction: "Update Supabase Auth URL Configuration, save it, reload the site, and sign a new message.",
      retryable: false,
    },
    WEB3_PROVIDER_DISABLED: {
      category: "wallet",
      severity: "warning",
      title: "MetaMask provider is unavailable",
      summary: "The page does not have a usable MetaMask EIP-1193 provider.",
      likelyCause: "MetaMask is locked, disabled for the page, missing, or another extension replaced the provider.",
      checks: ["Confirm MetaMask is installed and unlocked.", "Confirm eth_requestAccounts exists on the provider.", "Temporarily disable conflicting wallet extensions if multiple providers are installed."],
      nextAction: "Unlock MetaMask, allow the site connection, refresh the page, and try again.",
      retryable: true,
    },
    METAMASK_UNAVAILABLE: {
      category: "wallet",
      severity: "warning",
      title: "MetaMask was not detected",
      summary: "No MetaMask provider was available in the top-level browser tab.",
      likelyCause: "The extension is not installed, the page is not running in a supported browser, or the page is embedded.",
      checks: ["Open the site directly in a desktop browser with MetaMask installed.", "Confirm the page is not inside an iframe or masked redirect."],
      nextAction: "Open ChestPlayer directly, unlock MetaMask, and try again.",
      retryable: true,
    },
    WALLET_REQUEST_REJECTED: {
      category: "wallet",
      severity: "info",
      title: "Wallet request was cancelled",
      summary: "MetaMask reported that the account or signature request was rejected.",
      likelyCause: "The user selected Reject or closed the wallet prompt.",
      checks: ["Confirm no second MetaMask prompt is open.", "Check that the user intended to cancel the request."],
      nextAction: "Open the wallet prompt again and approve only if the displayed origin and message are correct.",
      retryable: true,
    },
    WALLET_REQUEST_PENDING: {
      category: "wallet",
      severity: "warning",
      title: "Wallet request is already open",
      summary: "MetaMask will not accept another account request while the first is pending.",
      likelyCause: "A prior click opened a wallet prompt that has not been completed.",
      checks: ["Look for an open MetaMask notification or extension tab.", "Do not click the sign-in button repeatedly."],
      nextAction: "Finish or cancel the existing MetaMask prompt, then retry once.",
      retryable: true,
    },
    SUPABASE_NOT_CONFIGURED: {
      category: "service_configuration",
      severity: "error",
      title: "Supabase configuration is missing",
      summary: "The Worker cannot construct a valid request to the configured Supabase project.",
      likelyCause: "A required URL or encrypted key is missing, malformed, or attached to the wrong Worker.",
      checks: ["Verify the Supabase project URL and required Worker secret.", "Confirm no secret key is present in GitHub Pages or browser source."],
      nextAction: "Set the missing encrypted Worker variable and redeploy the affected Worker.",
      retryable: false,
    },
    RATE_LIMITED: {
      category: "abuse_prevention",
      severity: "warning",
      title: "Too many requests",
      summary: "The request was blocked by the configured rate limiter.",
      likelyCause: "A client retry loop, duplicate event handler, or unusually high request volume exceeded the route budget.",
      checks: ["Inspect recent request volume for the route and IP fingerprint.", "Check the browser for duplicate listeners or automatic retries."],
      nextAction: "Wait for the rate window to reset and fix any client retry loop before trying again.",
      retryable: true,
    },
    REQUEST_TOO_LARGE: {
      category: "request_validation",
      severity: "warning",
      title: "Request exceeds the allowed size",
      summary: "The request body is larger than the boundary permits.",
      likelyCause: "Media bytes were sent to a JSON endpoint or a JSON payload exceeded the configured limit.",
      checks: ["Inspect Content-Length and the request path.", "Use the private signed Storage upload flow for media."],
      nextAction: "Send only metadata to the Worker and upload recordings/KYC files through their signed URL.",
      retryable: false,
    },
    RPC_MISSING: {
      category: "database_schema",
      severity: "error",
      title: "Supabase RPC is missing",
      summary: "The Worker reached Supabase, but the authoritative function is not installed in that project.",
      likelyCause: "The deployed Worker contract and the installed migration set are out of sync.",
      checks: ["Compare the RPC name in the stage field with Supabase functions.", "Confirm the latest migrations were applied to this project."],
      nextAction: "Align the Worker with the live schema; do not repeat a money or game operation until verified.",
      retryable: false,
    },
    AUTHORIZATION_OR_RLS: {
      category: "database_authorization",
      severity: "error",
      title: "Supabase authorization rejected",
      summary: "Postgres rejected the operation because of grants, RLS, or the key type.",
      likelyCause: "The database authorization boundary does not match the Worker secret or policy configuration.",
      checks: ["Inspect RPC EXECUTE grants and RLS policies.", "Confirm the browser never calls privileged Supabase endpoints directly."],
      nextAction: "Correct grants, RLS, or the Worker secret, then retry after verifying the server-only boundary.",
      retryable: false,
    },
    INSUFFICIENT_BALANCE: {
      category: "ledger",
      severity: "info",
      title: "Balance is not sufficient",
      summary: "The authoritative ledger rejected the action because available funds are too low.",
      likelyCause: "Another game or withdrawal reserved funds, or the requested amount exceeds the available balance.",
      checks: ["Refresh the account balance.", "Check active games and pending withdrawals.", "Verify the amount is expressed in USDT base units."],
      nextAction: "Choose an amount within the available balance or deposit more funds.",
      retryable: false,
    },
    RECORDING_CONSENT_REQUIRED: {
      category: "recording",
      severity: "warning",
      title: "Camera and microphone consent is required",
      summary: "The match cannot start or continue without the required recording consent.",
      likelyCause: "One or both device permissions were denied, revoked, or not recorded for this match.",
      checks: ["Verify camera and microphone permissions for the exact site origin.", "Check the consent version and match participant state."],
      nextAction: "Allow both devices and rejoin the match; contact support if the browser reports a device failure.",
      retryable: true,
    },
    KYC_DOCUMENT_INTEGRITY_FAILED: {
      category: "identity",
      severity: "warning",
      title: "Identity document verification failed",
      summary: "The uploaded document did not match the server-side size, MIME, or hash checks.",
      likelyCause: "The file changed during upload, was truncated, or its submitted metadata was inaccurate.",
      checks: ["Compare the client SHA-256 with the stored object hash.", "Check the private KYC bucket and signed upload expiration."],
      nextAction: "Upload the original JPG, PNG, or WebP again without transforming it during upload.",
      retryable: true,
    },
    DATABASE_CONSTRAINT: {
      category: "database_validation",
      severity: "warning",
      title: "Database state transition rejected",
      summary: "Postgres rejected the value or state transition because an authoritative constraint failed.",
      likelyCause: "The client submitted stale state or a value outside the server rule.",
      checks: ["Read the current authoritative state.", "Inspect the stage and source code; do not bypass the constraint in the browser."],
      nextAction: "Refresh state, correct the request, and retry once.",
      retryable: false,
    },
  });

  const FAMILY_RULES = Object.freeze([
    {
      test: /^(AUTH_|WEB3_)/,
      category: "authentication",
      title: "Authentication operation failed",
      summary: "The authentication boundary rejected or could not complete the operation.",
      likelyCause: "The session, wallet identity, redirect configuration, or Auth dependency did not satisfy the boundary.",
      nextAction: "Check the failure stage, then refresh the session or correct the Auth configuration before retrying.",
      retryable: false,
    },
    {
      test: /^WALLET_|^METAMASK_/,
      category: "wallet",
      title: "Wallet operation failed",
      summary: "The MetaMask request did not complete with a valid account or signature.",
      likelyCause: "The provider is unavailable, locked, pending, rejected, or returned an unsupported account state.",
      nextAction: "Check MetaMask state and the exact browser origin, then retry once.",
      retryable: true,
    },
    {
      test: /^EDGE_/,
      category: "service_security",
      title: "Edge security or routing check failed",
      summary: "The edge boundary rejected the request or could not route it to the intended service.",
      likelyCause: "The hostname, service binding, HMAC proof, request timestamp, or edge configuration is inconsistent.",
      nextAction: "Use the request ID to compare the edge and backend deployment configuration before retrying.",
      retryable: false,
    },
    {
      test: /^SUPABASE_|^DATABASE_|^RPC_/,
      category: "database",
      title: "Database operation failed",
      summary: "The application could not complete its authoritative Supabase operation.",
      likelyCause: "The project, schema, RPC, grants, RLS, or an upstream dependency is inconsistent.",
      nextAction: "Use the request ID and source code to inspect Supabase logs before retrying.",
      retryable: false,
    },
    {
      test: /^KYC_/,
      category: "identity",
      title: "Identity verification operation failed",
      summary: "The KYC submission did not meet the server-side identity or storage checks.",
      likelyCause: "Required information, document metadata, storage, or reviewer state is incomplete or invalid.",
      nextAction: "Review the exact KYC source code and resubmit only the requested information or document.",
      retryable: false,
    },
    {
      test: /^RECORDING_|^CAMERA_|^MICROPHONE_/,
      category: "recording",
      title: "Game recording operation failed",
      summary: "The required camera, microphone, or private recording-storage operation did not complete.",
      likelyCause: "Permission, consent, file metadata, upload integrity, or private Storage configuration failed.",
      nextAction: "Check the recording stage and device permissions; never replay a money action blindly.",
      retryable: true,
    },
    {
      test: /^WITHDRAWAL_|^PAYOUT_|^CASHOUT_/,
      category: "payout",
      title: "Withdrawal operation failed",
      summary: "The payout request did not pass the authoritative ledger or review-state checks.",
      likelyCause: "The request is missing required KYC, cashout authorization, wallet linkage, or an allowed status transition.",
      nextAction: "Review the payout status and request ID; do not submit a duplicate withdrawal.",
      retryable: false,
    },
    {
      test: /^DEPOSIT_|^BALANCE_|^INSUFFICIENT_/,
      category: "ledger",
      title: "Deposit or balance operation failed",
      summary: "The authoritative ledger did not accept the deposit or balance transition.",
      likelyCause: "The transaction proof, amount, confirmations, wallet, or ledger state is invalid.",
      nextAction: "Verify the transaction details server-side and do not submit a second credit for the same transaction.",
      retryable: false,
    },
    {
      test: /^MATCH_|^FLASH_|^QUESTION_|^TILE_|^TURN_|^GIFT_|^UNSUPPORTED_LOCALE|^LOCALE_/,
      category: "game",
      title: "Game operation failed",
      summary: "The server rejected the game request or could not advance the authoritative match state.",
      likelyCause: "The match is stale, the answer or locale is invalid, or the game state no longer allows this action.",
      nextAction: "Refresh the match state and follow the returned turn or question status; do not submit duplicate answers.",
      retryable: false,
    },
    {
      test: /^POLICY_|^ACCOUNT_/,
      category: "account_state",
      title: "Account setup is incomplete",
      summary: "The account has not satisfied the current agreement or onboarding state.",
      likelyCause: "Terms, Privacy, security setup, or required account fields are missing or stale.",
      nextAction: "Return to onboarding, accept the current agreements, and complete the requested account step.",
      retryable: false,
    },
    {
      test: /^ORIGIN_|^CORS_|^CONTENT_|^REQUEST_|^INVALID_|^METHOD_|^NOT_FOUND|^AMOUNT_/,
      category: "request_validation",
      title: "Request validation failed",
      summary: "The request did not satisfy the endpoint's method, shape, size, or value rules.",
      likelyCause: "A stale frontend, malformed input, unsupported method, or invalid value reached the boundary.",
      nextAction: "Use the failure stage to correct the request shape or refresh the frontend before retrying.",
      retryable: false,
    },
    {
      test: /^RATE_LIMIT/,
      category: "abuse_prevention",
      title: "Request rate exceeded",
      summary: "The request was blocked by the configured abuse-prevention budget.",
      likelyCause: "The client sent repeated requests too quickly or a shared network exceeded its budget.",
      nextAction: "Wait for the rate window and correct duplicate requests before retrying.",
      retryable: true,
    },
  ]);

  const FALLBACK_RULE = Object.freeze({
    category: "application",
    severity: "error",
    title: "Pre-diagnosed boundary failure",
    summary: "A component returned an error that is not represented by a more specific catalog entry.",
    likelyCause: "An upstream provider, deployment, or new code path produced a value outside the current source-code list.",
    checks: ["Preserve the request ID and exact source code.", "Inspect the first failing stage in edge, Worker, and Supabase logs.", "Add a specific catalog entry before the next release if this source code is expected."],
    nextAction: "Do not repeat money or game actions blindly; send support the diagnostic code, source code, request ID, route, and timestamp.",
    retryable: false,
  });

  function safeText(value, limit = 240) {
    return String(value ?? "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
  }

  function normalizeSourceCode(value) {
    const raw = safeText(value, 96).toUpperCase();
    if (!raw || /^(UNKNOWN|NONE|NULL|UNDEFINED|N\/A|UNKNOWN_ERROR)$/.test(raw)) return FALLBACK_CODE;
    return raw.replace(/[^A-Z0-9_:-]/g, "_").slice(0, 96) || FALLBACK_CODE;
  }

  function serviceCode(value) {
    const raw = safeText(value || "core", 32).toUpperCase().replace(/[^A-Z0-9]+/g, "-");
    return raw || "CORE";
  }

  function diagnosticCode(service, sourceCode) {
    return `CP-${serviceCode(service)}-${sourceCode.replace(/[^A-Z0-9]+/g, "-")}`;
  }

  function ruleFor(sourceCode, status) {
    if (EXACT[sourceCode]) return EXACT[sourceCode];
    const family = FAMILY_RULES.find((candidate) => candidate.test.test(sourceCode));
    if (family) {
      const { test: _test, ...familyRule } = family;
      return {
        ...familyRule,
        severity: family.severity || (status >= 500 ? "error" : status >= 400 ? "warning" : "info"),
        checks: [
          `Inspect the exact source code ${sourceCode} at the recorded failure stage.`,
          "Use the request ID to correlate browser, edge, Worker, and Supabase logs.",
        ],
      };
    }
    if (sourceCode === FALLBACK_CODE || status >= 500) return FALLBACK_RULE;
    return {
      ...FALLBACK_RULE,
      severity: "warning",
      retryable: false,
    };
  }

  function resolve(sourceCode, context = {}) {
    const normalized = normalizeSourceCode(sourceCode);
    const status = Number.isInteger(context.status) ? context.status : 500;
    const rule = ruleFor(normalized, status);
    const service = context.service || "core";
    const route = safeText(context.route || "not supplied", 180);
    const method = safeText(context.method || "GET", 16).toUpperCase();
    const requestId = safeText(context.requestId || "not available", 96);
    const stage = safeText(context.stage || `${service}.${route.replace(/^\/+/, "").replaceAll("/", ".") || "root"}`, 180);
    return Object.freeze({
      ...rule,
      diagnosticCode: diagnosticCode(service, normalized),
      sourceCode: normalized,
      service: safeText(service || "core", 32),
      route,
      method,
      status,
      requestId,
      stage,
      timestamp: new Date().toISOString(),
      catalogVersion: VERSION,
      knownSourceCode: KNOWN.has(normalized),
    });
  }

  function fromError(error, context = {}) {
    const sourceCode = error?.sourceCode || error?.code || error?.message || FALLBACK_CODE;
    return resolve(sourceCode, {
      ...context,
      status: Number.isInteger(error?.status) ? error.status : context.status,
      stage: context.stage || error?.stage,
      requestId: context.requestId || error?.requestId,
    });
  }

  const api = Object.freeze({
    version: VERSION,
    fallbackCode: FALLBACK_CODE,
    knownCodes: KNOWN_CODES,
    normalizeSourceCode,
    resolve,
    fromError,
  });

  globalThis.__CP_ERROR_CATALOG = api;
  globalThis.ChestPlayerErrorCatalog = api;
})();
