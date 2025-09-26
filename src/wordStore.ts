// src/wordStore.ts
import { promises as fs } from 'fs';
import path from 'path';

type Store = Record<string, string[]>;

const DATA_FILE = path.resolve(process.cwd(), 'data', 'words.json');

const DEFAULT_STORE: Store = {
  animale: ['pisica','caine','vulpe','arici','urs','balena','girafa','caprioara','papagal','iepure'],
  orase: ['bucuresti','cluj','iasi','timisoara','sibiu','brasov','constanta'],
  fructe: ['mar','para','banana','portocala','kiwi','struguri','piersica'],
  tehnologie: ['javascript','typescript','browser','server','retea','internet','algoritm'],
  random: ['hangman','programare','romania','carte','muzica','teatru','soare','laptop'],
  device: ['telefon','tableta','monitor'],
};

function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

async function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  try { await fs.mkdir(dir, { recursive: true }); } catch {}
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify(DEFAULT_STORE, null, 2), 'utf8');
  }
}

async function loadStore(): Promise<Store> {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const json = JSON.parse(raw);
  const cleaned: Store = {};
  for (const [cat, arr] of Object.entries(json as Store)) {
    cleaned[normalize(cat)] = Array.from(new Set((arr ?? []).map(w => normalize(w)))).sort();
  }
  return cleaned;
}

async function saveStore(store: Store) {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
}

export async function getCategories(): Promise<string[]> {
  const store = await loadStore();
  return Object.keys(store).sort((a, b) => a.localeCompare(b));
}
export async function pick(category: string | 'random'): Promise<{ word: string; category: string }> {
  const store = await loadStore();
  let cat = normalize(category);
  const cats = Object.keys(store);

  if (cat === 'random' || !store[cat]) {
    const nonEmpty = cats.filter(c => Array.isArray(store[c]) && store[c].length > 0);
    cat = nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
  }

  const list = store[cat] ?? [];
  if (!list.length) throw new Error(`Categoria "${cat}" nu are cuvinte.`);

  const word = list[Math.floor(Math.random() * list.length)];
  return { word, category: cat };
}

export async function addWord(category: string, word: string): Promise<void> {
  const store = await loadStore();
  const cat = normalize(category);
  const w = normalize(word);

  if (!store[cat]) store[cat] = [];
  if (!store[cat].includes(w)) {
    store[cat].push(w);
    store[cat].sort();
    await saveStore(store);
  } else {
  }
}
export async function removeWord(category: string, word: string): Promise<void> {
  const store = await loadStore();
  const cat = normalize(category);
  const w = normalize(word);

  if (!store[cat]) throw new Error(`Categoria "${cat}" nu există.`);
  const idx = store[cat].indexOf(w);
  if (idx === -1) throw new Error(`Cuvântul "${w}" nu există în categoria "${cat}".`);

  store[cat].splice(idx, 1);
  await saveStore(store);
}
