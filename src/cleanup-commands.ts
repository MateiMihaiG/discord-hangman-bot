// src/cleanup-commands.ts
import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const token = process.env.DISCORD_TOKEN!;
const rest = new REST({ version: '10' }).setToken(token);

async function getAppId(): Promise<string> {
  const app = (await rest.get(Routes.oauth2CurrentApplication())) as any;
  return app.id as string;
}

async function main() {
  const appId = await getAppId();

  if (process.env.GUILD_ID) {
    console.log('🛑 Ai GUILD_ID setat; pentru cleanup GLOBAL comentează-l din .env.');
    process.exit(1);
  }

  console.log('🗑 Șterg toate comenzile **GLOBAL**…');
  await rest.put(Routes.applicationCommands(appId), { body: [] });
  console.log('✅ GLOBAL commands șterse.');
}

main().catch(console.error);
