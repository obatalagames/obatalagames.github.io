(() => {
  "use strict";

  const auth = window.ChestPlayerAuth;
  if (!auth) return;

  const button = document.querySelector("#loginButton");
  const status = document.querySelector("#loginStatus");
  const sessionPanel = document.querySelector("#sessionPanel");
  const sessionWallet = document.querySelector("#sessionWallet");
  const logoutButton = document.querySelector("#logoutButton");
  const hint = document.querySelector("#loginHint");
  const diagnosticDetails = document.querySelector("#diagnosticDetails");
  const diagnosticText = document.querySelector("#diagnosticText");

  function setStatus(message, tone = "") {
    if (!status) return;
    status.className = `status-line ${tone}`.trim();
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.textContent = String(message || "");
    status.replaceChildren(dot, copy);
  }

  function showDiagnostic(error) {
    const value = error?.diagnostic || auth.formatDiagnostic(error, "Authentication failed.");
    if (diagnosticText) diagnosticText.textContent = value;
    if (diagnosticDetails) diagnosticDetails.open = true;
  }

  function render(session, error = null) {
    const signedIn = Boolean(session);
    if (sessionPanel) sessionPanel.hidden = !signedIn;
    if (button) button.hidden = signedIn;
    if (hint) hint.hidden = signedIn;
    if (sessionWallet) {
      const address = auth.getWalletAddress();
      sessionWallet.textContent = address || "Verified wallet";
      sessionWallet.title = address || "Verified wallet";
    }
    if (error) {
      setStatus("Your session could not be restored.", "is-warning");
      showDiagnostic(error);
    } else if (signedIn) {
      setStatus("Wallet verified.", "is-success");
    } else {
      setStatus("MetaMask is ready.");
    }
  }

  auth.ready.then(({ session, error }) => render(session, error));
  window.addEventListener("chestplayer-auth-ready", (event) => render(event.detail?.session || null, event.detail?.error || null));
  window.addEventListener("chestplayer-auth-changed", (event) => render(event.detail?.session || null));
  window.addEventListener("chestplayer-auth-progress", (event) => {
    if (event.detail?.state === "wallet_request") setStatus("Waiting for MetaMask…");
    if (event.detail?.state === "signature_request") setStatus("Review the sign-in request in MetaMask…");
  });
  window.addEventListener("chestplayer-auth-error", (event) => showDiagnostic(event.detail?.error));
  window.addEventListener("chestplayer-auth-notice", (event) => {
    if (event.detail?.reason === "expired" || event.detail?.reason === "invalid") setStatus("Your session ended. Sign in again to continue.", "is-warning");
    if (event.detail?.reason === "wallet_changed") setStatus("Your wallet changed. Sign in again to continue.", "is-warning");
    if (event.detail?.reason === "network_changed") setStatus("Switch MetaMask to Ethereum Mainnet and sign in again.", "is-warning");
  });

  button?.addEventListener("click", async () => {
    button.disabled = true;
    setStatus("Opening MetaMask…");
    if (diagnosticDetails) diagnosticDetails.open = false;
    try {
      const session = await auth.signInWithMetaMask();
      render(session);
    } catch (error) {
      setStatus("Sign-in did not complete.", "is-error");
      showDiagnostic(error);
    } finally {
      button.disabled = false;
    }
  });

  logoutButton?.addEventListener("click", async () => {
    logoutButton.disabled = true;
    setStatus("Signing out…");
    try {
      await auth.signOut();
      render(null);
    } finally {
      logoutButton.disabled = false;
    }
  });
})();
