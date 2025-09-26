// src/list-commands.ts
import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const token = process.env.DISCORD_TOKEN!;
const guildId = process.env.GUILD_ID;
const rest = new REST({ version: '10' }).setToken(token);

async function getAppId(): Promise<string> {
  const app = (await rest.get(Routes.oauth2CurrentApplication())) as any;
  return app.id as string;
}

async function main() {
  const appId = await getAppId();

  const global = (await rest.get(Routes.applicationCommands(appId))) as any[];
  console.log(`🌍 GLOBAL (${global.length}):`, global.map(c => c.name).join(', ') || '—');

  if (guildId) {
    const guild = (await rest.get(Routes.applicationGuildCommands(appId, guildId))) as any[];
    console.log(`🏠 GUILD ${guildId} (${guild.length}):`, guild.map(c => c.name).join(', ') || '—');
  } else {
    console.log('🏠 GUILD: (nu ai GUILD_ID în .env)');
  }
}

main().catch(console.error);
