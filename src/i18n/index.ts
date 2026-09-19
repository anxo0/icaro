import es from './es.json';
import en from './en.json';

export type Lang = 'es' | 'en';
export type Strings = typeof es;
export type SiteStrings = Strings['site'];
export type AppStrings = Strings['app'];

const all: Record<Lang, Strings> = { es, en: en as Strings };

export function getStrings(lang: Lang): Strings {
  return all[lang];
}

/** Sustituye {marcadores} en una cadena: fmt('p. {n}', { n: 3 }) → 'p. 3'. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export const REPO_URL = 'https://github.com/anxo0/icaro';
export const AUTHOR_URL = 'https://soyjulian.dev';
