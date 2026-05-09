const { DateTime, IANAZone } = require('luxon');
const { loadData, saveData } = require('./database');

const TENOR_API_KEY = process.env.TENOR_API_KEY || 'LIVDSRZULELA';
const TENOR_CLIENT_KEY = 'platybot';

const fallbackTimezones = [
  'UTC',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Warsaw',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Pacific/Auckland'
];

const timezoneList = typeof Intl.supportedValuesOf === 'function'
  ? Intl.supportedValuesOf('timeZone')
  : fallbackTimezones;

function isValidTimezone(timezone) {
  return IANAZone.isValidZone(timezone);
}

function isValidDayMonth(day, month) {
  const dt = DateTime.fromObject({ year: 2024, month, day });
  return dt.isValid;
}

function formatBirthday(entry) {
  const dt = DateTime.fromObject({
    day: entry.day,
    month: entry.month,
    year: entry.year || 2000
  });

  if (!dt.isValid) {
    const day = String(entry.day).padStart(2, '0');
    const month = String(entry.month).padStart(2, '0');
    const yearPart = entry.year ? `/${entry.year}` : '';
    return `${day}/${month}${yearPart}`;
  }

  return entry.year ? dt.toFormat('dd LLL yyyy') : dt.toFormat('dd LLL');
}

function getTimezoneSuggestions(input, limit = 25) {
  const query = input.trim().toLowerCase();
  if (!query) {
    return timezoneList.slice(0, limit);
  }

  const startsWith = [];
  const includes = [];

  for (const timezone of timezoneList) {
    const normalized = timezone.toLowerCase();
    if (normalized.startsWith(query)) {
      startsWith.push(timezone);
      continue;
    }

    if (normalized.includes(query)) {
      includes.push(timezone);
    }

    if (startsWith.length + includes.length >= limit) {
      break;
    }
  }

  return [...startsWith, ...includes].slice(0, limit);
}

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function extractGifUrl(result) {
  const media = result?.media_formats || {};
  return media.gif?.url || media.mediumgif?.url || media.tinygif?.url || null;
}

async function fetchBirthdayGif(excludedIds = new Set()) {
  const params = new URLSearchParams({
    key: TENOR_API_KEY,
    client_key: TENOR_CLIENT_KEY,
    q: 'happy birthday',
    limit: '35',
    media_filter: 'minimal',
    random: 'true'
  });

  try {
    const response = await fetch(`https://tenor.googleapis.com/v2/search?${params.toString()}`);
    if (!response.ok) {
      return null;
    }

    const body = await response.json();
    const candidates = (body.results || [])
      .map((item) => ({ id: String(item.id), url: extractGifUrl(item) }))
      .filter((item) => item.url);

    if (candidates.length === 0) {
      return null;
    }

    const fresh = candidates.filter((item) => !excludedIds.has(item.id));
    const pool = fresh.length > 0 ? fresh : candidates;
    return pickRandom(pool);
  } catch {
    return null;
  }
}

function pruneGifHistory(guildData, daysToKeep = 14) {
  if (!guildData.gifHistory || typeof guildData.gifHistory !== 'object') {
    guildData.gifHistory = {};
    return;
  }

  const cutoff = DateTime.utc().minus({ days: daysToKeep }).toISODate();
  for (const dateKey of Object.keys(guildData.gifHistory)) {
    if (dateKey < cutoff) {
      delete guildData.gifHistory[dateKey];
    }
  }
}

function buildBirthdayMessage(userId, entry, nowInZone) {
  const mention = `<@${userId}>`;

  const withAgeTemplates = [
    `Happy Birthday ${mention}! You are now **{age}** years old. Have an amazing day!`,
    `Huge birthday cheers for ${mention}! Enjoy turning **{age}** and have a fantastic day!`,
    `${mention}, it's your birthday! **{age}** looks great on you. Celebrate big today!`
  ];

  const noAgeTemplates = [
    `Happy Birthday ${mention}! Have an amazing day!`,
    `It's your special day, ${mention}! Wishing you a fantastic birthday!`,
    `Birthday vibes for ${mention}! Hope your day is full of fun and cake!`
  ];

  if (entry.year) {
    const age = nowInZone.year - entry.year;
    return pickRandom(withAgeTemplates).replace('{age}', String(age));
  }

  return pickRandom(noAgeTemplates);
}

async function processBirthdays(client) {
  const data = loadData();
  const guildEntries = Object.entries(data.guilds);

  for (const [guildId, guildData] of guildEntries) {
    if (!guildData.gifHistory || typeof guildData.gifHistory !== 'object') {
      guildData.gifHistory = {};
    }
    pruneGifHistory(guildData);

    if (!guildData.setupChannelId) {
      continue;
    }

    let channel;
    try {
      channel = await client.channels.fetch(guildData.setupChannelId);
    } catch {
      continue;
    }

    if (!channel || !channel.isTextBased()) {
      continue;
    }

    for (const [userId, birthday] of Object.entries(guildData.birthdays || {})) {
      const nowInZone = DateTime.now().setZone(birthday.timezone);
      if (!nowInZone.isValid) {
        continue;
      }

      const isBirthday = nowInZone.month === birthday.month && nowInZone.day === birthday.day;
      const isDueTime = nowInZone.hour === 0 && nowInZone.minute === 1;
      const alreadySent = guildData.lastSent?.[userId] === nowInZone.year;

      if (!isBirthday || !isDueTime || alreadySent) {
        continue;
      }

      const message = buildBirthdayMessage(userId, birthday, nowInZone);
      const dateKey = nowInZone.toISODate();
      if (!guildData.gifHistory[dateKey]) {
        guildData.gifHistory[dateKey] = [];
      }

      const usedGifIds = new Set(guildData.gifHistory[dateKey]);
      const gif = await fetchBirthdayGif(usedGifIds);
      const content = gif ? `${message}\n${gif.url}` : message;

      try {
        await channel.send({ content });
        guildData.lastSent[userId] = nowInZone.year;

        if (gif?.id && !guildData.gifHistory[dateKey].includes(gif.id)) {
          guildData.gifHistory[dateKey].push(gif.id);
        }
      } catch {
        // Ignore send errors so one broken guild/user does not block the scheduler.
      }
    }
  }

  saveData(data);
}

module.exports = {
  isValidTimezone,
  isValidDayMonth,
  getTimezoneSuggestions,
  formatBirthday,
  processBirthdays
};
