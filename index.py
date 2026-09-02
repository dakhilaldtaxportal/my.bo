import asyncio
import os
import re
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import KeyboardButton, ReplyKeyboardMarkup, Message
from geopy.distance import geodesic


bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()


# FSM স্টেপ ট্র্যাক করার জন্য
class LocationSteps(StatesGroup):
  waiting_for_user_location = State()
  waiting_for_map_link = State()


# ১. /start দিলে ইউজারের কাছ থেকে কারেন্ট লোকেশন চাওয়া হবে
@dp.message(CommandStart())
async def start_cmd(message: Message, state: FSMContext):
  # লোকেশন শেয়ার করার একটি বাটন
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


# ২. ইউজার লোকেশন পাঠালে সেটি রিসিভ করে ডাটাতে সেভ করা
@dp.message(LocationSteps.waiting_for_user_location, F.location)
async def handle_user_location(message: Message, state: FSMContext):
  user_lat = message.location.latitude
  user_lon = message.location.longitude

  # ডাটাতে ইউজারের লোকেশন সেভ রাখছি
  await state.update_data(user_lat=user_lat, user_lon=user_lon)

  await message.answer(
      "✅ আপনার বর্তমান লোকেশন পাওয়া গেছে!\n\n"
      "এবার যে পিন পয়েন্টের দূরত্ব বের করতে চান, তার **Google Maps Link** টি মেসেজে পাঠান।",
      parse_mode="Markdown",
  )
  await state.set_state(LocationSteps.waiting_for_map_link)


# ৩. গুগল ম্যাপস লিংক থেকে স্থানাঙ্ক বের করে দূরত্ব হিসাব করা
@dp.message(LocationSteps.waiting_for_map_link, F.text)
async def handle_map_link(message: Message, state: FSMContext):
  link = message.text.strip()

  # গুগল ম্যাপস লিংকের ভেতরে থাকা Latitude & Longitude খুঁজে বের করার জন্য Regex
  coords_match = re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", link) or re.search(
      r"q=(-?\d+\.\d+),(-?\d+\.\d+)", link
  )

  if not coords_match:
    await message.answer(
        "❌ সঠিক Google Maps পিন পয়েন্ট লিংক পাওয়া যায়নি!\n"
        "অনুগ্রহ করে গুগল ম্যাপস থেকে সম্পূর্ণ লিংক কপি করে আবার পাঠান।"
    )
    return

  target_lat = float(coords_match.group(1))
  target_lon = float(coords_match.group(2))

  # পূর্বে সেভ করা ইউজারের লোকেশন উদ্ধার করা
  user_data = await state.get_data()
  user_coords = (user_data["user_lat"], user_data["user_lon"])
  target_coords = (target_lat, target_lon)

  # Geopy দিয়ে কারেন্ট লোকেশন ও পিন পয়েন্টের দূরত্ব হিসাব করা (Geodesic Distance)
  distance_km = geodesic(user_coords, target_coords).kilometers

  # রেজাল্ট সুন্দর করে দেখানো
  if distance_km < 1:
    distance_str = f"{int(distance_km * 1000)} মিটার"
  else:
    distance_str = f"{round(distance_km, 2)} কিলোমিটার"

  await message.answer(
      f"📍 **দূরত্ব ফলাফল:**\n\n"
      f"আপনার বর্তমান স্থান থেকে পাঠানো পিন পয়েন্টের আনুমানিক সরাসরি দূরত্ব: **{distance_str}**",
      parse_mode="Markdown",
  )

  # টেস্ট শেষ, স্টেট ক্লিয়ার করা
  await state.clear()


async def main():
  print("Location Distance Bot is running...")
  await dp.start_polling(bot)


if __name__ == "__main__":
  asyncio.run(main())
