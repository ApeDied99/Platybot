const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'birthdays.json');

const defaultData = {
  guilds: {}
};

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2), 'utf8');
  }
}

function loadData() {
  ensureDataFile();
  const raw = fs.readFileSync(dataFile, 'utf8');

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.guilds || typeof parsed.guilds !== 'object') {
      return { ...defaultData };
    }
    return parsed;
  } catch {
    return { ...defaultData };
  }
}

function saveData(data) {
  ensureDataFile();
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
}

function getGuild(data, guildId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = {
      setupChannelId: null,
      birthdays: {},
      lastSent: {},
      gifHistory: {}
    };
  }

  const guild = data.guilds[guildId];
  if (!guild.birthdays) guild.birthdays = {};
  if (!guild.lastSent) guild.lastSent = {};
  if (!guild.gifHistory) guild.gifHistory = {};
  return guild;
}

module.exports = {
  loadData,
  saveData,
  getGuild
};
