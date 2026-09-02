const { query } = require("./db");
const { distanceKm } = require("./geo");
const { orderSearchRadiusKm, homeRadiusKm } = require("./config");

function orderCode() {
  return "FD-" + Date.now().toString(36).toUpperCase() + "-" +
    Math.floor(Math.random() * 900 + 100);
}

async function ensureUser(telegramId, role = "customer") {
  const r = await query(
    `INSERT INTO users (telegram_id, role)
     VALUES ($1,$2)
     ON CONFLICT (telegram_id) DO UPDATE SET updated_at=NOW()
     RETURNING *`,
    [telegramId, role]
  );
  return r.rows[0];
}

async function getUser(telegramId) {
  const r = await query(`SELECT * FROM users WHERE telegram_id=$1`, [telegramId]);
  return r.rows[0];
}

async function logEvent(orderId, actor, event, metadata = {}) {
  await query(
    `INSERT INTO order_events(order_id,actor_telegram_id,event,metadata)
     VALUES($1,$2,$3,$4)`,
    [orderId, actor || null, event, JSON.stringify(metadata)]
  );
}

async function findEligibleRiders(order, { broadcast = false } = {}) {
  const riders = (await query(`
    SELECT * FROM users
    WHERE role='rider' AND suspended=false
      AND home_lat IS NOT NULL AND home_lng IS NOT NULL
      AND current_lat IS NOT NULL AND current_lng IS NOT NULL
      AND (
        $1::boolean = true OR (online=true AND available=true)
      )
  `, [broadcast])).rows;

  const eligible = [];
  for (const rider of riders) {
    const vendorDistance = distanceKm(order.vendor_lat, order.vendor_lng, rider.current_lat, rider.current_lng);
    if (broadcast) {
      const homeToVendor = distanceKm(rider.home_lat, rider.home_lng, order.vendor_lat, order.vendor_lng);
      if (homeToVendor <= homeRadiusKm) eligible.push({ rider, distance: vendorDistance });
      continue;
    }

    if (vendorDistance > orderSearchRadiusKm) continue;

    // For customer-app orders, both vendor and customer must fit rider's selected home radius.
    if (order.source === "mini_app") {
      const maxKm = Number(rider.delivery_radius_km || homeRadiusKm);
      const homeToVendor = distanceKm(rider.home_lat, rider.home_lng, order.vendor_lat, order.vendor_lng);
      const homeToCustomer = order.customer_lat == null ? Infinity :
        distanceKm(rider.home_lat, rider.home_lng, order.customer_lat, order.customer_lng);
      if (homeToVendor > maxKm || homeToCustomer > maxKm) continue;
    }

    eligible.push({ rider, distance: vendorDistance });
  }

  eligible.sort((a, b) => a.distance - b.distance);
  return eligible;
}

async function createOrder(data) {
  const code = orderCode();
  const r = await query(`
    INSERT INTO orders(
      order_code,vendor_id,customer_telegram_id,customer_name,customer_phone,
      customer_address,customer_lat,customer_lng,vendor_lat,vendor_lng,
      source,broadcast,details
    )
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *
  `, [
    code, data.vendorId || null, data.customerTelegramId || null,
    data.customerName || null, data.customerPhone || null,
    data.customerAddress || null, data.customerLat || null, data.customerLng || null,
    data.vendorLat, data.vendorLng, data.source || "external",
    Boolean(data.broadcast), data.details || ""
  ]);
  const order = r.rows[0];
  await logEvent(order.id, data.actorTelegramId, "ORDER_CREATED", { source: order.source, broadcast: order.broadcast });
  return order;
}

async function addClaim(orderId, riderId) {
  await query(`
    INSERT INTO order_claims(order_id,rider_id)
    VALUES($1,$2)
    ON CONFLICT(order_id,rider_id) DO UPDATE SET status='pending',sent_at=NOW()
  `, [orderId, riderId]);
}

