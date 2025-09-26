export type Category = string;

import { getCategories, pick as pickFromStore } from './wordStore.ts';

export async function categories(): Promise<Category[]> {
  return getCategories();
}

export async function pickWord(category: Category | 'random'): Promise<{ word: string; category: Category }> {
  return pickFromStore(category);
}
