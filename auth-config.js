/* Public browser configuration only.
 * Never place a Supabase service-role key or a Worker secret in this file.
 */
window.CHESTPLAYER_AUTH_CONFIG = Object.freeze({
  environment: "production",
  supabaseUrl: "https://edge.chestplayer.us",
  authOrigin: "https://edge.chestplayer.us",
  supabasePublishableKey: "sb_publishable_SUuDaSLS1gyUGS1NEYIyYg_nLB1_yxT",
  supabaseSdkUrl: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm",
  walletStatement: "Sign in to ChestPlayer.",
  canonicalOrigin: "https://chestplayer.us"
});
