import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { extname, relative, basename, dirname, join } from 'path';
import { parseVue } from './parsers/vue.js';
import { parseReact } from './parsers/react.js';
import { parseHtml } from './parsers/html.js';
import { parseJs } from './parsers/js.js';
import { parseJson, applyJsonTranslations } from './parsers/json.js';
import { translateBatch } from './bridges/python.js';
import { getLocaleDir, saveLocale, loadLocale } from './generators/locales.js';

// ── Route source file to the correct parser ──────────────────────────────────

function routeParser(ext, source, filePath, project, jsonMode) {
  switch (ext) {
    case '.vue':  return parseVue(source, filePath);
    case '.jsx':
    case '.tsx':  return parseReact(source, filePath);
    case '.html':
    case '.htm':  return parseHtml(source, filePath, project);
    case '.js':
    case '.ts':
      if (source.includes('React') || source.includes('jsx') || /<\w+[\s>]/.test(source)) {
        return parseReact(source, filePath);
      }
      return parseJs(source, filePath, project);
    case '.json': return parseJson(source, filePath, { jsonMode });
    default:      return null;
  }
}

/**
 * Parse a file — no translation, no disk writes.
 * Returns extracted strings + modified source for later application.
 */
export function parseFileOnly(filePath, opts) {
  const { project, jsonMode = 'values' } = opts;
  const ext    = extname(filePath).toLowerCase();
  const source = readFileSync(filePath, 'utf-8');

  const result = routeParser(ext, source, filePath, project, jsonMode);
  if (!result || !result.extracted?.length) {
    return { source, modified: source, extracted: [], ext, filePath };
  }
  return {
    source,
    modified:  result.source,
    extracted: result.extracted,
    ext,
    filePath,
    jsonData: result.jsonData,
  };
}

/**
 * Apply a completed translations map to one parsed file and write to disk.
 * The original file is NOT touched until an atomic rename succeeds.
 */
export async function writeFileResult(parseResult, translations, opts) {
  const { source, modified, extracted, ext, filePath, jsonData } = parseResult;
  const { from, to, dryRun, outdir, project, cwd, verbose, localesDir } = opts;

  const relativePath = relative(cwd, filePath);
  if (!extracted?.length) return { count: 0, skipped: 0, relativePath };

  // Deduplicate extracted items by key
  const seen   = new Set();
  const unique = extracted.filter(({ key }) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const resolvedLocaleDir = localesDir || getLocaleDir(cwd, project);
  const existingTarget    = loadLocale(resolvedLocaleDir, to);

  const newCount = unique.filter(({ key }) => !(key in existingTarget)).length;
  const skipped  = unique.length - newCount;

  // Build locale entry maps
  const fromEntries = {};
  const toEntries   = {};
  for (const { key, text } of unique) {
    fromEntries[key] = text;
    toEntries[key]   = translations[key] ?? existingTarget[key] ?? text;
  }

  if (!dryRun) {
    saveLocale(resolvedLocaleDir, from, fromEntries);
    saveLocale(resolvedLocaleDir, to,   toEntries);

    if (ext === '.json') {
      const translatedData = applyJsonTranslations(jsonData, toEntries);
      const outName = basename(filePath, ext) + `.${to}${ext}`;
      const outPath = outdir
        ? join(outdir, outName)
        : join(dirname(filePath), outName);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(translatedData, null, 2) + '\n', 'utf-8');

    } else if (modified !== source) {
      // Only rewrite source when content actually changed
      // Atomic: write .bctmp first, then rename — original untouched until swap
      const outPath  = outdir ? join(outdir, basename(filePath)) : filePath;
      const tmpPath  = outPath + '.bctmp';
      if (outdir) mkdirSync(outdir, { recursive: true });
      writeFileSync(tmpPath, modified, 'utf-8');
      const { renameSync } = await import('fs');
      renameSync(tmpPath, outPath);
    }
  }

  return {
    count:  newCount,
    skipped,
    relativePath,
    diff: dryRun || verbose ? generateDiff(source, modified, relativePath) : null,
  };
}

/**
 * Translate ALL files in one Python invocation — model loads exactly once.
 *
 *  Phase 1: Parse every file (pure CPU — no network/Python)
 *  Phase 2: Collect all unique keys not already in the target locale
 *  Phase 3: translateBatch() once → Python starts, model loads, all strings translated
 *  Phase 4: Write each file
 */
export async function translateAllFiles(files, opts) {
  const { from, to, cwd, project, verbose, localesDir } = opts;

  const resolvedLocaleDir = localesDir || getLocaleDir(cwd, project);
  const existingTarget    = loadLocale(resolvedLocaleDir, to);

  // Phase 1 — parse
  const parsed = [];
  for (const file of files) {
    try {
      const result = parseFileOnly(file, opts);
      if (result.extracted.length > 0) parsed.push(result);
    } catch (err) {
      if (verbose) console.error(`  Parse error ${file}: ${err.message}`);
    }
  }

  if (parsed.length === 0) return [];

  // Phase 2 — deduplicate across all files, skip already-translated keys
  const seenKeys = new Set(Object.keys(existingTarget));
  const needed   = [];
  for (const { extracted } of parsed) {
    for (const { key, text } of extracted) {
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        needed.push({ key, text });
      }
    }
  }

  // Phase 3 — translate once (Python spawned exactly once, model loads once)
  let newTranslations = {};
  if (needed.length > 0) {
    newTranslations = await translateBatch(needed, from, to);
  }

  const allTranslations = { ...existingTarget, ...newTranslations };

  // Phase 4 — write files
  const results = [];
  for (const parseResult of parsed) {
    try {
      const r = await writeFileResult(parseResult, allTranslations, {
        ...opts,
        localesDir: resolvedLocaleDir,
      });
      results.push(r);
    } catch (err) {
      if (verbose) console.error(`  Write error ${parseResult.filePath}: ${err.message}`);
      results.push({ count: 0, skipped: 0, relativePath: relative(cwd, parseResult.filePath) });
    }
  }

  return results;
}

/**
 * Single-file convenience wrapper (for backward compatibility).
 */
export async function translateFile(filePath, opts) {
  const results = await translateAllFiles([filePath], opts);
  return results[0] ?? { count: 0, skipped: 0, relativePath: relative(opts.cwd, filePath) };
}

// ── Diff display ─────────────────────────────────────────────────────────────

export function generateDiff(original, modified, label = '') {
  if (!modified || original === modified) return '';

  const origLines = original.split('\n');
  const modLines  = modified.split('\n');
  const out       = label ? [`--- ${label} ---`] : [];

  const maxLines = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLines; i++) {
    const a = origLines[i] ?? '';
    const b = modLines[i]  ?? '';
    if (a !== b) {
      out.push(`  ${String(i + 1).padStart(4)} - ${a.trimEnd()}`);
      out.push(`  ${String(i + 1).padStart(4)} + ${b.trimEnd()}`);
    }
  }

  if (out.length > 80) {
    return out.slice(0, 80).join('\n') + `\n  ... (${out.length - 80} more lines truncated)`;
  }
  return out.join('\n');
}
