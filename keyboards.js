const { Keyboard, InlineKeyboard } = require("grammy");

function contactKeyboard() {
  return new Keyboard().requestContact("📱 Share phone number").resized().oneTime();
}

function locationKeyboard() {
  return new Keyboard().requestLocation("📍 Share current location").resized().oneTime();
}

function mainKeyboard() {
  return new Keyboard()
    .text("🚴 Rider registration").row()
    .text("🟢 Online").text("⚪ Offline").row()
    .text("👤 My profile").resized();
}

function claimKeyboard(orderId) {
  return new InlineKeyboard()
    .text("✅ Accept", `order:accept:${orderId}`)
    .text("❌ Reject", `order:reject:${orderId}`);
}

function activeOrderKeyboard(orderId) {
  return new InlineKeyboard()
    .text("↩️ Swipe / Reassign", `order:swipe:${orderId}`)
    .text("📦 Pickup", `order:pickup:${orderId}`);
}

function completeKeyboard(orderId) {
  return new InlineKeyboard().text("✅ Complete", `order:complete:${orderId}`);
}

module.exports = {
  contactKeyboard, locationKeyboard, mainKeyboard,
  claimKeyboard, activeOrderKeyboard, completeKeyboard
};
