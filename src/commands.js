const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { loadData, saveData, getGuild } = require('./database');
const {
  isValidTimezone,
  isValidDayMonth,
  getTimezoneSuggestions,
  formatBirthday
} = require('./birthdayService');

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set this channel as the birthday message channel (one per server).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Add your birthday to the databank.')
    .addIntegerOption((option) =>
      option
        .setName('day')
        .setDescription('Day of month, e.g. 9')
        .setMinValue(1)
        .setMaxValue(31)
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('month')
        .setDescription('Month')
        .addChoices(
          { name: 'January', value: 1 },
          { name: 'February', value: 2 },
          { name: 'March', value: 3 },
          { name: 'April', value: 4 },
          { name: 'May', value: 5 },
          { name: 'June', value: 6 },
          { name: 'July', value: 7 },
          { name: 'August', value: 8 },
          { name: 'September', value: 9 },
          { name: 'October', value: 10 },
          { name: 'November', value: 11 },
          { name: 'December', value: 12 }
        )
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('timezone')
        .setDescription('Start typing to pick your IANA timezone')
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('year')
        .setDescription('Optional birth year, e.g. 1998')
        .setMinValue(1900)
        .setMaxValue(2100)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('List all saved birthdays for this server.'),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove your birthday from the databank.'),

  new SlashCommandBuilder()
    .setName('edit')
    .setDescription('Edit your saved birthday and/or timezone.')
    .addIntegerOption((option) =>
      option
        .setName('day')
        .setDescription('New day of month, e.g. 9')
        .setMinValue(1)
        .setMaxValue(31)
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('month')
        .setDescription('New month')
        .addChoices(
          { name: 'January', value: 1 },
          { name: 'February', value: 2 },
          { name: 'March', value: 3 },
          { name: 'April', value: 4 },
          { name: 'May', value: 5 },
          { name: 'June', value: 6 },
          { name: 'July', value: 7 },
          { name: 'August', value: 8 },
          { name: 'September', value: 9 },
          { name: 'October', value: 10 },
          { name: 'November', value: 11 },
          { name: 'December', value: 12 }
        )
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('timezone')
        .setDescription('Start typing to pick your new IANA timezone')
        .setAutocomplete(true)
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('year')
        .setDescription('Set or replace your birth year, e.g. 1998')
        .setMinValue(1900)
        .setMaxValue(2100)
        .setRequired(false)
    )
    .addBooleanOption((option) =>
      option
        .setName('clear_year')
        .setDescription('Remove your saved birth year')
        .setRequired(false)
    )
];

