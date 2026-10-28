(() => {
  "use strict";

  function normalizeAnswer(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function answerMatches(answer, question) {
    const normalized = normalizeAnswer(answer);
    if (!normalized) return false;
    return [question.answer, ...(question.aliases || [])]
      .some((alias) => normalizeAnswer(alias) === normalized);
  }

  window.TriviaAnswerPolicy = { normalizeAnswer, answerMatches };
})();
