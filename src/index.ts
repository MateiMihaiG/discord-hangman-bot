import 'dotenv/config';
const {
  Client,
  GatewayIntentBits,
  Events,
  ChatInputCommandInteraction,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  GuildTextBasedChannel,
  MessageFlags,
} = pkg;
import { categories, pickWord } from './words.ts';
import type { GameState } from './types.ts';
import { addWord, removeWord } from './wordStore.ts';
import pkg from 'discord.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

/** ===== Config ===== */
const PLAY_CHANNEL_ID = '1420798484625231892';      // canalul principal
const STAFF_MANAGE_ROLE_ID = '1399744729045798993'; // rolul de staff (kick power)
const PING_ROLE_ID = '1420812848359145653';        // rolul pentru ping când începe runda

const ROUND_TIME_MS = 120_000;
const TICK_MS = 15_000;
const HINT_MILESTONES = [60, 40, 20]; // secunde rămase când dăm hint

/** ===== Stare ===== */
const games = new Map<string, GameState>();

type ChannelSession = {
  mode: 'fixed' | 'random';
  currentCategory: string;
  gamesInCategory: number;
  rotateAfter: number; // dupa 3 runde schimbam categoria
};
const sessions = new Map<string, ChannelSession>();

// id-ul mesajului de setup (embed persistent) din canalul principal
let setupMessageId: string | undefined;

/** ===== ASCII art ===== */
const HANGMAN_PICS = [
  '```\n +---+\n |   |\n     |\n     |\n     |\n     |\n========\n```',
  '```\n +---+\n |   |\n O   |\n     |\n     |\n     |\n========\n```',
  '```\n +---+\n |   |\n O   |\n |   |\n     |\n     |\n========\n```',
  '```\n +---+\n |   |\n O   |\n/|   |\n     |\n     |\n========\n```',
  '```\n +---+\n |   |\n O   |\n/|\\  |\n     |\n     |\n========\n```',
  '```\n +---+\n |   |\n O   |\n/|\\  |\n/    |\n     |\n========\n```',
  '```\n +---+\n |   |\n O   |\n/|\\  |\n/ \\  |\n     |\n========\n```',
];

/** ===== Utilitare ===== */
function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}
function renderMasked(word: string | undefined, guessed: Set<string>) {
  if (!word) return '—';
  return word
    .split('')
    .map((ch) => (ch === '-' || ch === ' ' ? ' ' : guessed.has(ch) ? ch : '•'))
    .join(' ');
}
function collectGuessed(state: GameState) {
  const s = new Set<string>();
  for (const ch of state.word) if (state.masked.includes(ch)) s.add(ch);
  for (const w of state.wrong) s.add(w);
  return s;
}
function secsLeft(state: GameState) {
  const left = Math.ceil((ROUND_TIME_MS - (Date.now() - state.roundStart)) / 1000);
  return Math.max(0, left);
}
function revealHint(word: string, guessed: Set<string>) {
  const letters = [...new Set(word.replace(/[^a-zăâîșşţț]/g, ''))];
  const hidden = letters.filter((l) => !guessed.has(l));
  return hidden.length ? hidden[Math.floor(Math.random() * hidden.length)] : null;
}

/** ===== Embeds ===== */
function buildBoardEmbed(state: GameState) {
  const stageIndex = Math.min(state.wrong.length, HANGMAN_PICS.length - 1);
  const guessed = collectGuessed(state);
  const timeLine = `\nTimp rămas: **${secsLeft(state)}** secunde`;

  return new EmbedBuilder()
    .setTitle('🎮 Spânzurătoarea')
    .setDescription(
      `${HANGMAN_PICS[stageIndex]}\n` +
        `**Cuvânt:** ${renderMasked(state.word, guessed)}\n\n` +
        `Greșite: ${state.wrong.length ? '`' + state.wrong.join('`, `') + '`' : '—'}\n` +
        `Categorie: **${state.category}**` +
        timeLine,
    )
    .setTimestamp(state.startedAt);
}

