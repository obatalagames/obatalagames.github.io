(() => {
  "use strict";
  const root = document.querySelector("#categoryGrid");
  if (!root) return;

  const origin = window.TRIVIA_ARENA_CONFIG?.apiOrigin || "https://edge.chestplayer.us";
  let requestGeneration = 0;
  const tr = (key, fallback, vars) => {
    const value = window.TriviaI18n?.t?.(key, vars);
    return value && value !== key ? value : fallback;
  };
  const locale = () => window.TriviaI18n?.locale || "en";
  const clearBusy = () => root.removeAttribute("aria-busy");

  function renderMessage(title, description, retry = false) {
    const card = document.createElement("div");
    card.className = "empty-prompt catalog-state";
    const heading = document.createElement("strong");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = description;
    card.append(heading, copy);
    if (retry) {
      const button = document.createElement("button");
      button.className = "small-outline";
      button.type = "button";
      button.dataset.categoryRetry = "true";
      button.textContent = tr("categories.retry", "Try again");
      card.append(button);
    }
    root.replaceChildren(card);
  }

  function linkTo(category) {
    const url = new URL("dashboard.html", window.location.href);
    url.searchParams.set("view", category.mode === "box_5x5" ? "box" : "flash");
    if (category.mode !== "box_5x5") url.searchParams.set("category", category.id);
    if (locale() === "en") url.searchParams.delete("lang");
    else url.searchParams.set("lang", locale());
    return `${url.pathname}${url.search}`;
  }

  async function refresh() {
    const generation = ++requestGeneration;
    const requestedLocale = locale();
    root.setAttribute("aria-busy", "true");
    renderMessage(tr("categories.loading", "Loading categories…"), "");
    try {
      const response = await fetch(`${String(origin).replace(/\/$/, "")}/api/categories?locale=${encodeURIComponent(requestedLocale)}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
        credentials: "omit",
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const items = await response.json();
      if (generation !== requestGeneration) return;
      if (!Array.isArray(items)) throw new Error("CATALOG_INVALID");

      const section = document.createDocumentFragment();
      for (const row of items) {
        if (!row || typeof row.id !== "string" || !/^[a-z0-9][a-z0-9_]{0,63}$/.test(row.id)) continue;
        const card = document.createElement("a");
        card.className = "site-card catalog-card";
        card.href = linkTo(row);
        const meta = document.createElement("div");
        meta.className = "site-kicker";
        meta.textContent = row.mode === "box_5x5" ? "5×5 CHESTPLAYER" : tr("nav.flash", "10-10 FLASH TRIVIA");
        const title = document.createElement("h3");
        title.textContent = tr(`category.${row.id}`, String(row.name || row.id));
        const detail = document.createElement("p");
        const count = Number(row.question_count || 0);
        detail.textContent = tr("categories.questions", `${count.toLocaleString(requestedLocale)} questions`, { count: count.toLocaleString(requestedLocale) });
        card.append(meta, title, detail);
        section.append(card);
      }
      clearBusy();
      if (!section.childElementCount) renderMessage(tr("categories.none", "No playable categories are available right now."), "");
      else root.replaceChildren(section);
    } catch (_) {
      if (generation !== requestGeneration) return;
      clearBusy();
      renderMessage(
        tr("categories.unavailable", "Categories are temporarily unavailable."),
        tr("error.tryAgain", "Please check your connection and retry."),
        true,
      );
    }
  }

  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-category-retry]")) void refresh();
  });
  window.addEventListener("trivia-locale-change", () => { void refresh(); });
  void refresh();
})();
