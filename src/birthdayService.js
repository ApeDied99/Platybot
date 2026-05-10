const { DateTime, IANAZone } = require('luxon');
const { loadData, saveData } = require('./database');

const TENOR_API_KEY = process.env.TENOR_API_KEY || 'LIVDSRZULELA';
const TENOR_CLIENT_KEY = 'platybot';
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};
const configuredLogLevel = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const activeLogLevel = Object.hasOwn(LOG_LEVELS, configuredLogLevel)
  ? LOG_LEVELS[configuredLogLevel]
  : LOG_LEVELS.info;

function log(level, message, details) {
  const normalizedLevel = Object.hasOwn(LOG_LEVELS, level) ? level : 'info';
  if (LOG_LEVELS[normalizedLevel] > activeLogLevel) {
    return;
  }

  const prefix = `[birthday:${normalizedLevel}] ${message}`;
  if (details === undefined) {
    console[normalizedLevel](prefix);
  } else {
    console[normalizedLevel](prefix, details);
  }
}

function getSendWindowHours() {
  const parsed = Number(process.env.BIRTHDAY_SEND_WINDOW_HOURS);
  if (!Number.isFinite(parsed)) {
    return 6;
  }

  const normalized = Math.floor(parsed);
  if (normalized < 1) {
    return 1;
  }

  if (normalized > 24) {
    return 24;
  }

  return normalized;
}

function normalizeSendWindowHours(overrideValue) {
  if (overrideValue === undefined || overrideValue === null) {
    return getSendWindowHours();
  }

  const parsed = Number(overrideValue);
  if (!Number.isFinite(parsed)) {
    return getSendWindowHours();
  }

  const normalized = Math.floor(parsed);
  if (normalized < 1) {
    return 1;
  }

  if (normalized > 24) {
    return 24;
  }

  return normalized;
}

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

async function processBirthdays(client, options = {}) {
  const sendWindowHours = normalizeSendWindowHours(options.sendWindowHoursOverride);
  const data = loadData();
  const allGuildEntries = Object.entries(data.guilds);
  const guildEntries = options.onlyGuildId
    ? allGuildEntries.filter(([guildId]) => guildId === options.onlyGuildId)
    : allGuildEntries;
  const summary = {
    guildsScanned: guildEntries.length,
    usersChecked: 0,
    usersEligible: 0,
    usersSent: 0,
    usersAlreadySent: 0,
    usersInvalidTimezone: 0,
    sendErrors: 0,
    skippedNoSetupChannel: 0,
    skippedInvalidChannel: 0,
    channelFetchErrors: 0,
    guildSummaries: {}
  };

  log('info', 'Birthday scan started', {
    trigger: options.trigger || 'unknown',
    tickStartedAtIso: options.tickStartedAtIso || null,
    guildCount: guildEntries.length,
    sendWindowHours,
    nowIso: new Date().toISOString()
  });

  for (const [guildId, guildData] of guildEntries) {
    const guildSummary = {
      usersChecked: 0,
      usersEligible: 0,
      usersSent: 0,
      usersAlreadySent: 0,
      usersInvalidTimezone: 0,
      sendErrors: 0,
      skippedNoSetupChannel: 0,
      skippedInvalidChannel: 0,
      channelFetchErrors: 0
    };
    summary.guildSummaries[guildId] = guildSummary;

    if (!guildData.gifHistory || typeof guildData.gifHistory !== 'object') {
      guildData.gifHistory = {};
    }
    pruneGifHistory(guildData);

    if (!guildData.setupChannelId) {
      summary.skippedNoSetupChannel += 1;
      guildSummary.skippedNoSetupChannel += 1;
      log('debug', `Skipping guild ${guildId} because setupChannelId is missing`);
      continue;
    }

    let channel;
    try {
      channel = await client.channels.fetch(guildData.setupChannelId);
    } catch (error) {
      summary.channelFetchErrors += 1;
      guildSummary.channelFetchErrors += 1;
      log('warn', `Failed to fetch channel ${guildData.setupChannelId} for guild ${guildId}`, {
        error: String(error)
      });
      continue;
    }

    if (!channel || !channel.isTextBased()) {
      summary.skippedInvalidChannel += 1;
      guildSummary.skippedInvalidChannel += 1;
      log('warn', `Configured channel is invalid or not text-based for guild ${guildId}`, {
        setupChannelId: guildData.setupChannelId
      });
      continue;
    }

    log('debug', `Scanning guild ${guildId}`, {
      setupChannelId: guildData.setupChannelId,
      birthdayCount: Object.keys(guildData.birthdays || {}).length
    });

    for (const [userId, birthday] of Object.entries(guildData.birthdays || {})) {
      summary.usersChecked += 1;
      guildSummary.usersChecked += 1;

      const nowInZone = DateTime.now().setZone(birthday.timezone);
      if (!nowInZone.isValid) {
        summary.usersInvalidTimezone += 1;
        guildSummary.usersInvalidTimezone += 1;
        log('warn', `Skipping user ${userId} in guild ${guildId} due to invalid timezone`, {
          timezone: birthday.timezone
        });
        continue;
      }

      const isBirthday = nowInZone.month === birthday.month && nowInZone.day === birthday.day;
      const isDueTime = nowInZone.hour < sendWindowHours;
      const alreadySent = guildData.lastSent?.[userId] === nowInZone.year;

      if (alreadySent) {
        summary.usersAlreadySent += 1;
        guildSummary.usersAlreadySent += 1;
      }

      log('debug', `Birthday check for user ${userId} in guild ${guildId}`, {
        timezone: birthday.timezone,
        localTime: nowInZone.toISO(),
        birthdayDay: birthday.day,
        birthdayMonth: birthday.month,
        isBirthday,
        isDueTime,
        alreadySent
      });

      if (!isBirthday || !isDueTime || alreadySent) {
        continue;
      }

      summary.usersEligible += 1;
      guildSummary.usersEligible += 1;

      log('info', `Sending birthday message for user ${userId} in guild ${guildId}`, {
        timezone: birthday.timezone,
        localTime: nowInZone.toISO()
      });

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
        summary.usersSent += 1;
        guildSummary.usersSent += 1;

        if (gif?.id && !guildData.gifHistory[dateKey].includes(gif.id)) {
          guildData.gifHistory[dateKey].push(gif.id);
        }
      } catch (error) {
        summary.sendErrors += 1;
        guildSummary.sendErrors += 1;
        log('error', `Failed to send birthday message for user ${userId} in guild ${guildId}`, {
          error: String(error)
        });
        // Ignore send errors so one broken guild/user does not block the scheduler.
      }
    }
  }

  saveData(data);
  log('info', 'Birthday scan completed', {
    trigger: options.trigger || 'unknown',
    nowIso: new Date().toISOString(),
    summary
  });

  return summary;
}

module.exports = {
  isValidTimezone,
  isValidDayMonth,
  getTimezoneSuggestions,
  formatBirthday,
  processBirthdays
};
