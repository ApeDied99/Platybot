require('dotenv').config();

const http = require('http');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { handleCommand, handleAutocomplete } = require('./commands');
const { processBirthdays } = require('./birthdayService');

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('Missing DISCORD_TOKEN in .env file.');
  process.exit(1);
}

console.log('[startup] Booting Platybot');
console.log(`[startup] Node.js version: ${process.version}`);
console.log(`[startup] Render environment: ${process.env.RENDER === 'true' ? 'yes' : 'no'}`);

const port = Number(process.env.PORT) || 3000;
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bot is online');
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`[startup] Web server running on port ${port}`);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let schedulerInterval = null;
let schedulerIsRunning = false;

function startBirthdayScheduler(discordClient) {
  if (schedulerInterval) {
    console.warn('[scheduler] Birthday scheduler already running, skipping duplicate start');
    return;
  }

  console.log('[scheduler] Starting birthday scheduler (1-minute interval)');

  const runTick = async (trigger) => {
    const startedAt = new Date();

    if (schedulerIsRunning) {
      console.warn(`[scheduler] Previous tick still running at ${startedAt.toISOString()}, skipping this tick`);
      return;
    }

    schedulerIsRunning = true;
    console.log(`[scheduler] Tick started (${trigger}) at ${startedAt.toISOString()}`);

    try {
      await processBirthdays(discordClient, {
        trigger,
        tickStartedAtIso: startedAt.toISOString()
      });

      const durationMs = Date.now() - startedAt.getTime();
      console.log(`[scheduler] Tick finished (${trigger}) in ${durationMs} ms`);
    } catch (error) {
      console.error(`[scheduler] Tick failed (${trigger}):`, error);
    } finally {
      schedulerIsRunning = false;
    }
  };

  runTick('initial-after-ready').catch((error) => {
    console.error('[scheduler] Initial tick invocation failed:', error);
  });

  schedulerInterval = setInterval(() => {
    runTick('interval').catch((error) => {
      console.error('[scheduler] Interval tick invocation failed:', error);
    });
  }, 60 * 1000);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[startup] Logged in as ${readyClient.user.tag}`);
  startBirthdayScheduler(client);
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

process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[process] Uncaught exception:', error);
});

client.login(token);