function buildSetupEmbed(state?: GameState): EmbedBuilder {
  const desc =
    'Bine ai venit la **spânzurătoare**! Scopul jocului este ca, împreună cu comunitatea, să ghiciți cuvântul ascuns.\n\n' +
    '• Fiecare rundă durează **120 de secunde**.\n' +
    '• De la **60s** rămase, botul oferă automat un **hint** (o literă) la fiecare **20s** (60/40/20).\n\n';

  const status = state
    ? `**Status joc:** Joc activ ➜ <#${state.threadId}>`
    : '**Status joc:** Niciun joc activ.';

const signature =
  '\n\n———\n\n' + 
  '**Developer:** .deaddraw ( Misuuu- ) | **Discord:** [Server Discord](https://discord.gg/invite/nGK6GNPcEj)';



  return new EmbedBuilder()
    .setTitle('ℹ️ Informații Hangman')
    .setDescription(desc + status + signature)
    .setColor(0x2b6cb0);
}

/** ===== Setup embed management ===== */
async function upsertSetupMessage() {
  try {
    const ch = await client.channels.fetch(PLAY_CHANNEL_ID);
    if (!ch || ch.type !== ChannelType.GuildText) return;
    const state = games.get(PLAY_CHANNEL_ID);

    if (setupMessageId) {
      try {
        const msg = await ch.messages.fetch(setupMessageId);
        await msg.edit({ embeds: [buildSetupEmbed(state)] });
        return;
      } catch {
        // dacă a dispărut, creăm unul nou
      }
    }
    const sent = await ch.send({ embeds: [buildSetupEmbed(state)] });
    setupMessageId = sent.id;
  } catch { /* ignore */ }
}

/** ===== Timere rundă ===== */
function clearRoundTimers(state?: GameState) {
  if (!state) return;
  if (state.roundTimer) { clearTimeout(state.roundTimer); state.roundTimer = undefined; }
  if (state.tickTimer) { clearInterval(state.tickTimer); state.tickTimer = undefined; }
  if (state.hintTimers?.length) { for (const t of state.hintTimers) clearTimeout(t); state.hintTimers = []; }
}

async function updateBoard(state: GameState) {
  if (!state.messageId) return;
  try {
    const ch = await client.channels.fetch(state.threadId);
    if (ch && ch.type === ChannelType.PublicThread) {
      const msg = await ch.messages.fetch(state.messageId);
      await msg.edit({ embeds: [buildBoardEmbed(state)] });
    }
  } catch { /* ignore */ }
}

function startRoundTimers(state: GameState) {
  clearRoundTimers(state);
  state.roundStart = Date.now();

  // timeout final
  state.roundTimer = setTimeout(async () => {
    const current = games.get(PLAY_CHANNEL_ID);
    if (!current || current !== state) return;

    // anunță în thread
    const sessionMsg = decideNextCategoryAndAnnounce();
    try {
      const ch = await client.channels.fetch(state.threadId);
      if (ch && ch.type === ChannelType.PublicThread) {
        await ch.send(`⏳ Timpul a expirat! Cuvântul era **${state.word}**.${sessionMsg}`);
        await ch.send('🧹 Thread-ul o să fie șters peste 10 secunde.');
      }
    } catch { /* ignore */ }

    await endRoundAndQueueNext(state);
  }, ROUND_TIME_MS);

  // tick (refresh embed + setup status)
  state.tickTimer = setInterval(async () => {
    await updateBoard(state).catch(() => {});
    await upsertSetupMessage().catch(() => {});
  }, TICK_MS);

  // hint-uri automate 60/40/20
  state.hintTimers = HINT_MILESTONES.map((secLeft) => {
    const when = ROUND_TIME_MS - secLeft * 1000;
    return setTimeout(async () => {
      const current = games.get(PLAY_CHANNEL_ID);
      if (!current || current !== state) return;

      const guessed = collectGuessed(state);
      const letter = revealHint(state.word, guessed);
      if (!letter) return;

      if (state.word.includes(letter) && !state.masked.includes(letter)) {
        state.masked.push(letter);
        await updateBoard(state);
      }
      try {
        const ch = await client.channels.fetch(state.threadId);
        if (ch && ch.type === ChannelType.PublicThread) {
          await ch.send(`💡 Indiciu automat: litera **${letter}** se află în cuvânt.`);
        }
      } catch { /* ignore */ }
    }, when);
  });
}

