#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { resolve, basename, dirname } from 'path';
import { existsSync, statSync } from 'fs';
import { glob } from 'glob';
import { translateAllFiles, generateDiff } from '../src/index.js';
import { detectProject } from '../src/detect.js';
import { ensureI18nSetup } from '../src/generators/setup.js';
import { checkPythonBridge, installArgostranslate } from '../src/bridges/python.js';
import { loadConfig, saveConfig } from '../src/config.js';

const program = new Command();

program
  .name('bctranslate')
  .description('Transform source files into i18n-ready code with automatic translation')
  .version('1.0.0');

// ── Language lists ────────────────────────────────────────────────────────────
const COMMON_LANGUAGES = [
  { name: 'French        (fr)', value: 'fr' },
  { name: 'Spanish       (es)', value: 'es' },
  { name: 'German        (de)', value: 'de' },
  { name: 'Italian       (it)', value: 'it' },
  { name: 'Portuguese    (pt)', value: 'pt' },
  { name: 'Dutch         (nl)', value: 'nl' },
  { name: 'Russian       (ru)', value: 'ru' },
  { name: 'Chinese       (zh)', value: 'zh' },
  { name: 'Japanese      (ja)', value: 'ja' },
  { name: 'Korean        (ko)', value: 'ko' },
  { name: 'Arabic        (ar)', value: 'ar' },
  { name: 'Turkish       (tr)', value: 'tr' },
  { name: 'Polish        (pl)', value: 'pl' },
  { name: 'Swedish       (sv)', value: 'sv' },
  { name: 'Norwegian     (nb)', value: 'nb' },
  { name: 'Danish        (da)', value: 'da' },
  { name: 'Finnish       (fi)', value: 'fi' },
  { name: 'Czech         (cs)', value: 'cs' },
  { name: 'Romanian      (ro)', value: 'ro' },
  { name: 'Hungarian     (hu)', value: 'hu' },
];

const SOURCE_LANGUAGES = [
  { name: 'English    (en)', value: 'en' },
  { name: 'French     (fr)', value: 'fr' },
  { name: 'Spanish    (es)', value: 'es' },
  { name: 'German     (de)', value: 'de' },
  { name: 'Italian    (it)', value: 'it' },
  { name: 'Portuguese (pt)', value: 'pt' },
  { name: 'Chinese    (zh)', value: 'zh' },
  { name: 'Other (type below)', value: '__other__' },
];

// ── File patterns per project type ───────────────────────────────────────────
const FILE_PATTERNS = {
  vue:     ['**/*.vue', 'src/**/*.js', 'src/**/*.ts'],
  react:   ['**/*.jsx', '**/*.tsx', 'src/**/*.js', 'src/**/*.ts'],
  vanilla: ['**/*.html', '**/*.htm', '**/*.js'],
};

const IGNORE_PATTERNS = [
  '**/node_modules/**', '**/dist/**', '**/build/**',
  '**/.git/**', '**/coverage/**', '**/*.min.js',
];

// ── File resolution ───────────────────────────────────────────────────────────
async function resolveFiles(pathArg, cwd, project) {
  const patterns = FILE_PATTERNS[project.type] || FILE_PATTERNS.vanilla;

  if (!pathArg) {
    const files = [];
    for (const p of patterns) {
      files.push(...await glob(p, { cwd, absolute: true, ignore: IGNORE_PATTERNS }));
    }
    return [...new Set(files)];
  }

  const resolved = resolve(cwd, pathArg);
  if (existsSync(resolved)) {
    if (statSync(resolved).isDirectory()) {
      const files = [];
      for (const p of patterns) {
        files.push(...await glob(p, { cwd: resolved, absolute: true, ignore: IGNORE_PATTERNS }));
      }
      return [...new Set(files)];
    }
    return [resolved];
  }
  return glob(pathArg, { cwd, absolute: true, ignore: IGNORE_PATTERNS });
}

