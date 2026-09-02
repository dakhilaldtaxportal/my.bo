require("dotenv").config();

function listEnv(name) {
  return (process.env[name] || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

module.exports = {
  botToken: process.env.BOT_TOKEN,
  databaseUrl: process.env.DATABASE_URL,
  adminIds: listEnv("ADMIN_IDS").map(Number).filter(Number.isFinite),
  claimTimeoutSeconds: Number(process.env.CLAIM_TIMEOUT_SECONDS || 90),
  orderSearchRadiusKm: Number(process.env.ORDER_SEARCH_RADIUS_KM || 1),
  homeRadiusKm: Number(process.env.HOME_RADIUS_KM || 10),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 15000)
};
