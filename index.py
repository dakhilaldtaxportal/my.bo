import asyncio
import os
import re
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import KeyboardButton, Message, ReplyKeyboardMarkup
import aiohttp
from aiohttp import web
from geopy.distance import geodesic

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()


class LocationSteps(StatesGroup):
  waiting_for_user_location = State()
  waiting_for_map_link = State()


# Render Web Service-এর পোর্ট ওপেন রাখার জন্য ডামি হ্যান্ডলার
async def handle_ping(request):
  return web.Response(text="Location Bot is Running Live!")


async def extract_coordinates(text):
  coord_match = re.search(r"(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)", text)
  if coord_match and not text.startswith("http"):
    return float(coord_match.group(1)), float(coord_match.group(2))

  headers = {
      "User-Agent": (
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      )
  }

  target_url = text
  if "http" in text:
    async with aiohttp.ClientSession(headers=headers) as session:
      try:
        async with session.get(text, allow_redirects=True) as response:
          target_url = str(response.url)
      except Exception:
        target_url = text

  patterns = [
      r"@(-?\d+\.\d+),(-?\d+\.\d+)",
      r"q=(-?\d+\.\d+),(-?\d+\.\d+)",
      r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)",
      r"ll=(-?\d+\.\d+),(-?\d+\.\d+)",
  ]

  for pattern in patterns:
    match = re.search(pattern, target_url)
    if match:
      return float(match.group(1)), float(match.group(2))

  return None, None


@dp.message(CommandStart())
async def start_cmd(message: Message, state: FSMContext):
  kb = ReplyKeyboardMarkup(
      keyboard=[[
          KeyboardButton(text="📍 Send Current Location", request_location=True)
      ]],
      resize_keyboard=True,
      one_time_keyboard=True,
  )

  await message.answer(
      "👋 **দূরত্ব মাপার বটে স্বাগতম!**\n\n"
      "প্রথমেই নিচের বাটন চেপে আপনার **Current Location** পাঠান:",
      reply_markup=kb,
      parse_mode="Markdown",
  )
  await state.set_state(LocationSteps.waiting_for_user_location)


@dp.message(LocationSteps.waiting_for_user_location, F.location)
async def handle_user_location(message: Message, state: FSMContext):
  user_lat = message.location.latitude
  user_lon = message.location.longitude

  await state.update_data(user_lat=user_lat, user_lon=user_lon)

  await message.answer(
      "✅ আপনার বর্তমান লোকেশন সেভ হয়েছে!\n\n"
      "এবার যে পিন পয়েন্টের দূরত্ব মাপতে চান, তার **Google Maps Link** অথবা **Coordinates (যেমন: 22.3569, 91.7832)** পাঠান।",
      parse_mode="Markdown",
  )
  await state.set_state(LocationSteps.waiting_for_map_link)


@dp.message(LocationSteps.waiting_for_map_link)
async def handle_map_link(message: Message, state: FSMContext):
  text_input = message.text.strip() if message.text else ""

  target_lat, target_lon = await extract_coordinates(text_input)

  if target_lat is None or target_lon is None:
    await message.answer(
        "❌ **সঠিক লোকেশন পাওয়া যায়নি!**\n\n"
        "গুগল ম্যাপস থেকে পিনে ট্যাপ করলে নিচে যে **সংখ্যা দুটি (যেমন: 22.3569, 91.7832)** দেখায়, তা কপি করে লিখে পাঠাতে পারেন।",
        parse_mode="Markdown",
    )
    return

  user_data = await state.get_data()
  user_coords = (user_data["user_lat"], user_data["user_lon"])
  target_coords = (target_lat, target_lon)

  distance_km = geodesic(user_coords, target_coords).kilometers

  if distance_km < 1:
    distance_str = f"{int(distance_km * 1000)} মিটার"
  else:
    distance_str = f"{round(distance_km, 2)} কিলোমিটার"

  await message.answer(
      f"📍 **দূরত্ব ফলাফল:**\n\n"
      f"আপনার বর্তমান অবস্থান থেকে গন্তব্যের দূরত্ব: **{distance_str}**",
      parse_mode="Markdown",
  )

  await state.clear()


async def main():
  # Render-এর পোর্টের জন্য HTTP Dummy Server চালু করা
  app = web.Application()
  app.router.add_get("/", handle_ping)
  runner = web.AppRunner(app)
  await runner.setup()
  port = int(os.environ.get("PORT", 8080))
  site = web.TCPSite(runner, "0.0.0.0", port)
  await site.start()

  # টেলিগ্রাম বট পলিং স্টার্ট
  print("Location Distance Bot is running...")
  await dp.start_polling(bot)


if __name__ == "__main__":
  asyncio.run(main())
