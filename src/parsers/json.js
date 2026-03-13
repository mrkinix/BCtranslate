import { isTranslatable } from '../utils.js';

/**
 * Parse a JSON file and extract translatable string values.
 * Handles nested objects. Does NOT translate:
 * - Keys (object property names)
 * - Array items that look like identifiers/codes
 * - Non-string values
 * - Strings that look like code, URLs, paths, etc.
 */
export function parseJson(source, filePath, options = {}) {
  const { jsonMode = 'values' } = options;
  let data;

  try {
    data = JSON.parse(source);
  } catch {
    return { source, extracted: [], modified: false, jsonData: null };
  }

  const extracted = [];

  // Walk the JSON and collect translatable strings
  walkJson(data, [], extracted, jsonMode);

  return {
    source,
    extracted,
    modified: extracted.length > 0,
    jsonData: data,
  };
}

function walkJson(obj, path, extracted, mode) {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'string') {
    if (isTranslatable(obj) && obj.length > 1) {
      const key = path.join('.');
      extracted.push({ key, text: obj, context: 'json-value', jsonPath: path });
    }
    return;
  }

  if (Array.isArray(obj)) {
    // For arrays, only translate string items that look like real text
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (typeof item === 'string' && isTranslatable(item) && item.includes(' ')) {
        // Only translate multi-word strings in arrays (skip identifiers)
        const key = [...path, i].join('.');
        extracted.push({ key, text: item, context: 'json-array', jsonPath: [...path, i] });
      } else if (typeof item === 'object') {
        walkJson(item, [...path, i], extracted, mode);
      }
    }
    return;
  }

  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      walkJson(v, [...path, k], extracted, mode);
    }
  }
}

/**
 * Apply translations to a JSON object by path.
 */
export function applyJsonTranslations(data, translations) {
  const result = JSON.parse(JSON.stringify(data)); // deep clone

  for (const [dotPath, translatedText] of Object.entries(translations)) {
    const parts = dotPath.split('.');
    let target = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const key = isNaN(parts[i]) ? parts[i] : parseInt(parts[i]);
      if (target[key] === undefined) break;
      target = target[key];
    }

    const lastKey = isNaN(parts[parts.length - 1])
      ? parts[parts.length - 1]
      : parseInt(parts[parts.length - 1]);

    if (target && target[lastKey] !== undefined) {
      target[lastKey] = translatedText;
    }
  }

  return result;
}