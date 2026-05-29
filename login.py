"""One-time login script. Run this once to save cookies, then start app.py."""
import asyncio
import os
from dotenv import load_dotenv
from twikit import Client

load_dotenv()

async def login():
    client = Client('en-US')
    print('Logging in to Twitter...')
    await client.login(
        auth_info_1=os.getenv('TWITTER_USERNAME'),
        auth_info_2=os.getenv('TWITTER_EMAIL'),
        password=os.getenv('TWITTER_PASSWORD'),
    )
    client.save_cookies('cookies.json')
    print('Login successful! Cookies saved to cookies.json')
    print("You can now run: python app.py")

asyncio.run(login())