// ── Translation runner — uses global batching (Python spawned once) ───────────
async function runTranslation({ pathArg, from, to, localesDir, dryRun, outdir, verbose, jsonMode, profile, setup, autoImport, cwd }) {
  const project = detectProject(cwd);
  console.log(chalk.green(`  ✓ Project type: ${chalk.bold(project.type)}`));

  const files = await resolveFiles(pathArg, cwd, project);
  if (files.length === 0) {
    console.log(chalk.yellow('  ⚠ No files found to translate.'));
    return { totalStrings: 0, totalFiles: 0 };
  }

  console.log(chalk.cyan(`  → ${files.length} file(s) [${from} → ${to}]...\n`));

  if (setup !== false) {
    const resolvedLocalesDir = localesDir ? resolve(cwd, localesDir) : undefined;
    await ensureI18nSetup(cwd, project, from, to, resolvedLocalesDir, { autoImport });
  }

  // Global batch: all files parsed first, ONE Python call, then all writes
  const results = await translateAllFiles(files, {
    from,
    to,
    dryRun,
    outdir,
    project,
    cwd,
    verbose,
    jsonMode,
    profile: !!profile,
    localesDir: localesDir ? resolve(cwd, localesDir) : undefined,
  });

  let totalStrings = 0;
  let totalFiles   = 0;

  for (const result of results) {
    if (result.count > 0) {
      totalFiles++;
      totalStrings += result.count;
      const label = dryRun ? chalk.yellow('[DRY RUN]') : chalk.green('[DONE]  ');
      const skipNote = result.skipped > 0 ? chalk.gray(` (${result.skipped} already done)`) : '';
      console.log(`  ${label} ${chalk.white(result.relativePath)} — ${result.count} new${skipNote}`);
      if (result.diff) {
        console.log(chalk.gray(result.diff));
      }
    } else if (verbose) {
      console.log(`  ${chalk.gray('[SKIP]  ')} ${result.relativePath}`);
    }
  }

  return { totalStrings, totalFiles };
}

// ── init subcommand ───────────────────────────────────────────────────────────
program
  .command('init')
  .description('Interactive setup wizard — languages, locales folder, auto-install')
  .action(async () => {
    const { default: inquirer } = await import('inquirer');
    const cwd      = process.cwd();
    const existing = loadConfig(cwd);
    const project  = detectProject(cwd);

    const defaultLocalesDir = project.type === 'vanilla' ? './locales'    : './src/locales';
    const defaultI18nFile   = project.type === 'vanilla' ? './i18n.js'    : './src/i18n.js';

    console.log(chalk.cyan.bold('\n  ⚡ bctranslate init\n'));
    if (existing) console.log(chalk.gray('  Existing config found — press Enter to keep values.\n'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'localesDir',
        message: 'Folder for locale files (en.json, fr.json, ...):',
        default: existing?.localesDir || defaultLocalesDir,
      },
      {
        type: 'list',
        name: 'from',
        message: 'Source language:',
        choices: SOURCE_LANGUAGES,
        default: existing?.from || 'en',
      },
      {
        type: 'input',
        name: 'fromCustom',
        message: 'Source language code (e.g. zh-TW):',
        when: (ans) => ans.from === '__other__',
        validate: (v) => v.trim().length >= 2 || 'Enter a valid BCP 47 code',
      },
      {
        type: 'checkbox',
        name: 'to',
        message: 'Target language(s) — Space to select, Enter to confirm:',
        choices: COMMON_LANGUAGES,
        default: existing?.to,
        validate: (v) => v.length > 0 || 'Select at least one target language',
      },
      {
        type: 'input',
        name: 'extraTo',
        message: 'Extra language codes (comma-separated, e.g. zh-TW,sr — blank to skip):',
        default: '',
      },
      {
        type: 'input',
        name: 'i18nFile',
        message: 'i18n setup file path:',
        default: existing?.i18nFile || defaultI18nFile,
      },
    ]);

    const fromLang = answers.from === '__other__' ? answers.fromCustom.trim() : answers.from;
    const extraTo  = answers.extraTo
      ? answers.extraTo.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const toLangs = [...new Set([...answers.to, ...extraTo])].filter((l) => l !== fromLang);

    if (toLangs.length === 0) {
      console.log(chalk.red('\n  ✗ No target languages selected.\n'));
      process.exit(1);
    }

    const config = {
      from: fromLang,
      to: toLangs,
      localesDir: answers.localesDir.trim(),
      i18nFile:   answers.i18nFile.trim(),
    };

    const configPath = saveConfig(config, cwd);
    console.log(chalk.green(`\n  ✓ Config saved → ${basename(configPath)}`));
    console.log(chalk.cyan(`\n  Source  : ${chalk.bold(config.from)}`));
    console.log(chalk.cyan(`  Targets : ${chalk.bold(config.to.join(', '))}`));
    console.log(chalk.cyan(`  Locales : ${chalk.bold(config.localesDir)}`));
    console.log(chalk.cyan(`  i18n    : ${chalk.bold(config.i18nFile)}`));

    // ── Auto-install dependencies ─────────────────────────────────────────────
    const { installDeps } = await inquirer.prompt([{
      type: 'confirm',
      name: 'installDeps',
      message: 'Install/update argostranslate now? (required for offline translation)',
      default: !existing,
    }]);

    if (installDeps) {
      process.stdout.write(chalk.cyan('\n  Installing argostranslate... '));
      try {
        await installArgostranslate();
        console.log(chalk.green('done'));
      } catch (err) {
        console.log(chalk.red(`failed\n  ${err.message}`));
        console.log(chalk.gray('  Run manually: pip install argostranslate'));
      }
    }

    // ── Offer to pre-download language models ─────────────────────────────────
    const { downloadModels } = await inquirer.prompt([{
      type: 'confirm',
      name: 'downloadModels',
      message: `Download language models for ${toLangs.join(', ')}? (can take a few minutes, required before first use)`,
      default: true,
    }]);

    if (downloadModels) {
      for (const to of toLangs) {
        process.stdout.write(chalk.cyan(`  Downloading ${fromLang} → ${to}... `));
        try {
          await checkPythonBridge(fromLang, to);
          console.log(chalk.green('ready'));
        } catch (err) {
          console.log(chalk.red(`failed: ${err.message}`));
        }
      }
    }

    console.log(chalk.gray('\n  Run `bctranslate` to start translating.\n'));
  });

