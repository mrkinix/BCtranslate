import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Determine the locale directory path based on project type.
 */
export function getLocaleDir(cwd, project) {
  const candidates = [
    join(cwd, 'src', 'locales'),
    join(cwd, 'src', 'i18n', 'locales'),
    join(cwd, 'src', 'i18n'),
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
 * Flatten a nested JSON object to dot-notation keys.
 * { home: { notes: 'Notes' } } → { 'home.notes': 'Notes' }
 */
function flattenKeys(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenKeys(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

/**
 * Unflatten dot-notation keys to a nested JSON object.
 * { 'home.notes': 'Notes' } → { home: { notes: 'Notes' } }
 */
function unflattenKeys(flat) {
  const result = {};
  for (const [dotKey, value] of Object.entries(flat)) {
    const parts = dotKey.split('.');
    let obj = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) {
        obj[parts[i]] = {};
      }
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
  }
  return result;
}

/**
 * Load an existing locale file and return flat dot-notation keys.
 * Handles both nested JSON (vue-i18n standard) and legacy flat format.
 */
export function loadLocale(localeDir, langCode) {
  const filePath = join(localeDir, `${langCode}.json`);
  if (existsSync(filePath)) {
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      // Flatten nested objects to dot-notation for internal use
      return flattenKeys(raw);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Save a locale file, merging with existing keys.
 * Writes nested JSON (standard for vue-i18n and react-i18next).
 */
export function saveLocale(localeDir, langCode, newEntries) {
  mkdirSync(localeDir, { recursive: true });

  const filePath = join(localeDir, `${langCode}.json`);
  const existing = loadLocale(localeDir, langCode); // already flat

  // Merge: don't overwrite existing translations
  const merged = { ...existing };
  for (const [key, value] of Object.entries(newEntries)) {
    if (!(key in merged)) {
      merged[key] = value;
    }
  }

  // Write as nested JSON for i18n library compatibility
  const nested = unflattenKeys(merged);
  writeFileSync(filePath, JSON.stringify(nested, null, 2) + '\n', 'utf-8');
  return filePath;
}
