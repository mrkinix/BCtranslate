import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { extname, relative, basename, dirname, join } from 'path';
import { parseVue } from './parsers/vue.js';
import { parseReact } from './parsers/react.js';
import { parseHtml } from './parsers/html.js';
import { parseJs } from './parsers/js.js';
import { parseJson, applyJsonTranslations } from './parsers/json.js';
import { translateBatch } from './bridges/python.js';
import { getLocaleDir, saveLocale, loadLocale } from './generators/locales.js';

/**
 * Process a single file: extract strings, translate only untranslated ones,
 * write results. Smart: skips strings already present in the target locale.
 */
export async function translateFile(filePath, opts) {
  const { from, to, dryRun, outdir, project, cwd, verbose, jsonMode } = opts;
  const ext = extname(filePath).toLowerCase();
  const source = readFileSync(filePath, 'utf-8');
  const relativePath = relative(cwd, filePath);

  // Route to appropriate parser
  let result;
  switch (ext) {
    case '.vue':
      result = parseVue(source, filePath);
      break;
    case '.jsx':
    case '.tsx':
      result = parseReact(source, filePath);
      break;
    case '.html':
    case '.htm':
      result = parseHtml(source, filePath, project);
      break;
    case '.js':
    case '.ts':
      if (source.includes('React') || source.includes('jsx') || /<\w+[\s>]/.test(source)) {
        result = parseReact(source, filePath);
      } else {
        result = parseJs(source, filePath, project);
      }
      break;
    case '.json':
      result = parseJson(source, filePath, { jsonMode });
      break;
    default:
      return { count: 0, skipped: 0, relativePath };
  }

  if (!result.extracted || result.extracted.length === 0) {
    return { count: 0, skipped: 0, relativePath };
  }

  // Deduplicate by key (same text = same hash key)
  const seen = new Set();
  const uniqueBatch = result.extracted
    .map((item) => ({ key: item.key, text: item.text }))
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });

  // ── Smart half-translation: load existing locale, skip already-done keys ──
  const localeDir = opts.localesDir || getLocaleDir(cwd, project);
  const existingTarget = loadLocale(localeDir, to);

  const needsTranslation = uniqueBatch.filter((item) => !(item.key in existingTarget));
  const skippedCount = uniqueBatch.length - needsTranslation.length;

  // Start with existing translations
  let translations = { ...existingTarget };

  if (needsTranslation.length > 0) {
    try {
      const newTranslations = await translateBatch(needsTranslation, from, to);
      Object.assign(translations, newTranslations);
    } catch (err) {
      if (verbose) {
        console.error(`    Translation error: ${err.message}`);
      }
      // Fallback: use original text
      for (const item of needsTranslation) {
        translations[item.key] = item.text;
      }
    }
  }

  // Build locale entries for all extracted strings
  const fromEntries = {};
  const toEntries = {};
  for (const item of uniqueBatch) {
    fromEntries[item.key] = item.text;
    toEntries[item.key] = translations[item.key] || item.text;
  }

  if (!dryRun) {
    // Write locale files (merge with existing — won't overwrite manual edits)
    saveLocale(localeDir, from, fromEntries);
    saveLocale(localeDir, to, toEntries);

    if (ext === '.json') {
      const translatedData = applyJsonTranslations(result.jsonData, translations);
      const outName = basename(filePath, ext) + `.${to}${ext}`;
      const outPath = outdir
        ? join(outdir, outName)
        : join(dirname(filePath), outName);

      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(translatedData, null, 2) + '\n', 'utf-8');
    } else {
      // Only rewrite source if it actually changed
      if (result.source !== source) {
        const outPath = outdir ? join(outdir, basename(filePath)) : filePath;
        if (outdir) mkdirSync(outdir, { recursive: true });

        const tmpPath = outPath + '.bctmp';
        writeFileSync(tmpPath, result.source, 'utf-8');
        const { renameSync } = await import('fs');
        renameSync(tmpPath, outPath);
      }
    }
  }

  // count = newly translated strings; skipped = already had translations
  return {
    count: needsTranslation.length,
    skipped: skippedCount,
    relativePath,
    diff: dryRun ? generateDiff(source, result.source) : null,
  };
}

/**
 * Simple line-diff preview for dry-run mode.
 */
function generateDiff(original, modified) {
  if (original === modified) return '';

  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const diffs = [];

  const maxLines = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLines; i++) {
    const orig = origLines[i] || '';
    const mod = modLines[i] || '';
    if (orig !== mod) {
      diffs.push(`    ${i + 1}: - ${orig.trim()}`);
      diffs.push(`    ${i + 1}: + ${mod.trim()}`);
    }
  }

  return diffs.slice(0, 40).join('\n') + (diffs.length > 40 ? '\n    ... (truncated)' : '');
}
