import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { categories } from './words.ts';

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;

if (!token) {
  console.error('Lipsește DISCORD_TOKEN în .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function getAppId(): Promise<string> {
  const app = (await rest.get(Routes.oauth2CurrentApplication())) as any;
  if (!app?.id) throw new Error('Nu am putut obține Application ID din token.');
  return app.id as string;
}

async function main() {
  const appId = await getAppId();
  const cats = await categories();
  const uniqueCats = Array.from(new Set(cats)).sort((a, b) => a.localeCompare(b));
  const choices = uniqueCats.map(c => ({ name: c, value: c }));

  const commands = [
    new SlashCommandBuilder()
      .setName('hangman')
      .setDescription('Joacă spânzurătoarea (joc colectiv pe thread)')
      .setDMPermission(false)
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addSubcommand(sc =>
        sc
          .setName('start')
          .setDescription('Pornește un joc nou (thread dedicat)')
          .addStringOption(o =>
            o
              .setName('categorie')
              .setDescription('Alege categoria de cuvinte (sau lasă gol pentru random)')
              .addChoices(...choices)
          )
      )
      .addSubcommand(sc =>
        sc
          .setName('stop')
          .setDescription('Oprește jocul curent și șterge thread-ul')
      )
      .addSubcommand(sc =>
        sc
          .setName('add')
          .setDescription('Adaugă un cuvânt nou într-o categorie')
          .addStringOption(o =>
            o.setName('categorie')
              .setDescription('Categoria țintă')
              .setRequired(true)
              .addChoices(...choices)
          )
          .addStringOption(o =>
            o.setName('cuvant')
              .setDescription('Cuvântul de adăugat')
              .setRequired(true)
          )
      )
      .addSubcommand(sc =>
        sc
          .setName('del')
          .setDescription('Șterge un cuvânt dintr-o categorie')
          .addStringOption(o =>
            o.setName('categorie')
              .setDescription('Categoria țintă')
              .setRequired(true)
              .addChoices(...choices)
          )
          .addStringOption(o =>
            o.setName('cuvant')
              .setDescription('Cuvântul de șters')
              .setRequired(true)
          )
      )
      .addSubcommand(sc =>
        sc
          .setName('setup')
          .setDescription('Trimite mesajul de setup (embed persistent cu statusul jocului)')
      )
      .toJSON(),
  ];

  if (guildId) {
    console.log('🔁 Înregistrez comenzi GUILD…');
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
    console.log('✅ GUILD commands up to date.');
  } else {
    console.log('🌍 Înregistrez comenzi GLOBAL (poate dura câteva minute)…');
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log('✅ GLOBAL commands up to date.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
