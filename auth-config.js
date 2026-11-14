/* Public browser configuration only. Never put a Supabase service-role key here. */
window.TRIVIA_ARENA_CONFIG = Object.freeze({
  // This is the production build. The Worker origin is intentionally the last
  // deployment-specific value: do not guess it or point money actions at a
  // static host.
  environment: "production",
  demoMode: false,
  // Every browser request enters through the single edge gateway. The real
  // Supabase URL remains server-side in the edge Worker.
  supabaseUrl: "https://edge.chestplayer.us",
  supabasePublishableKey: "sb_publishable_SUuDaSLS1gyUGS1NEYIyYg_nLB1_yxT",
  supabaseSdkUrl: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm",
  apiOrigin: "https://edge.chestplayer.us",
  authOrigin: "https://edge.chestplayer.us",
  gameOrigin: "https://edge.chestplayer.us",
  antiCheatOrigin: "https://edge.chestplayer.us",
  walletStatement: "I accept the ChestPlayer rules at https://chestplayer.us/faq.",
});

window.CHESTPLAYER_AUTH_CONFIG = Object.freeze({
  environment: window.TRIVIA_ARENA_CONFIG.environment,
  supabaseUrl: window.TRIVIA_ARENA_CONFIG.supabaseUrl,
  authOrigin: window.TRIVIA_ARENA_CONFIG.authOrigin,
  apiOrigin: window.TRIVIA_ARENA_CONFIG.apiOrigin,
  gameOrigin: window.TRIVIA_ARENA_CONFIG.gameOrigin,
  antiCheatOrigin: window.TRIVIA_ARENA_CONFIG.antiCheatOrigin,
  supabasePublishableKey: window.TRIVIA_ARENA_CONFIG.supabasePublishableKey,
  supabaseSdkUrl: window.TRIVIA_ARENA_CONFIG.supabaseSdkUrl,
  walletStatement: "Sign in to ChestPlayer.",
  canonicalOrigin: "https://chestplayer.us",
});