async function acceptOrder(orderId, riderTelegramId) {
  const client = await require("./db").pool.connect();
  try {
    await client.query("BEGIN");
    const orderR = await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`, [orderId]);
    const order = orderR.rows[0];
    if (!order || order.status !== "searching") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_searching" };
    }
    const riderR = await client.query(`SELECT * FROM users WHERE telegram_id=$1 FOR UPDATE`, [riderTelegramId]);
    const rider = riderR.rows[0];
    if (!rider || rider.role !== "rider" || !rider.online || !rider.available || rider.suspended) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "rider_unavailable" };
    }
    await client.query(`
      UPDATE orders SET status='accepted',assigned_rider_id=$2,accepted_at=NOW()
      WHERE id=$1
    `, [orderId, rider.id]);
    await client.query(`UPDATE users SET available=false,updated_at=NOW() WHERE id=$1`, [rider.id]);
    await client.query(`
      UPDATE order_claims SET status='withdrawn',responded_at=NOW()
      WHERE order_id=$1 AND rider_id<>$2 AND status='pending'
    `, [orderId, rider.id]);
    await client.query(`
      UPDATE order_claims SET status='accepted',responded_at=NOW()
      WHERE order_id=$1 AND rider_id=$2
    `, [orderId, rider.id]);
    await client.query(`
      INSERT INTO order_events(order_id,actor_telegram_id,event,metadata)
      VALUES($1,$2,'ORDER_ACCEPTED',$3)
    `, [orderId, riderTelegramId, JSON.stringify({ riderId: rider.id })]);
    await client.query("COMMIT");
    return { ok: true, order, rider };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function rejectClaim(orderId, riderTelegramId) {
  const r = await query(`SELECT id FROM users WHERE telegram_id=$1`, [riderTelegramId]);
  if (!r.rows[0]) return;
  await query(`
    UPDATE order_claims SET status='rejected',responded_at=NOW()
    WHERE order_id=$1 AND rider_id=$2 AND status='pending'
  `, [orderId, r.rows[0].id]);
  await logEvent(orderId, riderTelegramId, "ORDER_REJECTED");
}

async function pickupOrder(orderId, riderTelegramId) {
  const r = await query(`
    SELECT o.*,u.telegram_id AS rider_telegram_id
    FROM orders o JOIN users u ON u.id=o.assigned_rider_id
    WHERE o.id=$1 AND o.status='accepted'
  `, [orderId]);
  const o = r.rows[0];
  if (!o || Number(o.rider_telegram_id) !== Number(riderTelegramId)) return false;
  await query(`UPDATE orders SET status='picked_up',picked_up_at=NOW() WHERE id=$1`, [orderId]);
  await logEvent(orderId, riderTelegramId, "ORDER_PICKED_UP");
  return true;
}

async function completeOrder(orderId, riderTelegramId) {
  const r = await query(`
    SELECT o.*,u.id AS rider_id,u.telegram_id AS rider_telegram_id
    FROM orders o JOIN users u ON u.id=o.assigned_rider_id
    WHERE o.id=$1 AND o.status='picked_up'
  `, [orderId]);
  const o = r.rows[0];
  if (!o || Number(o.rider_telegram_id) !== Number(riderTelegramId)) return false;
  await query(`UPDATE orders SET status='completed',completed_at=NOW() WHERE id=$1`, [orderId]);
  await query(`UPDATE users SET available=true,updated_at=NOW() WHERE id=$1`, [o.rider_id]);
  await logEvent(orderId, riderTelegramId, "ORDER_COMPLETED");
  return true;
}

async function swipeOrder(orderId, riderTelegramId) {
  const r = await query(`
    SELECT o.*,u.id AS rider_id,u.telegram_id AS rider_telegram_id
    FROM orders o JOIN users u ON u.id=o.assigned_rider_id
    WHERE o.id=$1 AND o.status='accepted'
  `, [orderId]);
  const o = r.rows[0];
  if (!o || Number(o.rider_telegram_id) !== Number(riderTelegramId)) return { ok:false };

  await query(`UPDATE users SET available=true,updated_at=NOW() WHERE id=$1`, [o.rider_id]);
  await query(`UPDATE orders SET status='searching',assigned_rider_id=NULL,accepted_at=NULL WHERE id=$1`, [orderId]);
  await query(`UPDATE order_claims SET status='withdrawn' WHERE order_id=$1 AND status='accepted'`, [orderId]);
  await logEvent(orderId, riderTelegramId, "ORDER_SWIPED");
  return { ok:true, order:o };
}

async function setOnline(telegramId, online, radiusKm) {
  await query(`
    UPDATE users SET online=$2, available=CASE WHEN $2 THEN true ELSE false END,
      delivery_radius_km=COALESCE($3,delivery_radius_km),updated_at=NOW()
    WHERE telegram_id=$1 AND role='rider'
  `, [telegramId, online, radiusKm || null]);
}

module.exports = {
  ensureUser, getUser, logEvent, findEligibleRiders, createOrder,
  addClaim, acceptOrder, rejectClaim, pickupOrder, completeOrder,
  swipeOrder, setOnline
};
