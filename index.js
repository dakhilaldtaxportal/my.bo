const { Bot, session } = require("grammy");
const { botToken, adminIds, claimTimeoutSeconds, pollIntervalMs } = require("./config");
const { initDb, query } = require("./db");
const S = require("./services");
const K = require("./keyboards");

if (!botToken) throw new Error("BOT_TOKEN is missing");

const bot = new Bot(botToken);

bot.use(session({
  initial: () => ({ flow: null, data: {} })
}));

function isAdmin(id) { return adminIds.includes(Number(id)); }

async function sendOrderClaim(ctx, order, rider) {
  const text =
    `🚚 Delivery request #${order.order_code}\n\n` +
    `Vendor: ${order.vendor_id ? "#" + order.vendor_id : "External vendor"}\n` +
    `Details: ${order.details || "No details"}\n` +
    (order.customer_name ? `Customer: ${order.customer_name}\n` : "") +
    (order.customer_phone ? `Phone: ${order.customer_phone}\n` : "") +
    (order.customer_address ? `Address: ${order.customer_address}\n` : "") +
    `\nAccept within ${claimTimeoutSeconds}s.`;
  return ctx.api.sendMessage(rider.telegram_id, text, { reply_markup: K.claimKeyboard(order.id) });
}

async function dispatchOrder(order) {
  const eligible = await S.findEligibleRiders(order, { broadcast: order.broadcast });

  if (!eligible.length) {
    await S.logEvent(order.id, null, "NO_ELIGIBLE_RIDER");
    return 0;
  }

  // Broadcast: notify every matching rider, including offline riders.
  if (order.broadcast) {
    for (const e of eligible) {
      await S.addClaim(order.id, e.rider.id);
      try { await sendOrderClaim({ api: bot.api }, order, e.rider); } catch {}
    }
    return eligible.length;
  }

  // Normal mode: admin can switch this to all by setting dispatch_mode in future.
  // Current MVP uses nearest rider first; if rejected/expired, next eligible rider is tried.
  const e = eligible[0];
  await S.addClaim(order.id, e.rider.id);
  try {
    await bot.api.sendMessage(
      e.rider.telegram_id,
      `🚚 New delivery request #${order.order_code}\n\n` +
      `Details: ${order.details || "No details"}\n` +
      (order.customer_name ? `Customer: ${order.customer_name}\n` : "") +
      (order.customer_phone ? `Phone: ${order.customer_phone}\n` : "") +
      (order.customer_address ? `Address: ${order.customer_address}\n` : "") +
      `\nYou have ${claimTimeoutSeconds}s to respond.`,
      { reply_markup: K.claimKeyboard(order.id) }
    );
  } catch {}
  return 1;
}

async function redispatch(orderId) {
  const r = await query(`SELECT * FROM orders WHERE id=$1`, [orderId]);
  const order = r.rows[0];
  if (!order || order.status !== "searching") return;

  const claimed = (await query(`SELECT rider_id FROM order_claims WHERE order_id=$1 AND status IN ('rejected','withdrawn')`, [orderId])).rows;
  const excluded = new Set(claimed.map(x => Number(x.rider_id)));
  const eligible = (await S.findEligibleRiders(order, { broadcast: false }))
    .filter(x => !excluded.has(Number(x.rider.id)));

  if (!eligible.length) return;
  const e = eligible[0];
  await S.addClaim(order.id, e.rider.id);
  try {
    await bot.api.sendMessage(e.rider.telegram_id,
      `🚚 Delivery request #${order.order_code}\n\n${order.details || ""}\n\nRespond within ${claimTimeoutSeconds}s.`,
      { reply_markup: K.claimKeyboard(order.id) });
  } catch {}
}

bot.command("start", async ctx => {
  await S.ensureUser(ctx.from.id, "customer");
  await ctx.reply(
    `Welcome to the Food Delivery Bot.\n\n` +
    `You are registered as a customer by default.\n` +
    `Rider registration: /registration_for_rider\n` +
    `Rider online: /online\n` +
    `Vendor/admin commands are role restricted.`,
    { reply_markup: K.mainKeyboard() }
  );
});

