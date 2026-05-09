require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { commands } = require('./commands');

async function deploy() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;

  if (!token || !clientId) {
    throw new Error('Missing DISCORD_TOKEN or CLIENT_ID in .env file.');
  }

  const rest = new REST({ version: '10' }).setToken(token);

  await rest.put(Routes.applicationCommands(clientId), {
    body: commands.map((command) => command.toJSON())
  });

  console.log('Slash commands deployed successfully.');
}

deploy().catch((error) => {
  console.error('Failed to deploy commands:', error);
  process.exitCode = 1;
});
