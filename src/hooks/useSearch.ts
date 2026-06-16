import { useState, useMemo, useCallback } from 'react';
import { commands, type Command } from '../data/commands';

export interface SearchResult {
  command: Command;
  score: number;
}

function scoreMatch(command: Command, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  let score = 0;
  const name = command.name.toLowerCase();
  const desc = command.description.toLowerCase();
  const longDesc = command.longDescription.toLowerCase();
  const tags = command.tags.map(t => t.toLowerCase());
  const category = command.category.toLowerCase();

  // Exact name match gets highest score
  if (name === q) score += 100;
  // Name starts with query
  else if (name.startsWith(q)) score += 80;
  // Name contains query
  else if (name.includes(q)) score += 60;

  // Description match
  if (desc.includes(q)) score += 30;
  if (longDesc.includes(q)) score += 10;

  // Tag match
  if (tags.some(t => t === q)) score += 50;
  if (tags.some(t => t.includes(q))) score += 20;

  // Category match
  if (category.includes(q)) score += 15;

  // Options match
  if (command.options.some(o => o.description.toLowerCase().includes(q))) score += 5;

  return score;
}

export function useSearch(initialCategory: string | null = null) {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(initialCategory);

  const results: SearchResult[] = useMemo(() => {
    let filtered = commands;

    if (selectedCategory) {
      filtered = filtered.filter(c => c.category === selectedCategory);
    }

    if (!query.trim()) {
      return filtered.map(c => ({ command: c, score: 1 }));
    }

    return filtered
      .map(c => ({ command: c, score: scoreMatch(c, query) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [query, selectedCategory]);

  const search = useCallback((q: string) => setQuery(q), []);
  const selectCategory = useCallback((cat: string | null) => setSelectedCategory(cat), []);
  const clearSearch = useCallback(() => { setQuery(''); setSelectedCategory(null); }, []);

  return {
    query,
    selectedCategory,
    results,
    search,
    selectCategory,
    clearSearch,
    totalCount: results.length,
  };
}
