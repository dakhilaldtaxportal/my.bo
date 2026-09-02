const { Pool } = require("pg");
const { databaseUrl } = require("./config");

if (!databaseUrl) throw new Error("DATABASE_URL is missing");

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      name TEXT,
      phone TEXT,
      home_address TEXT,
      home_lat DOUBLE PRECISION,
      home_lng DOUBLE PRECISION,
      current_lat DOUBLE PRECISION,
      current_lng DOUBLE PRECISION,
      online BOOLEAN NOT NULL DEFAULT FALSE,
      available BOOLEAN NOT NULL DEFAULT TRUE,
      delivery_radius_km DOUBLE PRECISION NOT NULL DEFAULT 10,
      suspended BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      order_code TEXT UNIQUE NOT NULL,
      vendor_id BIGINT REFERENCES vendors(id) ON DELETE SET NULL,
      customer_telegram_id BIGINT,
      customer_name TEXT,
      customer_phone TEXT,
      customer_address TEXT,
      customer_lat DOUBLE PRECISION,
      customer_lng DOUBLE PRECISION,
      vendor_lat DOUBLE PRECISION NOT NULL,
      vendor_lng DOUBLE PRECISION NOT NULL,
      source TEXT NOT NULL DEFAULT 'external',
      broadcast BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'searching',
      assigned_rider_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accepted_at TIMESTAMPTZ,
      picked_up_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS order_claims (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      rider_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at TIMESTAMPTZ,
      UNIQUE(order_id, rider_id)
    );

    CREATE TABLE IF NOT EXISTS order_events (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      actor_telegram_id BIGINT,
      event TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_users_online ON users(online, available);
    CREATE INDEX IF NOT EXISTS idx_claims_pending ON order_claims(order_id, status);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  `);
}

module.exports = { query, initDb, pool };
