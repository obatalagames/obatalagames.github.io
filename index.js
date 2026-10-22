(() => {
  "use strict";

  const auth = window.ChestPlayerAuth;
  if (!auth) return;

  const state = document.querySelector("#authState");
  const signedOutPanel = document.querySelector("#signedOutPanel");
  const signedInPanel = document.querySelector("#signedInPanel");
  const walletAddress = document.querySelector("#walletAddress");
  const signOutButton = document.querySelector("#signOutButton");
  const headerLoginLink = document.querySelector("#headerLoginLink");

  function setState(message, tone = "") {
    if (!state) return;
    state.className = `status-line ${tone}`.trim();
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.textContent = String(message || "");
    state.replaceChildren(dot, copy);
  }

  function shortAddress(value) {
    const address = String(value || "");
    return /^0x[0-9a-f]{40}$/i.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Wallet connected";
  }

  function render(session, error = null) {
    const address = auth.getWalletAddress();
    const signedIn = Boolean(session);
    if (signedOutPanel) signedOutPanel.hidden = signedIn;
    if (signedInPanel) signedInPanel.hidden = !signedIn;
    if (walletAddress) {
      walletAddress.textContent = address || "Verified wallet";
      walletAddress.title = address || "Verified wallet";
    }
    if (headerLoginLink) headerLoginLink.textContent = signedIn ? shortAddress(address) : "Sign in";
    if (error) {
      setState("We could not verify your session.", "is-warning");
    } else if (signedIn) {
      setState("Wallet verified.", "is-success");
    } else {
      setState("Connect a wallet to continue.");
    }
  }

  auth.ready.then(({ session, error }) => render(session, error));
  window.addEventListener("chestplayer-auth-ready", (event) => render(event.detail?.session || null, event.detail?.error || null));
  window.addEventListener("chestplayer-auth-changed", (event) => render(event.detail?.session || null));
  window.addEventListener("chestplayer-auth-progress", (event) => {
    if (event.detail?.state === "wallet_request") setState("Waiting for MetaMask…");
    if (event.detail?.state === "signature_request") setState("Review the sign-in request in MetaMask…");
    if (event.detail?.state === "signed_in") setState("Wallet verified.", "is-success");
  });
  window.addEventListener("chestplayer-auth-notice", (event) => {
    if (event.detail?.reason === "expired" || event.detail?.reason === "invalid") setState("Your session ended. Sign in again to continue.", "is-warning");
    if (event.detail?.reason === "wallet_changed") setState("Your wallet changed. Sign in again to continue.", "is-warning");
    if (event.detail?.reason === "network_changed") setState("Switch MetaMask to Ethereum Mainnet and sign in again.", "is-warning");
  });

  signOutButton?.addEventListener("click", async () => {
    signOutButton.disabled = true;
    setState("Signing out…");
    try {
      await auth.signOut();
      render(null);
    } finally {
      signOutButton.disabled = false;
    }
  });
})();
