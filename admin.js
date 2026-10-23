(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const config = window.TRIVIA_ARENA_CONFIG || {};
  const adminConfig = window.TRIVIA_ARENA_ADMIN_CONFIG || {};
  const state = { session: null, rows: [], selected: null, signedUrl: "", kycRows: [], selectedKyc: null, kycUrls: {} };

  function tr(key, fallback, vars = {}) {
    const translated = window.TriviaI18n?.t?.(key, vars);
    return translated && translated !== key ? translated : fallback;
  }

  function apiOrigin() { return String(adminConfig.adminApiOrigin || "").replace(/\/$/, ""); }
  function htmlEscape(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  function formatUsdt(value) {
    try {
      const units = BigInt(String(value ?? "0"));
      const whole = units / 1_000_000n;
      const fraction = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
      return `$${whole.toString()}${fraction ? `.${fraction}` : ".00"}`;
    } catch (_) { return "—"; }
  }
  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return tr("admin.sizeUnavailable", "size unavailable");
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  function shortAddress(value) {
    const address = String(value || "");
    return /^0x[0-9a-f]{40}$/i.test(address) ? `${address.slice(0, 8)}…${address.slice(-6)}` : address || "—";
  }
  function setMessage(message, tone = "") {
    const node = $("#queueMessage");
    if (!node) return;
    node.className = `ops-message ${tone}`.trim();
    node.textContent = String(message || "");
  }
  function setDetailMessage(message, tone = "") {
    const node = $("#detailMessage");
    if (!node) return;
    node.className = `form-note ${tone}`.trim();
    node.textContent = String(message || "");
  }
  function setKycMessage(message, tone = "") {
    const node = $("#kycDetailMessage");
    if (!node) return;
    node.className = `form-note ${tone}`.trim();
    node.textContent = String(message || "");
  }
  function clientError(error, route) {
    void window.TriviaArenaTelemetry?.report(error, { eventType: "client.admin_request_error", route });
  }
  function displayStatus(value) {
    const normalized = String(value || "unknown").toLowerCase();
    const translated = tr(`admin.status.${normalized}`, "");
    return translated || normalized.replaceAll("_", " ");
  }
  function displayRecordingStatus(value) {
    const normalized = String(value || "none").toLowerCase();
    const key = { uploaded: "recording.statusUploaded", uploading: "recording.statusUploading", capturing: "recording.statusCapturing", retry: "recording.statusRetry", stopped: "recording.statusStopped", blocked: "recording.statusBlocked", not_active: "recording.statusNotActive", none: "recording.none" }[normalized];
    return key ? tr(key, normalized.replaceAll("_", " ")) : normalized.replaceAll("_", " ");
  }
  function isFinal(row) { return ["paid", "rejected", "cancelled"].includes(String(row?.status)); }
  function isPending(row) { return ["pending_review", "kyc_pending"].includes(String(row?.status)); }

  async function accessToken() {
    const auth = window.TriviaArenaAuth;
    if (!auth || typeof auth.getAccessToken !== "function") return null;
    return auth.getAccessToken();
  }

  async function api(path, options = {}) {
    if (!/^https:\/\//i.test(apiOrigin())) throw new Error("API_NOT_CONFIGURED");
    const token = await accessToken();
    if (!token) throw new Error("AUTH_REQUIRED");
    const headers = new Headers(options.headers || {});
    headers.set("authorization", `Bearer ${token}`);
    headers.set("accept", "application/json");
    headers.set("x-client-version", String(adminConfig.clientVersion || "chestplayer-ops-2"));
    if (options.body !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(`${apiOrigin()}${path}`, {
      ...options,
      headers,
      body: options.body === undefined || typeof options.body === "string" ? options.body : JSON.stringify(options.body),
    });
    let body = null;
    try { body = await response.json(); } catch (_) { /* response may be empty */ }
    if (!response.ok) {
      const error = new Error(typeof body?.error === "string" ? body.error : `HTTP_${response.status}`);
      error.status = response.status;
      clientError(error, path);
      throw error;
    }
    return body;
  }

  function updateStats(rows) {
    $("#statVisible").textContent = String(rows.length);
    $("#statPending").textContent = String(rows.filter(isPending).length);
    $("#statRecordings").textContent = String(rows.filter((row) => row.recording_id).length);
    $("#statKyc").textContent = String(rows.filter((row) => row.kyc_required).length);
  }

  function renderQueue(rows) {
    const list = $("#payoutQueue");
    if (!list) return;
    updateStats(rows);
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `<strong>${htmlEscape(tr("admin.noRequests", "No requests in this view."))}</strong><span>${htmlEscape(tr("admin.refreshAfterPayout", "Refresh after a player submits a payout request."))}</span>`;
      list.appendChild(empty);
      return;
    }
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `queue-row${state.selected?.withdrawal_id === row.withdrawal_id ? " selected" : ""}`;
      button.dataset.withdrawalId = row.withdrawal_id;
      button.innerHTML = `<div><strong>${htmlEscape(row.participant_label || tr("admin.player", "Player"))}</strong><span>${htmlEscape(formatUsdt(row.amount_base_units))}</span><small>${htmlEscape(row.match_mode === "box_5x5" ? tr("admin.scheduledMatch", "Scheduled match") : tr("admin.manualPayout", "Manual payout"))} · ${htmlEscape(formatDate(row.created_at))}</small></div><div class="queue-row-meta"><span class="status-pill ${htmlEscape(row.status)}">${htmlEscape(displayStatus(row.status))}</span><small>${row.recording_id ? htmlEscape(tr("admin.videoLinked", "video linked")) : htmlEscape(tr("admin.noVideo", "no video"))}</small></div>`;
      button.addEventListener("click", () => selectRow(row.withdrawal_id));
      list.appendChild(button);
    }
  }

  function kycDocument(row, documentType) {
    return Array.isArray(row?.documents) ? row.documents.find((document) => document?.document_type === documentType) : null;
  }

  function renderKycQueue(rows) {
    const list = $("#kycQueue");
    if (!list) return;
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `<strong>${htmlEscape(tr("admin.noKyc", "No KYC submissions in this view."))}</strong><span>${htmlEscape(tr("admin.refreshAfterKyc", "Refresh after a player submits both required images."))}</span>`;
      list.appendChild(empty);
      return;
    }
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `queue-row${state.selectedKyc?.submission_id === row.submission_id ? " selected" : ""}`;
      button.dataset.submissionId = row.submission_id;
      const name = `${row.legal_first_name || ""} ${row.legal_last_name || ""}`.trim() || tr("admin.unnamedPlayer", "Unnamed player");
      const selfie = kycDocument(row, "selfie");
      const photoId = kycDocument(row, "photo_id_address");
      button.innerHTML = `<div><strong>${htmlEscape(name)}</strong><span>${htmlEscape(row.country_code || "—")}</span><small>${htmlEscape(formatDate(row.submitted_at || ""))} · ${htmlEscape(selfie?.status === "uploaded" || selfie?.status === "accepted" ? tr("admin.selfieReady", "selfie ready") : tr("admin.selfiePending", "selfie pending"))} · ${htmlEscape(photoId?.status === "uploaded" || photoId?.status === "accepted" ? tr("admin.idReady", "ID ready") : tr("admin.idPending", "ID pending"))}</small></div><div class="queue-row-meta"><span class="status-pill ${htmlEscape(String(row.status || "unknown"))}">${htmlEscape(displayStatus(row.status))}</span><small>${htmlEscape(row.submission_id?.slice(0, 8) || "")}</small></div>`;
      button.addEventListener("click", () => selectKyc(row.submission_id));
      list.appendChild(button);
    }
  }

  function clearKycImages() {
    state.kycUrls = {};
    for (const [imageId, frameId] of [["#kycSelfieImage", "#kycSelfieState"], ["#kycPhotoIdImage", "#kycPhotoIdState"]]) {
      const image = $(imageId);
      const frame = $(frameId);
      if (image) { image.removeAttribute("src"); image.hidden = true; }
      if (frame) { frame.hidden = false; frame.textContent = tr("admin.privateImageNotLoaded", "Private image not loaded"); }
    }
  }

  function updateKycActions(row = state.selectedKyc) {
    const usable = Boolean(row) && !["verified", "rejected"].includes(String(row?.status));
    $("#verifyKyc").disabled = !usable;
    $("#needsInfoKyc").disabled = !usable;
    $("#rejectKyc").disabled = !usable;
    $("#loadKycSelfie").disabled = !row || !kycDocument(row, "selfie") || ["deleted", "expired", "delete_pending"].includes(String(kycDocument(row, "selfie")?.status));
    $("#loadKycPhotoId").disabled = !row || !kycDocument(row, "photo_id_address") || ["deleted", "expired", "delete_pending"].includes(String(kycDocument(row, "photo_id_address")?.status));
  }

  function renderKycDetail(row) {
    const detail = $("#kycDetail");
    if (!detail) return;
    if (!row) {
      detail.hidden = true;
      clearKycImages();
      return;
    }
    detail.hidden = false;
    $("#kycDetailStatus").className = `status-pill ${htmlEscape(String(row.status || "unknown"))}`;
    $("#kycDetailStatus").textContent = displayStatus(row.status);
    $("#kycDetailName").textContent = `${row.legal_first_name || ""} ${row.legal_last_name || ""}`.trim() || "—";
    $("#kycDetailDob").textContent = row.date_of_birth || "—";
    $("#kycDetailCountry").textContent = row.country_code || "—";
    $("#kycDetailAddress").textContent = [row.address_line1, row.address_line2, row.city, row.region, row.postal_code].filter(Boolean).join(", ") || "—";
    $("#kycDetailSubmitted").textContent = formatDate(row.submitted_at);
    $("#kycDetailId").textContent = row.submission_id || "—";
    $("#kycSignature").value = "";
    $("#kycJustification").value = "";
    setKycMessage(tr("admin.loadKycBeforeDecision", "Load both private documents before recording the KYC decision."));
    clearKycImages();
    updateKycActions(row);
  }

  function selectKyc(submissionId) {
    state.selectedKyc = state.kycRows.find((row) => row.submission_id === submissionId) || null;
    renderKycQueue(state.kycRows);
    renderKycDetail(state.selectedKyc);
  }

  async function loadKycQueue() {
    if (!state.session) return;
    const status = $("#kycStatus")?.value || "submitted";
    setMessage(tr("admin.loadingKyc", "Loading the private KYC queue…"));
    try {
      const result = await api(`/api/admin/kyc?status=${encodeURIComponent(status)}&limit=200`);
      state.kycRows = Array.isArray(result) ? result : [];
      const selectedId = state.selectedKyc?.submission_id;
      state.selectedKyc = state.kycRows.find((row) => row.submission_id === selectedId) || null;
      renderKycQueue(state.kycRows);
      renderKycDetail(state.selectedKyc);
      setMessage(`${tr("admin.loaded", "Loaded")} ${state.kycRows.length} ${tr("admin.kycSubmissionCount", "KYC submission")}${state.kycRows.length === 1 ? "" : tr("admin.pluralSuffix", "s")}.`, "success");
    } catch (error) {
      state.kycRows = [];
      state.selectedKyc = null;
      renderKycQueue([]);
      renderKycDetail(null);
      const code = String(error?.message || "KYC_QUEUE_LOAD_FAILED");
      setMessage(code === "OPS_WALLET_REQUIRED" ? tr("admin.allowlistedWallet", "Connect the allowlisted operator wallet before loading KYC.") : code === "OPS_REQUIRED" ? tr("admin.notAuthorized", "This wallet is not authorized for operations.") : `${tr("admin.kycUnavailable", "KYC queue unavailable")}: ${code}`, "error");
    }
  }

  async function loadKycDocument(documentType) {
    const row = state.selectedKyc;
    const document = kycDocument(row, documentType);
    if (!row || !document?.document_id) return setKycMessage(tr("admin.selectKycFirst", "Select a KYC submission first."), "error");
    const image = documentType === "selfie" ? $("#kycSelfieImage") : $("#kycPhotoIdImage");
    const frame = documentType === "selfie" ? $("#kycSelfieState") : $("#kycPhotoIdState");
    setKycMessage(`${tr("admin.creatingReviewUrl", "Creating a short-lived private URL for the")} ${documentType === "selfie" ? tr("admin.selfie", "selfie") : tr("admin.photoId", "photo ID")}…`);
    try {
      const result = await api(`/api/admin/kyc/${encodeURIComponent(row.submission_id)}/documents/${encodeURIComponent(document.document_id)}/review-url`);
      if (!result?.reviewUrl) throw new Error("KYC_REVIEW_URL_MISSING");
      state.kycUrls[documentType] = result.reviewUrl;
      image.src = result.reviewUrl;
      image.hidden = false;
      frame.hidden = true;
      setKycMessage(tr("admin.privateDocumentLoaded", "Private document loaded. Review it, then record a signed decision."), "success");
    } catch (error) { setKycMessage(`${tr("admin.documentUnavailable", "Document unavailable")}: ${String(error?.message || "KYC_REVIEW_URL_FAILED")}`, "error"); }
  }

  function kycAttestation() {
    const signature = $("#kycSignature")?.value.trim() || "";
    const justification = $("#kycJustification")?.value.trim() || "";
    if (signature.length < 2 || signature.length > 160) throw new Error(tr("admin.signatureLength", "Enter a typed e-signature between 2 and 160 characters."));
    if (justification.length < 10 || justification.length > 2000) throw new Error(tr("admin.justificationLength", "Enter a justification between 10 and 2,000 characters."));
    return { signature, justification };
  }

  async function reviewKyc(action) {
    const row = state.selectedKyc;
    if (!row) return setKycMessage(tr("admin.selectKycFirst", "Select a KYC submission first."), "error");
    try {
      const signed = kycAttestation();
      setKycMessage(tr("admin.submittingKyc", "Submitting signed KYC decision…"));
      await api(`/api/admin/kyc/${encodeURIComponent(row.submission_id)}/review`, { method: "POST", body: { action, signature: signed.signature, justification: signed.justification } });
      setMessage(`${tr("admin.kycDecisionRecorded", "KYC decision recorded")}: ${displayStatus(action)}.`, "success");
      await Promise.all([loadKycQueue(), loadQueue()]);
    } catch (error) { setKycMessage(String(error?.message || "KYC_REVIEW_FAILED"), "error"); }
  }

  function clearVideo() {
    state.signedUrl = "";
    const video = $("#reviewVideo");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.hidden = true;
    }
    const stateNode = $("#videoState");
    if (stateNode) {
      stateNode.hidden = false;
      stateNode.innerHTML = `<span class="video-icon">▶</span><strong>${htmlEscape(tr("admin.videoNotLoaded", "Video not loaded"))}</strong><small>${htmlEscape(tr("admin.videoUrlCopy", "A short-lived signed URL is created only after this operator requests playback."))}</small>`;
    }
  }

  function renderDetail(row) {
    if (!row) {
      $("#payoutDetail").hidden = true;
      $("#detailEmpty").hidden = false;
      clearVideo();
      return;
    }
    $("#detailEmpty").hidden = true;
    $("#payoutDetail").hidden = false;
    $("#detailStatus").className = `status-pill ${htmlEscape(row.status)}`;
    $("#detailStatus").textContent = displayStatus(row.status);
    $("#detailPlayer").textContent = row.participant_label || "Player";
    $("#detailAmount").textContent = formatUsdt(row.amount_base_units);
    $("#detailTier").textContent = displayStatus(row.review_tier);
    $("#detailKyc").textContent = `${tr("admin.required", "Required")} · ${displayStatus(row.kyc_status || "pending")}`;
    $("#detailWallet").textContent = shortAddress(row.wallet_address_snapshot);
    $("#detailMatch").textContent = row.source_match_id ? `${row.match_mode === "box_5x5" ? tr("admin.scheduledMatch", "Scheduled match") : tr("admin.manualPayout", "Manual payout")} · ${formatDate(row.completed_at || row.scheduled_at)}` : tr("admin.noScheduledSource", "No scheduled-match source");
    $("#detailRecording").textContent = row.recording_id ? `${displayRecordingStatus(row.recording_status)} · ${formatBytes(row.recording_bytes)}` : tr("admin.noLinkedVideo", "No linked video");
    $("#detailCreated").textContent = formatDate(row.created_at);
    $("#videoMeta").textContent = row.recording_id
      ? `${displayStatus(row.recording_status)} · ${formatBytes(row.recording_bytes)}${row.recording_duration_ms ? ` · ${(Number(row.recording_duration_ms) / 1000).toFixed(0)} sec` : ""}${row.recording_retention_expires_at ? ` · retention ${formatDate(row.recording_retention_expires_at)}` : ""}`
      : tr("admin.noRecordingLinked", "No recording linked to this payout.");
    $("#loadVideo").disabled = !row.recording_id || ["deleted", "cancelled", "expired", "delete_pending"].includes(row.recording_status);
    $("#loadVideo").textContent = row.recording_id ? tr("admin.loadVideo", "Load video") : tr("admin.noVideo", "No video");
    $("#operatorSignature").value = "";
    $("#reviewJustification").value = "";
    $("#txHash").value = "";
    setDetailMessage(tr("admin.selectAction", "Select an action and provide the required attestation."));
    updateActionButtons(row);
  }

  function updateActionButtons(row = state.selected) {
    const hasRow = Boolean(row);
    const status = String(row?.status || "");
    const recordingFinal = ["deleted", "cancelled", "expired", "delete_pending"].includes(String(row?.recording_status));
    $("#approveWin").disabled = !hasRow || isFinal(row) || (row.kyc_required && row.kyc_status !== "verified");
    $("#denyWin").disabled = !hasRow || isFinal(row);
    $("#holdPayout").disabled = !hasRow || isFinal(row);
    $("#issuePayout").disabled = !hasRow || status !== "approved";
    $("#deleteVideo").disabled = !hasRow || !row.recording_id || !isFinal(row) || recordingFinal;
  }

  function selectRow(withdrawalId) {
    state.selected = state.rows.find((row) => row.withdrawal_id === withdrawalId) || null;
    clearVideo();
    renderQueue(state.rows);
    renderDetail(state.selected);
  }

  async function loadQueue() {
    if (!state.session) return;
    const status = $("#queueStatus")?.value || "pending";
    setMessage(tr("admin.loadingPayoutQueue", "Loading the private payout queue…"));
    try {
      const result = await api(`/api/admin/withdrawals?status=${encodeURIComponent(status)}&limit=200`);
      state.rows = Array.isArray(result) ? result : [];
      const selectedId = state.selected?.withdrawal_id;
      state.selected = state.rows.find((row) => row.withdrawal_id === selectedId) || null;
      clearVideo();
      renderQueue(state.rows);
      renderDetail(state.selected);
      setMessage(`${tr("admin.loaded", "Loaded")} ${state.rows.length} ${tr("admin.requestCount", "request")}${state.rows.length === 1 ? "" : tr("admin.pluralSuffix", "s")}.`, "success");
    } catch (error) {
      state.rows = [];
      state.selected = null;
      renderQueue([]);
      renderDetail(null);
      const code = String(error?.message || "QUEUE_LOAD_FAILED");
      setMessage(code === "OPS_REQUIRED" ? tr("admin.roleRequired", "This wallet is authenticated but is not assigned an ops or admin role.") : `${tr("admin.queueUnavailable", "Queue unavailable")}: ${code}`, "error");
    }
  }

  async function loadVideo() {
    const row = state.selected;
    if (!row?.recording_id) return setDetailMessage(tr("admin.noRecordingForPayout", "There is no recording linked to this payout."), "error");
    setDetailMessage(tr("admin.mintingReviewUrl", "Minting a short-lived private review URL…"));
    $("#loadVideo").disabled = true;
    try {
      const result = await api(`/api/admin/recordings/${encodeURIComponent(row.recording_id)}/review-url`);
      if (!result?.reviewUrl) throw new Error("REVIEW_URL_MISSING");
      state.signedUrl = result.reviewUrl;
      const video = $("#reviewVideo");
      video.src = result.reviewUrl;
      video.hidden = false;
      $("#videoState").hidden = true;
      $("#videoMeta").textContent = `${displayStatus(result.status || row.recording_status)} · ${formatBytes(result.bytes)} · signed URL expires in ${result.expiresIn || 300}s`;
      setDetailMessage(tr("admin.videoLoaded", "Video loaded. Review the evidence, then record the payout decision."), "success");
      if (row.recording_status === "uploaded") row.recording_status = "under_review";
      updateActionButtons(row);
    } catch (error) {
      setDetailMessage(`${tr("admin.videoUnavailable", "Video unavailable")}: ${String(error?.message || "REVIEW_URL_FAILED")}`, "error");
    } finally {
      $("#loadVideo").disabled = !row.recording_id || ["deleted", "cancelled", "expired", "delete_pending"].includes(row.recording_status);
    }
  }

  function attestation() {
    const signature = $("#operatorSignature")?.value.trim() || "";
    const justification = $("#reviewJustification")?.value.trim() || "";
    if (signature.length < 2 || signature.length > 160) throw new Error(tr("admin.signatureLength", "Enter a typed e-signature between 2 and 160 characters."));
    if (justification.length < 10 || justification.length > 2000) throw new Error(tr("admin.justificationLength", "Enter a justification between 10 and 2,000 characters."));
    return { signature, justification };
  }

  async function performAction(action) {
    const row = state.selected;
    if (!row) return setDetailMessage(tr("admin.selectPayoutFirst", "Select a payout request first."), "error");
    try {
      const signed = attestation();
      const txHash = $("#txHash")?.value.trim() || "";
      if (action === "mark_paid" && !/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error(tr("admin.txHashRequired", "Enter the 32-byte payout transaction hash to issue funds."));
      setDetailMessage(tr("admin.submittingDecision", "Submitting signed decision…"));
      const result = await api(`/api/admin/withdrawals/${encodeURIComponent(row.withdrawal_id)}/review`, {
        method: "POST",
        body: { action, signature: signed.signature, justification: signed.justification, txHash: txHash || null, recordingId: row.recording_id || null },
      });
      setMessage(`${tr("admin.decisionRecorded", "Decision recorded")}: ${displayStatus(result?.status || action)}.`, "success");
      await loadQueue();
    } catch (error) {
      setDetailMessage(String(error?.message || "REVIEW_FAILED"), "error");
    }
  }

  async function deleteVideo() {
    const row = state.selected;
    if (!row?.recording_id) return setDetailMessage(tr("admin.noVideoForPayout", "No video is linked to this payout."), "error");
    if (!isFinal(row)) return setDetailMessage(tr("admin.deleteBlocked", "Video deletion is blocked until the payout is paid, denied, or cancelled."), "error");
    if (!window.confirm(tr("admin.confirmDelete", "Delete this private recording from storage? This cannot be undone."))) return;
    try {
      const signed = attestation();
      setDetailMessage(tr("admin.deletingRecording", "Marking the recording for deletion and removing the private object…"));
      await api(`/api/admin/withdrawals/${encodeURIComponent(row.withdrawal_id)}/recording/delete`, {
        method: "POST",
        body: { recordingId: row.recording_id, signature: signed.signature, justification: signed.justification },
      });
      clearVideo();
      setMessage(tr("admin.deletionComplete", "Recording deletion was recorded and completed."), "success");
      await loadQueue();
    } catch (error) {
      setDetailMessage(String(error?.message || "VIDEO_DELETE_FAILED"), "error");
    }
  }

  function handleAuthChange(event) {
    state.session = event.detail?.session || null;
    if (!state.session) {
      state.rows = [];
      state.selected = null;
      state.kycRows = [];
      state.selectedKyc = null;
      renderQueue([]);
      renderDetail(null);
      renderKycQueue([]);
      renderKycDetail(null);
      setMessage(tr("admin.signInQueue", "Sign in to load the private payout queue."));
      return;
    }
    void Promise.all([loadQueue(), loadKycQueue()]);
  }

  $("#queueStatus")?.addEventListener("change", () => void loadQueue());
  $("#refreshQueue")?.addEventListener("click", () => void loadQueue());
  $("#kycStatus")?.addEventListener("change", () => void loadKycQueue());
  $("#refreshKyc")?.addEventListener("click", () => void loadKycQueue());
  $("#loadKycSelfie")?.addEventListener("click", () => void loadKycDocument("selfie"));
  $("#loadKycPhotoId")?.addEventListener("click", () => void loadKycDocument("photo_id_address"));
  $("#verifyKyc")?.addEventListener("click", () => void reviewKyc("verify"));
  $("#needsInfoKyc")?.addEventListener("click", () => void reviewKyc("needs_info"));
  $("#rejectKyc")?.addEventListener("click", () => void reviewKyc("reject"));
  $("#loadVideo")?.addEventListener("click", () => void loadVideo());
  $("#approveWin")?.addEventListener("click", () => void performAction("approve"));
  $("#denyWin")?.addEventListener("click", () => void performAction("reject"));
  $("#holdPayout")?.addEventListener("click", () => void performAction("hold"));
  $("#issuePayout")?.addEventListener("click", () => void performAction("mark_paid"));
  $("#deleteVideo")?.addEventListener("click", () => void deleteVideo());
  window.addEventListener("trivia-auth-change", handleAuthChange);
  renderQueue([]);
  renderDetail(null);
  renderKycQueue([]);
  renderKycDetail(null);
})();
