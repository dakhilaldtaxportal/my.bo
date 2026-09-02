
import asyncio
import os
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import Message
from dotenv import load_dotenv

# db.py থেকে ফাংশনগুলো আনা হচ্ছে
from db import add_contact, get_contact, init_db

load_dotenv()

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()


# /start দিলে যে উত্তর দেবে
@dp.message(CommandStart())
async def start_cmd(message: Message):
  await message.answer(
      "👋 ফোনবুক বটে স্বাগতম!\n\n"
      "১. নম্বর সেভ করতে এভাবে লিখুন:\n`add Rahim 01700000000`\n\n"
      "২. নম্বর খুঁজতে শুধু নামটা লিখে মেসেজ দিন (যেমন: `Rahim`)",
      parse_mode="Markdown",
  )


# নম্বর সেভ করার মেসেজ হ্যান্ডলার (add নাম নম্বর)
@dp.message(F.text.startswith("add "))
async def save_contact_handler(message: Message):
  try:
    # মেসেজ থেকে শব্দগুলো আলাদা করা
    parts = message.text.split(" ")
    name = parts[1]
    phone = parts[2]

    # ডাটাবেজে সেভ করা
    add_contact(name, phone)
    await message.answer(
      f"✅ সফলভাবে সেভ হয়েছে!\n**নাম:** {name}\n**নম্বর:** {phone}",
        parse_mode="Markdown",
    )
  except IndexingError:
    await message.answer(
        "❌ ফরম্যাট ভুল হয়েছে! এভাবে লিখুন:\n`add Rahim 01700000000`",
        parse_mode="Markdown",
    )


# নাম দিয়ে নম্বর খোঁজার মেসেজ হ্যান্ডলার
@dp.message()
async def search_contact_handler(message: Message):
  search_name = message.text.strip()
  result = get_contact(search_name)

  if result:
    name, phone = result
    await message.answer(
        f"📞 **খুঁজে পাওয়া গেছে!**\n\n**নাম:** {name.capitalize()}\n**নম্বর:** {phone}",
        parse_mode="Markdown",
    )
  else:
    await message.answer(
        f"❌ '{search_name}' নামে কোনো নম্বর পাওয়া যায়নি।", parse_mode="Markdown"
    )


# বট চালু করার মেইন ফাংশন
async def main():
  init_db()  # ডাটাবেজ টেবিল তৈরি করবে
  print("Phonebook Bot is running...")
  await dp.start_polling(bot)


if __name__ == "__main__":
  asyncio.run(main())
