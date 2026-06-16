export type { Command, CommandOption, CommandExample, Category } from '../data/commands';

export interface SearchResult {
  command: import('../data/commands').Command;
  score: number;
}

export type ViewMode = 'library' | 'command' | 'terminal' | 'split';
export type Theme = 'dark' | 'light';
