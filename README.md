# Platybot Birthday Bot

A Discord bot that stores birthdays and posts birthday wishes at `00:01` in each user's chosen timezone.

## Features

- `/setup` sets the current channel for birthday wishes (one channel per server).
- `/add [day] [month] [timezone] [year optional]` saves your birthday.
- `/list` shows all saved birthdays and timezones for the server.
- `/remove` removes your birthday entry.
- `/edit` updates your saved date/year/timezone if you made a typo or moved.
- Mentions users with `@` and includes age only when year is provided.
- Adds a random birthday GIF from Tenor and avoids reusing the same GIF on the same date per server whenever possible.

## Requirements

- Node.js 20+
- A Discord application and bot token

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` from `.env.example` and set:
   - `DISCORD_TOKEN`
   - `CLIENT_ID` (Application ID)
   - `TENOR_API_KEY` (optional, falls back to Tenor public test key)
3. Deploy slash commands:
   ```bash
   npm run deploy
   ```
4. Start the bot:
   ```bash
   npm start
   ```

## Render Deployment

- Service type: Web Service
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

Environment variables to configure on Render:

- `DISCORD_TOKEN` (required)
- `CLIENT_ID` (required for command deployment)
- `TENOR_API_KEY` (optional)
- `LOG_LEVEL` (optional, one of `error`, `warn`, `info`, `debug`; default: `info`)
- `BIRTHDAY_SEND_WINDOW_HOURS` (optional, default: `6`)

Notes:

- Dependency verification runs automatically after install via `postinstall`.
- Birthday checks run every minute and are started only after Discord emits ready.
- Birthday sends are allowed within the first hours of a birthday day (timezone-local) to reduce misses if host wake-up is delayed.

## Command Usage

- `/setup`
  - Run in the channel where birthday messages should be sent.
  - If run again in another channel, it moves setup to the new channel.
- `/add day:9 month:May timezone:Europe/Berlin year:1998(optional)`
   - `timezone` supports autocomplete suggestions while typing.
- `/list`
- `/remove`
- `/edit day:10 month:June timezone:America/New_York year:2000(optional) clear_year:true(optional)`
   - Change only the fields you want.
   - If you change the date, provide both `day` and `month` together.

## Notes

- Timezone must be an IANA timezone (for example: `Europe/Berlin`, `America/New_York`, `Asia/Tokyo`).
- Birthdays are stored in `data/birthdays.json`.
- Birthday messages are checked every minute and sent once per year during the configured send window after local midnight.
- GIFs are fetched from the Tenor public API. If not enough unique GIFs are available for a date, repeats can still happen as a fallback.