/** ===== Rotație categorii (după fix 3 runde) ===== */
function decideNextCategoryAndAnnounce(): string {
  const session = sessions.get(PLAY_CHANNEL_ID);
  if (!session) return '';

  if (session.mode === 'random') {
    return `\n➡️ Următorul joc va fi **random**.`;
  }
  session.gamesInCategory += 1;

  if (session.gamesInCategory >= session.rotateAfter) {
    (async () => {
      const allCats = await categories();
      const candidates = allCats.filter((c) => c !== session.currentCategory);
      session.currentCategory = candidates[Math.floor(Math.random() * candidates.length)] ?? session.currentCategory;
      session.gamesInCategory = 0;
      session.rotateAfter = 3;
    })();
    return `\n🔄 Următorul joc va fi din categoria **${session.currentCategory}**.`;
  }
  return `\n➡️ Următorul joc rămâne în categoria **${session.currentCategory}**.`;
}

/** ===== Creează un thread public pornind de la un mesaj seed ===== */
async function createThread(mainCh: GuildTextBasedChannel, name: string) {
  if (!mainCh || mainCh.type !== ChannelType.GuildText) {
    throw new Error('Canal invalid pentru crearea thread-ului');
  }
  const seed = await mainCh.send('Se pregătește thread-ul rundei…');
  const thread = await seed.startThread({
    name,
    autoArchiveDuration: 60, // minute
  });
  try { await seed.delete(); } catch { /* ignore */ }
  return thread;
}

