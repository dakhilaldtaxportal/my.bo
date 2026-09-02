
import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()


def get_connection():
  return psycopg2.connect(os.getenv("DATABASE_URL"))


# ১. ফোনবুক টেবিল তৈরি করার ফাংশন
def init_db():
  conn = get_connection()
  cursor = conn.cursor()
  cursor.execute("""
        CREATE TABLE IF NOT EXISTS phonebook (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) UNIQUE,
            phone VARCHAR(20)
        );
    """)
  conn.commit()
  cursor.close()
  conn.close()


# ২. নতুন নাম ও নম্বর সেভ করার ফাংশন
def add_contact(name, phone):
  conn = get_connection()
  cursor = conn.cursor()
  cursor.execute(
      """
        INSERT INTO phonebook (name, phone)
        VALUES (%s, %s)
        ON CONFLICT (name) DO UPDATE SET phone = EXCLUDED.phone;
    """,
      (name.lower(), phone),
  )
  conn.commit()
  cursor.close()
  conn.close()


# ৩. নাম দিয়ে নম্বর খোঁজার ফাংশন
def get_contact(name):
  conn = get_connection()
  cursor = conn.cursor()
  cursor.execute(
      "SELECT name, phone FROM phonebook WHERE name = %s;", (name.lower(),)
  )
  result = cursor.fetchone()
  cursor.close()
  conn.close()
  return result
