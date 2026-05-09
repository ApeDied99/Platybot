require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');
const { handleCommand, handleAutocomplete } = require('./commands');
const { processBirthdays } = require('./birthdayService');

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('Missing DISCORD_TOKEN in .env file.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  processBirthdays(client).catch((error) => {
    console.error('Initial birthday check failed:', error);
  });

  setInterval(() => {
    processBirthdays(client).catch((error) => {
      console.error('Scheduled birthday check failed:', error);
    });
  }, 60 * 1000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    try {
      await handleAutocomplete(interaction);
    } catch (error) {
      console.error('Autocomplete handler error:', error);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error('Command handler error:', error);

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: 'An unexpected error occurred while running the command.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: 'An unexpected error occurred while running the command.',
          ephemeral: true
        });
      }
    } catch (responseError) {
      // Ignore duplicate acknowledgement errors to avoid crashing the bot process.
      if (responseError?.code !== 40060) {
        console.error('Failed to send error response:', responseError);
      }
    }
  }
});

client.login(token);