bot.command("help", ctx => ctx.reply(
  `/start\n/registration_for_rider\n/online\n/offline\n/my_profile\n\n` +
  `Vendor: /order, /broadcast_order\nAdmin: /add_vendor, /vendors, /riders, /orders`
));

bot.hears("🚴 Rider registration", ctx => ctx.api.sendMessage(ctx.from.id, "Use /registration_for_rider"));

bot.command("registration_for_rider", async ctx => {
  const u = await S.ensureUser(ctx.from.id, "rider");
  ctx.session.flow = "rider_phone";
  ctx.session.data = {};
  await ctx.reply("Rider registration শুরু হচ্ছে। প্রথমে আপনার Telegram phone number share করুন.", {
    reply_markup: K.contactKeyboard()
  });
});

bot.on("message:contact", async ctx => {
  if (ctx.session.flow !== "rider_phone") return;
  const c = ctx.message.contact;
  if (Number(c.user_id) !== Number(ctx.from.id)) return ctx.reply("নিজের Telegram contact share করুন.");
  ctx.session.data.phone = c.phone_number;
  ctx.session.flow = "rider_name";
  await ctx.reply("আপনার নাম লিখুন.", { reply_markup: { remove_keyboard: true } });
});

bot.on("message:text", async ctx => {
  if (ctx.session.flow === "rider_name") {
    ctx.session.data.name = ctx.message.text.trim();
    ctx.session.flow = "rider_address";
    return ctx.reply("Home address লিখুন, তারপর current/home location share করুন.", { reply_markup: K.locationKeyboard() });
  }

  if (ctx.session.flow === "rider_address") {
    ctx.session.data.address = ctx.message.text.trim();
    return ctx.reply("এখন আপনার home/current location share করুন.", { reply_markup: K.locationKeyboard() });
  }

  if (ctx.session.flow === "radius") {
    const n = Number(ctx.message.text.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n <= 0 || n > 100) return ctx.reply("1 থেকে 100 km এর মধ্যে একটি সংখ্যা দিন.");
    await S.setOnline(ctx.from.id, true, n);
    ctx.session.flow = null;
    return ctx.reply(`আপনি ONLINE. আপনার delivery range ${n} km.`);
  }
});

bot.on("message:location", async ctx => {
  const loc = ctx.message.location;
  if (ctx.session.flow === "rider_address") {
    const d = ctx.session.data;
    await query(`
      INSERT INTO users(telegram_id,role,name,phone,home_address,home_lat,home_lng,current_lat,current_lng)
      VALUES($1,'rider',$2,$3,$4,$5,$6,$5,$6)
      ON CONFLICT(telegram_id) DO UPDATE SET role='rider',name=$2,phone=$3,home_address=$4,
        home_lat=$5,home_lng=$6,current_lat=$5,current_lng=$6,updated_at=NOW()
    `, [ctx.from.id,d.name,d.phone,d.address,loc.latitude,loc.longitude]);
    ctx.session.flow = null;
    return ctx.reply("✅ Rider registration complete. আপনার home location permanent save হয়েছে। পরে edit করা যাবে.", { reply_markup: K.mainKeyboard() });
  }
  if (ctx.session.flow === "current_location") {
    await query(`UPDATE users SET current_lat=$2,current_lng=$3,updated_at=NOW() WHERE telegram_id=$1`, [ctx.from.id,loc.latitude,loc.longitude]);
    ctx.session.flow = null;
    return ctx.reply("✅ Current location updated.");
  }
});

bot.command("online", async ctx => {
  const u = await S.getUser(ctx.from.id);
  if (!u || u.role !== "rider") return ctx.reply("আপনি rider হিসেবে registered নন.");
  ctx.session.flow = "radius";
  await ctx.reply("Online হওয়ার সময় আপনি home location থেকে সর্বোচ্চ কত km delivery নিতে চান? যেমন: 10");
});

bot.command("offline", async ctx => {
  const u = await S.getUser(ctx.from.id);
  if (!u || u.role !== "rider") return ctx.reply("আপনি rider হিসেবে registered নন.");
  await S.setOnline(ctx.from.id, false);
  await ctx.reply("⚪ আপনি OFFLINE.");
});

