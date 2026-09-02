import asyncio
import os
import re
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import KeyboardButton, ReplyKeyboardMarkup, Message
import aiohttp
from geopy.distance import geodesic


bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()


class LocationSteps(StatesGroup):
  waiting_for_user_location = State()
  waiting_for_map_link = State()


# শর্ট লিংক থেকে আসল গুগল ম্যাপস লিংক বের করার ফাংশন
async def unshorten_url(url):
  async with aiohttp.ClientSession() as session:
    try:
      async with session.get(url, allow_redirects=True) as response:
        return str(response.url)
    except Exception:
      return url


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
      "প্রথমেই আপনার লাইভ বা কারেন্ট লোকেশনটি পাঠান:",
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
      "✅ আপনার বর্তমান লোকেশন পাওয়া গেছে!\n\n"
      "এবার যে পিন পয়েন্টের দূরত্ব বের করতে চান, তার **Google Maps Link** টি পাঠান।",
      parse_mode="Markdown",
  )
  await state.set_state(LocationSteps.waiting_for_map_link)


@dp.message(LocationSteps.waiting_for_map_link, F.text)
async def handle_map_link(message: Message, state: FSMContext):
  raw_link = message.text.strip()

  # যদি maps.app.goo.gl এর মতো শর্ট লিংক হয় তবে সেটিকে আসল লিংকে কনভার্ট করবে
  if "maps.app.goo.gl" in raw_link or "goo.gl" in raw_link:
    link = await unshorten_url(raw_link)
  else:
    link = raw_link

  # গুগল ম্যাপসের লিংক থেকে Coordinate বের করা
  coords_match = (
      re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", link)
      or re.search(r"q=(-?\d+\.\d+),(-?\d+\.\d+)", link)
      or re.search(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", link)
  )

  if not coords_match:
    await message.answer(
        "❌ লিংকটি থেকে সঠিক লোকেশন বের করা যায়নি!\n"
        "অনুগ্রহ করে লিংকটি না পাঠিয়ে গুগল ম্যাপসে পিন চেপে ধরে যে সংখ্যা দুটি (যেমন: `22.3569, 91.7832`) দেখায়, তা লিখে পাঠান।"
    )
    return

  target_lat = float(coords_match.group(1))
  target_lon = float(coords_match.group(2))

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
      f"আপনার বর্তমান স্থান থেকে পাঠানো পিন পয়েন্টের সরাসরি দূরত্ব: **{distance_str}**",
      parse_mode="Markdown",
  )

  await state.clear()


async def main():
  print("Location Distance Bot is running...")
  await dp.start_polling(bot)


if __name__ == "__main__":
  asyncio.run(main())