/** ===== Start joc ===== */
async function startGame(interaction: ChatInputCommandInteraction) {
  if (interaction.channelId !== PLAY_CHANNEL_ID) {
    return interaction.reply({
      content: `Folosește comanda în canalul dedicat <#${PLAY_CHANNEL_ID}>.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    return interaction.reply({ content: 'Rulează comanda într-un canal text de server.', flags: MessageFlags.Ephemeral });
  }

  // permisiuni: Admin sau KickMembers sau rolul STAFF_MANAGE_ROLE_ID
  const member = await interaction.guild?.members.fetch(interaction.user.id);
  const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator);
  const hasKick = member?.permissions.has(PermissionFlagsBits.KickMembers);
  const hasManageRole = member?.roles.cache.has(STAFF_MANAGE_ROLE_ID);
  if (!isAdmin && !hasKick && !hasManageRole) {
    return interaction.reply({
      content: 'Ai nevoie de rolul de staff (Kick Members) sau Administrator pentru a porni jocul.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (games.has(PLAY_CHANNEL_ID)) {
    return interaction.reply({ content: 'Există deja un joc activ.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const requested = (interaction.options.getString('categorie') || 'random').toLowerCase();
  if (requested === 'random') {
    sessions.set(PLAY_CHANNEL_ID, { mode: 'random', currentCategory: '', gamesInCategory: 0, rotateAfter: 3 });
  } else {
    sessions.set(PLAY_CHANNEL_ID, { mode: 'fixed', currentCategory: requested, gamesInCategory: 0, rotateAfter: 3 });
  }

  const mainCh = await interaction.client.channels.fetch(PLAY_CHANNEL_ID);
  if (!mainCh || mainCh.type !== ChannelType.GuildText) {
    return interaction.editReply({ content: 'Nu pot accesa canalul.' });
  }

  // creează thread
  const thread = await createThread(mainCh, `🎮 Hangman • ${requested}`);
  const threadLink = `https://discord.com/channels/${interaction.guildId}/${thread.id}`;

  // anunț pe canalul principal (va fi șters după start)
  const announce = await mainCh.send(
    `<@&${PING_ROLE_ID}> o nouă rundă de spânzurătoarea **începe în 15 secunde**: ${threadLink}`,
  );

  // după 15s — alegem cuvântul și pornim
  setTimeout(async () => {
    try {
      const picked = await Promise.resolve(pickWord(requested as any));
      const { word, category } = picked;

      const state: GameState = {
        word,
        masked: [],
        wrong: [],
        category,
        mainChannelId: PLAY_CHANNEL_ID,
        threadId: thread.id,
        mainAnnounceId: announce.id,
        startedAt: Date.now(),
        contributors: new Set(),
        attempted: new Set(),
        roundStart: Date.now(),
        hintTimers: [],
      };
      games.set(PLAY_CHANNEL_ID, state);

      const board = await thread.send({ embeds: [buildBoardEmbed(state)] });
      state.messageId = board.id;

      // ping în thread la începutul rundei
      await thread.send(`<@&${PING_ROLE_ID}> Runda a început! Succes!`);

      // șterge anunțul imediat ce runda a pornit
      try {
        await mainCh.messages.delete(announce.id);
        state.mainAnnounceId = undefined as any;
      } catch { /* ignore */ }

      // actualizează setup embed
      await upsertSetupMessage();

      startRoundTimers(state);
    } catch {
      try { await thread.delete('Eroare la pornirea jocului'); } catch {}
    }
  }, 15_000);

  await interaction.editReply({ content: `Am creat thread-ul rundei. Verifică anunțul din canal.` });
}

/** ===== Stop joc ===== */
async function stopGame(interaction: ChatInputCommandInteraction) {
  if (interaction.channelId !== PLAY_CHANNEL_ID) {
    return interaction.reply({
      content: `Folosește comanda în canalul dedicat <#${PLAY_CHANNEL_ID}>.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // permisiuni: Admin sau KickMembers sau rolul STAFF_MANAGE_ROLE_ID
  const member = await interaction.guild?.members.fetch(interaction.user.id);
  const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator);
  const hasKick = member?.permissions.has(PermissionFlagsBits.KickMembers);
  const hasManageRole = member?.roles.cache.has(STAFF_MANAGE_ROLE_ID);
  if (!isAdmin && !hasKick && !hasManageRole) {
    return interaction.reply({
      content: 'Ai nevoie de rolul de staff (Kick Members) sau Administrator pentru a opri jocul.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const state = games.get(PLAY_CHANNEL_ID);
  if (!state) {
    return interaction.reply({
      content: 'Niciun joc activ.',
      flags: MessageFlags.Ephemeral,
    });
  }

  clearRoundTimers(state);
  games.delete(PLAY_CHANNEL_ID);
  sessions.delete(PLAY_CHANNEL_ID);

  // șterge thread-ul
  try {
    const ch = await client.channels.fetch(state.threadId);
    if (ch && ch.type === ChannelType.PublicThread) {
      await ch.delete('Oprit de staff');
    }
  } catch { /* ignore */ }

  // șterge anunțul (dacă mai e)
  try {
    if (state.mainAnnounceId) {
      const mainCh = await client.channels.fetch(PLAY_CHANNEL_ID);
      if (mainCh && mainCh.type === ChannelType.GuildText) {
        await mainCh.messages.delete(state.mainAnnounceId);
      }
    }
  } catch { /* ignore */ }

  // update embed setup -> „Niciun joc activ.”
  await upsertSetupMessage();

  return interaction.reply('Joc oprit. Thread-ul și anunțul au fost curățate.');
}

/** ===== Setup (embed persistent cu status) ===== */
async function setupMessage(interaction: ChatInputCommandInteraction) {
  if (interaction.channelId !== PLAY_CHANNEL_ID) {
    return interaction.reply({
      content: `Folosește comanda în canalul dedicat <#${PLAY_CHANNEL_ID}>.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // permisiuni ca la start/stop
  const member = await interaction.guild?.members.fetch(interaction.user.id);
  const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator);
  const hasKick = member?.permissions.has(PermissionFlagsBits.KickMembers);
  const hasManageRole = member?.roles.cache.has(STAFF_MANAGE_ROLE_ID);
  if (!isAdmin && !hasKick && !hasManageRole) {
    return interaction.reply({
      content: 'Ai nevoie de rolul de staff (Kick Members) sau Administrator pentru a folosi setup.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // postează sau actualizează embedul persistent
  await upsertSetupMessage();

  await interaction.editReply('Mesajul de setup este actualizat/creat.');
}

/** ===== Ghiciri ===== */
async function handleGuess(input: string, userId: string, state: GameState) {
  state.attempted.add(userId);
  const isWord = input.length > 1;

  if (isWord) {
    if (normalize(state.word) === normalize(input)) {
      state.contributors.add(userId);
      const letters = new Set(state.word.replace(/\s/g, '').split(''));
      state.masked = [...letters];
      await updateBoard(state);

      const winners = buildWinnersMessage(state);

      const thread = await client.channels.fetch(state.threadId).catch(() => null);
      if (thread && thread.type === ChannelType.PublicThread) {
        await thread.send(winners);
      }

      // anunță ștergerea thread-ului
      if (thread && thread.type === ChannelType.PublicThread) {
        await thread.send('🧹 Thread-ul o să fie șters peste 10 secunde.');
      }

      decideNextCategoryAndAnnounce();
      await endRoundAndQueueNext(state);


      return;
    } else {
      if (!state.wrong.includes(input)) state.wrong.push(input);
      await updateBoard(state);

      const ch = await client.channels.fetch(state.threadId).catch(() => null);
      if (ch && ch.type === ChannelType.PublicThread) {
        await ch.send(`❌ <@${userId}> a greșit cuvântul.`);
      }
      return;
    }
  }

  // literă
  const letter = input[0];
  if (!/[a-zăâîșşţț]/i.test(letter)) return;

  const guessed = collectGuessed(state);
  if (guessed.has(letter)) return;

  if (state.word.includes(letter)) {
    state.contributors.add(userId);
    state.masked.push(letter);
    await updateBoard(state);

    if (!renderMasked(state.word, new Set(state.masked)).includes('•')) {
      const winners = buildWinnersMessage(state);

      const ch = await client.channels.fetch(state.threadId).catch(() => null);
      if (ch && ch.type === ChannelType.PublicThread) {
        await ch.send(winners);
        await ch.send('🧹 Thread-ul o să fie șters peste 10 secunde.');
      }

      decideNextCategoryAndAnnounce();
      await endRoundAndQueueNext(state);
    } else {
      const ch = await client.channels.fetch(state.threadId).catch(() => null);
      if (ch && ch.type === ChannelType.PublicThread) {
        await ch.send(`✅ Litera **${letter}** este în cuvânt!`);
      }
    }
  } else {
    state.wrong.push(letter);
    await updateBoard(state);
    const ch = await client.channels.fetch(state.threadId).catch(() => null);
    if (ch && ch.type === ChannelType.PublicThread) {
      await ch.send(`❌ <@${userId}> a greșit litera.`);
    }
  }
}

function mentionContributors(state: GameState): string {
  const ids = Array.from(state.contributors);
  return ids.length ? ids.map((id) => `<@${id}>`).join(', ') : '';
}

function buildWinnersMessage(state: GameState): string {
  const count = state.contributors.size;
  const names = mentionContributors(state);
  if (count === 1 && names) return `🏆 Bravo, ${names}! Ai ghicit cuvântul **${state.word}**.`;
  if (count >= 2 && names) return `🏆 Bravo, ${names}! Ați ghicit cuvântul **${state.word}**.`;
  // fallback (no contributors detected)
  return `🏆 Bravo! Ați ghicit cuvântul **${state.word}**.`;
}

/** ===== Final de rundă -> pregătește următoarea ===== */
async function endRoundAndQueueNext(state: GameState) {
  clearRoundTimers(state);
  games.delete(PLAY_CHANNEL_ID);

  // șterge thread-ul rundei
  try {
    const ch = await client.channels.fetch(state.threadId);
    if (ch && ch.type === ChannelType.PublicThread) {
      // șterge thread-ul după 10 secunde, nu instant
      setTimeout(() => { ch.delete('Rundă terminată'); }, 10_000);
    }
  } catch { /* ignore */ }

  // update setup embed (Niciun joc activ)
  await upsertSetupMessage();

  // după 15s, creează un nou thread și anunță — anunțul va fi șters la start
  setTimeout(async () => {
    try {
      const mainCh = await client.channels.fetch(PLAY_CHANNEL_ID);
      if (!mainCh || mainCh.type !== ChannelType.GuildText) return;

      const session = sessions.get(PLAY_CHANNEL_ID);
      let nextCat = 'random';
      if (session) {
        nextCat = session.mode === 'random' ? 'random' : session.currentCategory;
      }

      const thread = await createThread(mainCh, `🎮 Hangman • ${nextCat}`);
      const threadLink = `https://discord.com/channels/${(mainCh as any).guildId}/${thread.id}`;
      const announce = await mainCh.send(
        `<@&${PING_ROLE_ID}> o nouă rundă de spânzurătoarea **începe în 15 secunde**: ${threadLink}`,
      );

      setTimeout(async () => {
        try {
          const picked = await Promise.resolve(pickWord(nextCat as any));
          const { word, category } = picked;

          const newState: GameState = {
            word,
            masked: [],
            wrong: [],
            category,
            mainChannelId: PLAY_CHANNEL_ID,
            threadId: thread.id,
            mainAnnounceId: announce.id,
            startedAt: Date.now(),
            contributors: new Set(),
            attempted: new Set(),
            roundStart: Date.now(),
            hintTimers: [],
          };
          games.set(PLAY_CHANNEL_ID, newState);

          const board = await thread.send({ embeds: [buildBoardEmbed(newState)] });
          newState.messageId = board.id;

          await thread.send(`<@&${PING_ROLE_ID}> Runda a început! Succes!`);

          try {
            await mainCh.messages.delete(announce.id);
            newState.mainAnnounceId = undefined as any;
          } catch { /* ignore */ }

          // update setup embed (acum joc activ)
          await upsertSetupMessage();

          startRoundTimers(newState);
        } catch {
          try { await thread.delete('Eroare la pornirea rundei următoare'); } catch {}
        }
      }, 15_000);
    } catch { /* ignore */ }
  }, 15_000);
}

/** ===== Interacțiuni slash ===== */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'hangman') return;

  const sub = interaction.options.getSubcommand(false);
  if (!sub) {
    return interaction.reply({
      content: 'Folosește **/hangman start**, **/hangman stop**, **/hangman add**, **/hangman del**, **/hangman setup**.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'start') return startGame(interaction);
  if (sub === 'stop')  return stopGame(interaction);
  if (sub === 'setup') return setupMessage(interaction);

  // /add și /del — staff only, în canalul principal
  if (interaction.channelId !== PLAY_CHANNEL_ID) {
    return interaction.reply({
      content: `Folosește comanda în canalul dedicat <#${PLAY_CHANNEL_ID}>.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  const member = await interaction.guild?.members.fetch(interaction.user.id);
  const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator);
  const hasKick = member?.permissions.has(PermissionFlagsBits.KickMembers);
  const hasManageRole = member?.roles.cache.has(STAFF_MANAGE_ROLE_ID);
  if (!isAdmin && !hasKick && !hasManageRole) {
    return interaction.reply({
      content: 'Ai nevoie de rolul de staff (Kick Members) sau Administrator.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'add') {
    const cat = interaction.options.getString('categorie', true);
    const word = interaction.options.getString('cuvant', true).toLowerCase().trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await addWord(cat, word);
      return interaction.editReply(`✅ Am adăugat **${word}** în categoria **${cat}**.`);
    } catch (e: any) {
      return interaction.editReply(`❌ Nu am putut adăuga: ${e?.message ?? 'eroare necunoscută'}.`);
    }
  }

  if (sub === 'del') {
    const cat = interaction.options.getString('categorie', true);
    const word = interaction.options.getString('cuvant', true).toLowerCase().trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await removeWord(cat, word);
      return interaction.editReply(`🗑️ Am șters **${word}** din categoria **${cat}**.`);
    } catch (e: any) {
      return interaction.editReply(`❌ Nu am putut șterge: ${e?.message ?? 'eroare necunoscută'}.`);
    }
  }
});

/** ===== Mesaje (doar thread / canal principal) ===== */
client.on(Events.MessageCreate, async (msg) => {
  try {
    if (msg.author.bot) return;

    // răspunde DOAR în canalul principal și în threadul jocului
    const state = games.get(PLAY_CHANNEL_ID);
    if (msg.channelId !== PLAY_CHANNEL_ID && msg.channelId !== state?.threadId) return;

    // în thread: procesează ghiciri
    if (state && msg.channelId === state.threadId) {
      const input = msg.content.toLowerCase().trim();
      if (!input) return;
      const looksLikeGuess = /^[a-zăâîșşţț\s]+$/i.test(input) && input.length <= 32;
      if (looksLikeGuess) await handleGuess(input, msg.author.id, state);
      return;
    }

    // în canalul principal NU mai trimitem mesaje de „nu e joc”/„e în thread” — setup embed acoperă statusul
  } catch (e) {
    console.error(e);
  }
});

/** ===== Ready & Login ===== */
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag} (PID ${process.pid})`);
  // la pornire, menține/creează setup embed-ul
  await upsertSetupMessage();
});

client.login(process.env.DISCORD_TOKEN);