bot.command("my_profile", async ctx => {
  const u = await S.getUser(ctx.from.id);
  if (!u) return ctx.reply("Profile নেই. /start দিন.");
  await ctx.reply(
    `Role: ${u.role}\nName: ${u.name || "-"}\nPhone: ${u.phone || "-"}\n` +
    `Home: ${u.home_address || "-"}\nOnline: ${u.online ? "YES" : "NO"}\n` +
    `Available: ${u.available ? "YES" : "NO"}\nRange: ${u.delivery_radius_km} km`
  );
});

async function requireVendor(ctx) {
  const v = await query(`SELECT * FROM vendors WHERE telegram_id=$1 AND active=true`, [ctx.from.id]);
  return v.rows[0];
}

async function createVendorOrder(ctx, broadcast = false) {
  const v = await requireVendor(ctx);
  if (!v) return ctx.reply("আপনি registered vendor নন.");

  ctx.session.flow = broadcast ? "broadcast_order" : "vendor_order";
  ctx.session.data = { vendor: v, broadcast };
  await ctx.reply(
    `Order details এক মেসেজে লিখুন.\n` +
    `Customer name/phone/address থাকলে সেটাও দিন.\n\n` +
    `Example: Chicken biryani x2, cash on delivery`
  );
}

bot.command("order", ctx => createVendorOrder(ctx, false));
bot.command("broadcast_order", ctx => createVendorOrder(ctx, true));

bot.on("message:text", async ctx => {
  if (!["vendor_order","broadcast_order"].includes(ctx.session.flow)) return;
  const d = ctx.session.data;
  const order = await S.createOrder({
    vendorId: d.vendor.id,
    vendorLat: d.vendor.lat,
    vendorLng: d.vendor.lng,
    source: "external",
    broadcast: d.broadcast,
    details: ctx.message.text,
    actorTelegramId: ctx.from.id
  });
  ctx.session.flow = null;
  const n = await dispatchOrder(order);
  await ctx.reply(`✅ Order ${order.order_code} posted. ${n} rider(s) notified.`);
});

bot.command("add_vendor", async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("Admin only.");
  ctx.session.flow = "admin_vendor_name";
  ctx.session.data = {};
  await ctx.reply("Vendor name লিখুন.");
});

bot.command("vendors", async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("Admin only.");
  const rows = (await query(`SELECT * FROM vendors ORDER BY id DESC LIMIT 100`)).rows;
  if (!rows.length) return ctx.reply("No vendors.");
  await ctx.reply(rows.map(v => `#${v.id} ${v.name} | TG:${v.telegram_id} | ${v.active ? "ACTIVE":"OFF"}`).join("\n"));
});

bot.command("riders", async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("Admin only.");
  const rows = (await query(`SELECT * FROM users WHERE role='rider' ORDER BY id DESC LIMIT 100`)).rows;
  if (!rows.length) return ctx.reply("No riders.");
  await ctx.reply(rows.map(r => `#${r.id} ${r.name || "-"} | TG:${r.telegram_id} | ${r.online ? "ONLINE":"OFFLINE"} | ${r.available ? "AVAILABLE":"BUSY"}`).join("\n"));
});

bot.command("orders", async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("Admin only.");
  const rows = (await query(`SELECT * FROM orders ORDER BY id DESC LIMIT 100`)).rows;
  if (!rows.length) return ctx.reply("No orders.");
  await ctx.reply(rows.map(o => `#${o.order_code} | ${o.status} | rider:${o.assigned_rider_id || "-"} | created:${o.created_at.toISOString()}`).join("\n"));
});

