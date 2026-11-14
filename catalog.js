(() => {
  "use strict";
  const root = document.querySelector("#categoryGrid");
  if (!root) return;
  const origin = window.TRIVIA_ARENA_CONFIG?.apiOrigin || "https://edge.chestplayer.us";
  const safeName = (text) => String(text ?? "");
  const linkTo = (category) => {
    const url = new URL("dashboard.html", window.location.href);
    url.searchParams.set("view", category.mode === "box_5x5" ? "box" : "flash");
    if (category.mode !== "box_5x5") url.searchParams.set("category", category.id);
    const locale = window.TriviaI18n?.locale || "en";
    if (locale === "en") url.searchParams.delete("lang");
    else url.searchParams.set("lang", locale);
    return `${url.pathname}${url.search}`;
  };
  async function refresh() {
    const locale = window.TriviaI18n?.locale || "en";
    try {
      const res = await fetch(`${String(origin).replace(/\/$/, "")}/api/categories?locale=${encodeURIComponent(locale)}`, {
        headers: { accept: "application/json" }, cache: "no-store", credentials: "omit"
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const items = await res.json();
      if (!Array.isArray(items)) throw new Error("CATALOG_INVALID");
      const section = document.createDocumentFragment();
      items.forEach((row) => {
        if (!row || typeof row.id !== "string" || !/^[a-z0-9][a-z0-9_]{0,63}$/.test(row.id)) return;
        const card = document.createElement("a");
        card.className = "site-card catalog-card";
        card.href = linkTo(row);
        const meta = document.createElement("div"); meta.className = "site-kicker";
        meta.textContent = row.mode === "box_5x5" ? "5×5 CHESTPLAYER" : "10-10 FLASH TRIVIA";
        const title = document.createElement("h3"); title.textContent = safeName(row.name || row.id);
        const detail = document.createElement("p"); detail.textContent = `${Number(row.question_count || 0).toLocaleString(locale)} questions`;
        card.append(meta, title, detail); section.append(card);
      });
      root.replaceChildren(section);
      if (!root.childElementCount) root.textContent = "No playable categories available.";
    } catch (error) { root.textContent = `Categories temporarily unavailable (${error.message}).`; }
  }
  window.addEventListener("trivia-locale-change", () => { void refresh(); });
  void refresh();
})();
