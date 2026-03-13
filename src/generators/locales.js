import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Determine the locale directory path based on project type.
 */
export function getLocaleDir(cwd, project) {
  const candidates = [
    join(cwd, 'src', 'locales'),
    join(cwd, 'src', 'i18n', 'locales'),
    join(cwd, 'locales'),
    join(cwd, 'src', 'lang'),
    join(cwd, 'public', 'locales'),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  // Default: create src/locales for vue/react, locales/ for vanilla
  if (project.type === 'vanilla') {
    return join(cwd, 'locales');
  }
  return join(cwd, 'src', 'locales');
}

/**
 * Load an existing locale file, or return empty object.
 */
export function loadLocale(localeDir, langCode) {
  const filePath = join(localeDir, `${langCode}.json`);
  if (existsSync(filePath)) {
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Save a locale file, merging with existing keys.
 */
export function saveLocale(localeDir, langCode, newEntries) {
  mkdirSync(localeDir, { recursive: true });

  const filePath = join(localeDir, `${langCode}.json`);
  const existing = loadLocale(localeDir, langCode);

  // Merge: new entries take precedence for new keys,
  // but don't overwrite existing translations (idempotent)
  const merged = { ...existing };
  for (const [key, value] of Object.entries(newEntries)) {
    if (!(key in merged)) {
      merged[key] = value;
    }
  }

  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  return filePath;
}