bot.on("message:text", async ctx => {
  if (ctx.session.flow === "admin_vendor_name" && isAdmin(ctx.from.id)) {
    ctx.session.data.name = ctx.message.text.trim();
    ctx.session.flow = "admin_vendor_phone";
    return ctx.reply("Vendor phone number লিখুন.");
  }
  if (ctx.session.flow === "admin_vendor_phone" && isAdmin(ctx.from.id)) {
    ctx.session.data.phone = ctx.message.text.trim();
    ctx.session.flow = "admin_vendor_tg";
    return ctx.reply("Vendor Telegram ID লিখুন.");
  }
  if (ctx.session.flow === "admin_vendor_tg" && isAdmin(ctx.from.id)) {
    const id = Number(ctx.message.text.trim());
    if (!Number.isFinite(id)) return ctx.reply("Valid Telegram ID দিন.");
    ctx.session.data.telegramId = id;
    ctx.session.flow = "admin_vendor_location";
    return ctx.reply("Vendor current/fixed location share করুন.", { reply_markup: K.locationKeyboard() });
  }
});

bot.on("message:location", async ctx => {
  if (ctx.session.flow !== "admin_vendor_location" || !isAdmin(ctx.from.id)) return;
  const d = ctx.session.data;
  await query(`
    INSERT INTO vendors(telegram_id,name,phone,address,lat,lng)
    VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(telegram_id) DO UPDATE SET name=$2,phone=$3,lat=$5,lng=$6,active=true
  `, [d.telegramId,d.name,d.phone,"",ctx.message.location.latitude,ctx.message.location.longitude]);
  ctx.session.flow = null;
  await ctx.reply("✅ Vendor added. Vendor location fixed/save হয়েছে.");
});

bot.callbackQuery(/^order:(accept|reject|swipe|pickup|complete):(\d+)$/, async ctx => {
  const action = ctx.match[1];
  const orderId = Number(ctx.match[2]);

  if (action === "accept") {
    const result = await S.acceptOrder(orderId, ctx.from.id);
    if (!result.ok) return ctx.answerCallbackQuery({ text: "Order আর available নেই.", show_alert: true });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply(`✅ Order #${result.order.order_code} accepted. Vendor-এর দিকে যান.`, { reply_markup: K.activeOrderKeyboard(orderId) });
    await ctx.answerCallbackQuery("Accepted");
    return;
  }

  if (action === "reject") {
    await S.rejectClaim(orderId, ctx.from.id);
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.answerCallbackQuery("Rejected");
    return redispatch(orderId);
  }

  if (action === "swipe") {
    const r = await S.swipeOrder(orderId, ctx.from.id);
    if (!r.ok) return ctx.answerCallbackQuery({ text: "আপনি এই order-এর rider নন.", show_alert: true });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply("↩️ Order reassigned/searching again.");
    await ctx.answerCallbackQuery("Reassigned");
    return redispatch(orderId);
  }

  if (action === "pickup") {
    const ok = await S.pickupOrder(orderId, ctx.from.id);
    if (!ok) return ctx.answerCallbackQuery({ text: "Pickup not allowed.", show_alert: true });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply("📦 Pickup recorded.", { reply_markup: K.completeKeyboard(orderId) });
    return ctx.answerCallbackQuery("Picked up");
  }

  if (action === "complete") {
    const ok = await S.completeOrder(orderId, ctx.from.id);
    if (!ok) return ctx.answerCallbackQuery({ text: "Complete not allowed.", show_alert: true });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply("✅ Delivery completed. You are available for new orders.");
    return ctx.answerCallbackQuery("Completed");
  }
});

setInterval(async () => {
  try {
    const expired = (await query(`
      SELECT c.order_id,c.rider_id,o.order_code
      FROM order_claims c JOIN orders o ON o.id=c.order_id
      WHERE c.status='pending'
        AND c.sent_at < NOW() - ($1 * INTERVAL '1 second')
        AND o.status='searching'
    `, [claimTimeoutSeconds])).rows;

    for (const c of expired) {
      await query(`UPDATE order_claims SET status='expired',responded_at=NOW() WHERE order_id=$1 AND rider_id=$2 AND status='pending'`, [c.order_id,c.rider_id]);
      try { await bot.api.deleteMessage(Number((await query(`SELECT telegram_id FROM users WHERE id=$1`, [c.rider_id])).rows[0].telegram_id), Number(c.order_id)); } catch {}
      await redispatch(c.order_id);
    }
  } catch (e) {
    console.error("dispatcher timer:", e.message);
  }
}, pollIntervalMs);

(async () => {
  await initDb();
  console.log("Database ready");
  await bot.start();
})();

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