async function handleCommand(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This command only works in a server.',
      ephemeral: true
    });
    return;
  }

  const isSetupCommand = interaction.commandName === 'setup';
  await interaction.deferReply({ ephemeral: !isSetupCommand });

  const data = loadData();
  const guild = getGuild(data, interaction.guildId);

  if (interaction.commandName === 'setup') {
    guild.setupChannelId = interaction.channelId;
    saveData(data);

    await interaction.editReply({
      content: `Birthday wishes are now set up in <#${interaction.channelId}>.`,
    });
    return;
  }

  if (interaction.commandName === 'add') {
    const dayInput = interaction.options.getInteger('day', true);
    const monthInput = interaction.options.getInteger('month', true);
    const yearInput = interaction.options.getInteger('year', false);
    const timezoneInput = interaction.options.getString('timezone', true).trim();

    if (!isValidDayMonth(dayInput, monthInput)) {
      await interaction.editReply({
        content: 'Invalid day/month combination. Please select a real calendar date.',
      });
      return;
    }

    if (!isValidTimezone(timezoneInput)) {
      await interaction.editReply({
        content: 'Invalid timezone. Use a valid IANA timezone like Europe/Berlin or America/New_York.',
      });
      return;
    }

    guild.birthdays[interaction.user.id] = {
      day: dayInput,
      month: monthInput,
      year: yearInput || null,
      timezone: timezoneInput
    };

    if (guild.lastSent[interaction.user.id]) {
      delete guild.lastSent[interaction.user.id];
    }

    saveData(data);

    await interaction.editReply({
      content: `Saved your birthday as **${formatBirthday(guild.birthdays[interaction.user.id])}** in timezone **${timezoneInput}**.`,
    });
    return;
  }

  if (interaction.commandName === 'list') {
    const entries = Object.entries(guild.birthdays);

    if (entries.length === 0) {
      await interaction.editReply({
        content: 'No birthdays are saved in this server yet.',
      });
      return;
    }

    const lines = entries
      .sort((a, b) => {
        const aDate = a[1].month * 100 + a[1].day;
        const bDate = b[1].month * 100 + b[1].day;
        return aDate - bDate;
      })
      .map(([userId, entry]) => {
        const yearPart = entry.year ? ` | Year: ${entry.year}` : '';
        return `• <@${userId}> | ${formatBirthday(entry)}${yearPart} | ${entry.timezone}`;
      });

    const perField = 10;
    const fields = [];

    for (let i = 0; i < lines.length; i += perField) {
      const chunk = lines.slice(i, i + perField);
      fields.push({
        name: `Entries ${i + 1}-${Math.min(i + perField, lines.length)}`,
        value: chunk.join('\n')
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x2b8a3e)
      .setTitle('Saved Birthdays')
      .setDescription('All birthday entries for this server')
      .addFields(fields)
      .setFooter({ text: `Total entries: ${lines.length}` })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
    });
    return;
  }

  if (interaction.commandName === 'remove') {
    if (!guild.birthdays[interaction.user.id]) {
      await interaction.editReply({
        content: 'You do not have a saved birthday entry.',
      });
      return;
    }

    delete guild.birthdays[interaction.user.id];
    delete guild.lastSent[interaction.user.id];
    saveData(data);

    await interaction.editReply({
      content: 'Your birthday has been removed.',
    });
    return;
  }

  if (interaction.commandName === 'edit') {
    const existing = guild.birthdays[interaction.user.id];
    if (!existing) {
      await interaction.editReply({
        content: 'You do not have a saved birthday entry. Use /add first.',
      });
      return;
    }

    const dayInput = interaction.options.getInteger('day', false);
    const monthInput = interaction.options.getInteger('month', false);
    const timezoneInputRaw = interaction.options.getString('timezone', false);
    const yearInput = interaction.options.getInteger('year', false);
    const clearYearInput = interaction.options.getBoolean('clear_year', false) || false;
    const timezoneInput = timezoneInputRaw ? timezoneInputRaw.trim() : null;

    if (yearInput !== null && clearYearInput) {
      await interaction.editReply({
        content: 'Use either year or clear_year, not both at the same time.',
      });
      return;
    }

    const hasDay = dayInput !== null;
    const hasMonth = monthInput !== null;

    if (hasDay !== hasMonth) {
      await interaction.editReply({
        content: 'Please provide both day and month together when changing your date.',
      });
      return;
    }

    const hasAnyChange =
      hasDay ||
      timezoneInput !== null ||
      yearInput !== null ||
      clearYearInput;

    if (!hasAnyChange) {
      await interaction.editReply({
        content: 'No changes provided. Use at least one option to edit your entry.',
      });
      return;
    }

    const updated = { ...existing };

    if (hasDay && hasMonth) {
      if (!isValidDayMonth(dayInput, monthInput)) {
        await interaction.editReply({
          content: 'Invalid day/month combination. Please select a real calendar date.',
        });
        return;
      }

      updated.day = dayInput;
      updated.month = monthInput;
    }

    if (timezoneInput !== null) {
      if (!isValidTimezone(timezoneInput)) {
        await interaction.editReply({
          content: 'Invalid timezone. Use a valid IANA timezone like Europe/Berlin or America/New_York.',
        });
        return;
      }

      updated.timezone = timezoneInput;
    }

    if (yearInput !== null) {
      updated.year = yearInput;
    } else if (clearYearInput) {
      updated.year = null;
    }

    guild.birthdays[interaction.user.id] = updated;
    if (guild.lastSent[interaction.user.id]) {
      delete guild.lastSent[interaction.user.id];
    }
    saveData(data);

    await interaction.editReply({
      content: `Updated your entry to **${formatBirthday(updated)}** in timezone **${updated.timezone}**.`,
    });
    return;
  }
}

async function handleAutocomplete(interaction) {
  if (interaction.commandName !== 'add' && interaction.commandName !== 'edit') {
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'timezone') {
    return;
  }

  const suggestions = getTimezoneSuggestions(String(focused.value || ''), 25);
  await interaction.respond(
    suggestions.map((timezone) => ({ name: timezone, value: timezone }))
  );
}

module.exports = {
  commands,
  handleCommand,
  handleAutocomplete
};