// ── Main translation command ──────────────────────────────────────────────────
program
  .argument('[path]', 'File, directory, or glob pattern to translate')
  .argument('[from]', 'Source language code (e.g. en)')
  .argument('[keyword]', '"to" keyword')
  .argument('[lang]', 'Target language code (e.g. fr)')
  .option('-t, --to <lang>', 'Target language(s), comma-separated (e.g. fr or fr,es)')
  .option('-d, --dry-run', 'Preview changes without writing files', false)
  .option('-o, --outdir <dir>', 'Output directory for translated files')
  .option('--no-setup', 'Skip i18n setup file generation')
  .option('--no-import', 'Do not auto-inject i18n imports/script tags')
  .option('--json-mode <mode>', 'JSON translation mode: values or full', 'values')
  .option('--profile', 'Print timing breakdown', false)
  .option('-v, --verbose', 'Show per-file diffs and skipped files', false)
  .action(async (pathArg, fromArg, keyword, langArg, opts) => {
    console.log(chalk.cyan.bold('\n  ⚡ bctranslate\n'));

    const invokedCwd = process.cwd();
    const config     = loadConfig(invokedCwd);
    const autoImport = opts.import !== false && (config?.autoImport !== false);

    let cwd = invokedCwd;
    if (!config && pathArg) {
      const resolvedTarget = resolve(invokedCwd, pathArg);
      if (existsSync(resolvedTarget)) {
        try {
          const st = statSync(resolvedTarget);
          cwd = st.isDirectory() ? resolvedTarget : dirname(resolvedTarget);
        } catch { cwd = invokedCwd; }
      }
    }

    const hasExplicitArgs = !!(pathArg || fromArg || keyword || langArg);

    if (!hasExplicitArgs && !config) {
      console.log(chalk.yellow('  No config found. Run `bctranslate init` to set up your project.'));
      console.log(chalk.gray('\n  Or pass arguments directly:'));
      console.log(chalk.gray('    bctranslate ./src en to fr'));
      console.log(chalk.gray('    bctranslate ./App.vue en to fr,es\n'));
      process.exit(0);
    }

    const from = fromArg || config?.from || 'en';

    let targets;
    if (keyword === 'to' && langArg) {
      targets = langArg.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (opts.to) {
      targets = opts.to.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (config?.to) {
      targets = Array.isArray(config.to) ? config.to : [config.to];
    } else {
      targets = ['fr'];
    }

    // Check Python + download models for all pairs
    for (const to of targets) {
      try {
        await checkPythonBridge(from, to);
        console.log(chalk.green(`  ✓ Python bridge ready (${from} → ${to})`));
      } catch (err) {
        console.error(chalk.red(`  ✗ ${err.message}`));
        process.exit(1);
      }
    }

    let grandTotal = 0;
    let grandFiles = 0;

    for (const to of targets) {
      if (targets.length > 1) console.log(chalk.cyan.bold(`\n  ── Translating to ${to} ──`));

      const { totalStrings, totalFiles } = await runTranslation({
        pathArg,
        from,
        to,
        localesDir: config?.localesDir,
        dryRun:     opts.dryRun,
        outdir:     opts.outdir,
        verbose:    opts.verbose,
        jsonMode:   opts.jsonMode,
        profile:    opts.profile,
        setup:      opts.setup,
        autoImport,
        cwd,
      });

      grandTotal += totalStrings;
      grandFiles += totalFiles;
    }

    const langStr = targets.join(', ');
    console.log(chalk.cyan.bold(
      `\n  Done: ${grandTotal} new string(s) in ${grandFiles} file(s) [→ ${langStr}]\n`
    ));
    console.log(chalk.gray(`  Root   : ${cwd}`));
    console.log(chalk.gray(`  Source : ${from}`));
    console.log(chalk.gray(`  Target : ${langStr}\n`));
  });

program.parse();
