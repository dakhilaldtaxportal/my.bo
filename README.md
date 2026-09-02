# Telegram Food Delivery Bot

This is a backend-first MVP/starter for the requested Telegram food-delivery workflow.

## Stack
- Node.js 20+
- grammY
- PostgreSQL
- PostgreSQL earth-distance extension is NOT required; distance is calculated in SQL with the haversine formula.

## Setup
1. Create a PostgreSQL database.
2. Copy `.env.example` to `.env`.
3. Put the Telegram bot token, database URL and admin Telegram IDs in `.env`.
4. Run:
   ```bash
   npm install
   npm start
   ```

## Important Telegram limitation
A bot cannot silently obtain a user's phone number or live location. The user must explicitly press the Telegram contact/location sharing buttons. This project asks for contact sharing during rider registration and location sharing when needed.

## Roles
- Customer: default role when entering the bot.
- Rider: self-registration with `/registration_for_rider`.
- Vendor: created by admin with `/add_vendor`.
- Admin: listed in `ADMIN_IDS`.

## Core workflow implemented
- Rider registration: contact -> name -> home location.
- Rider online/offline.
- Rider chooses delivery radius when going online.
- Vendor order posting with `/order`.
- Normal orders: rider must be online, available, within 1 km of vendor, and vendor/customer must be within rider's selected home-radius for customer-app style orders.
- Non-mini-app/vendor-platform orders can use `external` mode and do not apply the home-radius customer condition.
- Broadcast orders can target riders/vendors according to the requested home-radius rule; broadcast can include offline riders.
- Accept/reject.
- First acceptance wins; other pending claims are withdrawn.
- Swipe/reassign after acceptance.
- Pickup and complete.
- Rider is unavailable from the time they accept until completion.
- Order events are stored with timestamps for admin auditing.
- Basic vendor management.
- Admin order/rider/vendor views.

## Commands
### Everyone
`/start`, `/help`, `/registration_for_rider`, `/online`, `/offline`, `/my_profile`

### Vendor
`/order`
`/broadcast_order`

### Admin
`/add_vendor`
`/vendors`
`/riders`
`/orders`

## Production hardening still recommended
- Telegram Mini App/customer ordering is intentionally excluded from this package.
- Add authentication/authorization middleware and admin action confirmations.
- Add PostGIS if scale grows substantially.
- Add a queue (Redis/BullMQ) for high-volume order dispatch.
- Add delivery cancellation/reason codes, rider penalties, vendor confirmation, customer notifications, fraud/rate limits, backups and monitoring.
