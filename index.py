import asyncio
import os
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import Message
from aiohttp import web
from dotenv import load_dotenv

from db import add_contact, get_contact, init_db

load_dotenv()

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()


# Render-এর হেলথ চেকের জন্য ডামি ওয়েব সার্ভার
async def handle(request):
  return web.Response(text="Phonebook Bot is Running Successfully!")


@dp.message(CommandStart())
async def start_cmd(message: Message):
  await message.answer(
      "👋 **ফোনবুক বটে স্বাগতম!**\n\n"
      "১. নম্বর সেভ করতে এভাবে লিখুন:\n`add Rahim 01700000000`\n\n"
      "২. নম্বর খুঁজতে শুধু নাম লিখে পাঠালুন (যেমন: `Rahim`)",
      parse_mode="Markdown",
  )


@dp.message(F.text.startswith("add "))
async def save_contact_handler(message: Message):
  try:
    parts = message.text.split(" ")
    name = parts[1]
    phone = parts[2]

    add_contact(name, phone)
    await message.answer(
        f"✅ **সফলভাবে সেভ হয়েছে!**\n\n**নাম:** {name}\n**নম্বর:** {phone}",
        parse_mode="Markdown",
    )
  except IndexError:
    await message.answer(
        "❌ **ফরম্যাট ভুল হয়েছে!**\nএভাবে লিখুন: `add Rahim 01700000000`",
        parse_mode="Markdown",
    )


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


async def main():
  # ১. ডাটাবেজ টেবিল তৈরি
  init_db()

  # ২. Render Web Service-এর জন্য ব্যাকগ্রাউন্ড পোর্ট চালু করা
  app = web.Application()
  app.router.add_get("/", handle)
  runner = web.AppRunner(app)
  await runner.setup()
  port = int(os.environ.get("PORT", 8080))
  site = web.TCPSite(runner, "0.0.0.0", port)
  await site.start()

  # ৩. টেলিগ্রাম বট স্টার্ট করা
  print("Phonebook Bot is running...")
  await dp.start_polling(bot)


if __name__ == "__main__":
  asyncio.run(main())
