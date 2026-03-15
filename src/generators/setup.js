import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { getLocaleDir } from './locales.js';

/**
 * Ensure the i18n configuration file and locale files exist.
 * Creates them if they don't.
 *
 * @param {string} cwd - Project root
 * @param {object} project - Detected project info
 * @param {string} from - Source language code
 * @param {string} to - Target language code
 * @param {string} [customLocaleDir] - Optional override for locale directory
 */
export async function ensureI18nSetup(cwd, project, from, to, customLocaleDir, options = {}) {
  const { autoImport = true } = options;
  const localeDir = customLocaleDir || getLocaleDir(cwd, project);
  mkdirSync(localeDir, { recursive: true });

  // Ensure locale JSON files exist
  for (const lang of [from, to]) {
    const localePath = join(localeDir, `${lang}.json`);
    if (!existsSync(localePath)) {
      writeFileSync(localePath, '{}\n', 'utf-8');
      console.log(chalk.green(`  ✓ Created ${localePath}`));
    }
  }

  if (project.type === 'vue') {
    await ensureVueI18n(cwd, project, from, to, localeDir, { autoImport });
  } else if (project.type === 'react') {
    await ensureReactI18n(cwd, project, from, to, localeDir, { autoImport });
  } else {
    await ensureVanillaI18n(cwd, from, to, localeDir, { autoImport });
  }
}

async function ensureVueI18n(cwd, project, from, to, localeDir, { autoImport }) {
  const i18nFile = join(cwd, 'src', 'i18n.js');

  if (existsSync(i18nFile)) {
    console.log(chalk.gray('  → i18n.js already exists, skipping setup'));
    return;
  }

  const isVue3 = project.usesCompositionApi;
  const relLocale = localeDir.replace(cwd, '.').replace(/\\/g, '/');

  let content;
  if (isVue3) {
    content = `import { createI18n } from 'vue-i18n';
import ${from} from '${relLocale}/${from}.json';
import ${to} from '${relLocale}/${to}.json';

function nestMessages(input) {
  if (!input || typeof input !== 'object') return {};
  const out = Array.isArray(input) ? [] : {};
  for (const [rawKey, value] of Object.entries(input)) {
    if (!rawKey.includes('.')) {
      out[rawKey] = value;
      continue;
    }
    const parts = rawKey.split('.').filter(Boolean);
    let cur = out;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i === parts.length - 1) {
        cur[p] = value;
      } else {
        if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
        cur = cur[p];
      }
    }
  }
  return out;
}

const i18n = createI18n({
  legacy: false,
  locale: '${from}',
  fallbackLocale: '${from}',
  messages: {
    ${from}: nestMessages(${from}),
    ${to}: nestMessages(${to}),
  },
});

export default i18n;
`;
  } else {
    content = `import Vue from 'vue';
import VueI18n from 'vue-i18n';
import ${from} from '${relLocale}/${from}.json';
import ${to} from '${relLocale}/${to}.json';

Vue.use(VueI18n);

function nestMessages(input) {
  if (!input || typeof input !== 'object') return {};
  const out = Array.isArray(input) ? [] : {};
  for (const [rawKey, value] of Object.entries(input)) {
    if (!rawKey.includes('.')) {
      out[rawKey] = value;
      continue;
    }
    const parts = rawKey.split('.').filter(Boolean);
    let cur = out;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i === parts.length - 1) {
        cur[p] = value;
      } else {
        if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
        cur = cur[p];
      }
    }
  }
  return out;
}

const i18n = new VueI18n({
  locale: '${from}',
  fallbackLocale: '${from}',
  messages: {
    ${from}: nestMessages(${from}),
    ${to}: nestMessages(${to}),
  },
});

export default i18n;
`;
  }

  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(i18nFile, content, 'utf-8');
  console.log(chalk.green(`  ✓ Created ${i18nFile}`));
  console.log(chalk.yellow(`  ⚠ Don't forget to install vue-i18n: npm install vue-i18n`));

  if (autoImport) {
    const injected = injectVueEntrypoint(cwd, isVue3);
    if (!injected) {
      console.log(chalk.yellow(`  ⚠ Import and use i18n in your main.js/main.ts`));
    }
  } else {
    console.log(chalk.yellow(`  ⚠ Import and use i18n in your main.js/main.ts`));
  }
}

async function ensureReactI18n(cwd, project, from, to, localeDir, { autoImport }) {
  const i18nFile = join(cwd, 'src', 'i18n.js');

  if (existsSync(i18nFile)) {
    console.log(chalk.gray('  → i18n.js already exists, skipping setup'));
    return;
  }

  const relLocale = localeDir.replace(cwd, '.').replace(/\\/g, '/');

  const content = `import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ${from} from '${relLocale}/${from}.json';
import ${to} from '${relLocale}/${to}.json';

function nestMessages(input) {
  if (!input || typeof input !== 'object') return {};
  const out = Array.isArray(input) ? [] : {};
  for (const [rawKey, value] of Object.entries(input)) {
    if (!rawKey.includes('.')) {
      out[rawKey] = value;
      continue;
    }
    const parts = rawKey.split('.').filter(Boolean);
    let cur = out;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i === parts.length - 1) {
        cur[p] = value;
      } else {
        if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
        cur = cur[p];
      }
    }
  }
  return out;
}

i18n.use(initReactI18next).init({
  resources: {
    ${from}: { translation: nestMessages(${from}) },
    ${to}: { translation: nestMessages(${to}) },
  },
  lng: '${from}',
  fallbackLng: '${from}',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
`;

  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(i18nFile, content, 'utf-8');
  console.log(chalk.green(`  ✓ Created ${i18nFile}`));
  console.log(chalk.yellow(`  ⚠ Don't forget to install: npm install i18next react-i18next`));

  if (autoImport) {
    const injected = injectReactEntrypoint(cwd);
    if (!injected) {
      console.log(chalk.yellow(`  ⚠ Import './i18n' in your index.js/App.js`));
    }
  } else {
    console.log(chalk.yellow(`  ⚠ Import './i18n' in your index.js/App.js`));
  }
}

async function ensureVanillaI18n(cwd, from, to, localeDir, { autoImport }) {
  const i18nFile = join(cwd, 'i18n.js');

  if (existsSync(i18nFile)) {
    console.log(chalk.gray('  → i18n.js already exists, skipping setup'));
    return;
  }

  const content = `/**
 * Simple i18n for vanilla JS — generated by bctranslate
 */
(function () {
  const locales = {};
  let currentLocale = '${from}';
  const fallbackLocale = '${from}';

  async function loadLocale(lang) {
    if (locales[lang]) return;
    const resp = await fetch('./locales/' + lang + '.json');
    locales[lang] = await resp.json();
  }

  function t(key, params) {
    // Support both flat keys ("home.submit") and nested objects ({ home: { submit: ... } })
    const dict = locales[currentLocale] || {};
    const dictFallback = locales[fallbackLocale] || {};

    const lookup = (d) => {
      const direct = Object.prototype.hasOwnProperty.call(d, key) ? d[key] : null;
      return direct !== null && direct !== undefined
        ? direct
        : key.split('.').reduce((obj, i) => (obj ? obj[i] : null), d);
    };

    const msg = lookup(dict) ?? lookup(dictFallback) ?? key;

    if (!params) return msg;
    return String(msg).replace(/\\{(\\w+)\\}/g, (match, k) =>
      params[k] !== undefined ? params[k] : match
    );
  }

  async function setLocale(lang) {
    await loadLocale(lang);
    currentLocale = lang;
    // Re-translate all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      const translated = t(key);
      // Preserve markup translations (e.g. "Hello <strong>world</strong>")
      if (el.children.length > 0 || /<[^>]+>/.test(String(translated))) {
        el.innerHTML = translated;
      } else {
        el.textContent = translated;
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      const translated = t(el.getAttribute('data-i18n-title'));
      if (el.tagName === 'TITLE') {
        document.title = translated;
      } else {
        el.title = translated;
      }
    });
  }

  // Auto-init
  loadLocale('${from}');

  const api = { t: t, setLocale: setLocale, loadLocale: loadLocale, ready: null };
  window.i18n = api;
  api.ready = setLocale('${to}');
})();
`;

  writeFileSync(i18nFile, content, 'utf-8');
  console.log(chalk.green(`  ✓ Created ${i18nFile}`));

  if (autoImport) {
    const injected = injectVanillaI18nEntrypoint(cwd);
    if (!injected) {
      console.log(chalk.yellow(`  ⚠ Add <script src="i18n.js"></script> to your HTML`));
    }
  } else {
    console.log(chalk.yellow(`  ⚠ Add <script src="i18n.js"></script> to your HTML`));
  }
}

function injectVueEntrypoint(cwd, isVue3) {
  const candidates = [
    join(cwd, 'src', 'main.ts'),
    join(cwd, 'src', 'main.js'),
    join(cwd, 'src', 'main.tsx'),
    join(cwd, 'src', 'main.jsx'),
  ];

  const mainFile = candidates.find((p) => existsSync(p));
  if (!mainFile) return false;

  let code = readFileSync(mainFile, 'utf-8');

  const hasI18nImport =
    code.includes("from './i18n'") ||
    code.includes('from "./i18n"') ||
    code.includes("from './i18n.js'") ||
    code.includes('from "./i18n.js"') ||
    code.includes("import './i18n'") ||
    code.includes('import "./i18n"');

  if (!hasI18nImport) {
    const importRe = /^import\s.+?;\s*$/gm;
    let lastImportEnd = 0;
    let m;
    while ((m = importRe.exec(code)) !== null) lastImportEnd = m.index + m[0].length;
    code =
      code.slice(0, lastImportEnd) +
      `\nimport i18n from './i18n';\n` +
      code.slice(lastImportEnd);
  }

  if (isVue3) {
    if (!code.includes('.use(i18n)') && !code.includes('use(i18n)')) {
      const chained = /createApp\(([^)]*)\)\s*\.mount\(/;
      if (chained.test(code)) {
        code = code.replace(chained, 'createApp($1).use(i18n).mount(');
      } else {
        const hasAppVar =
          /\bconst\s+app\s*=\s*createApp\(/.test(code) ||
          /\blet\s+app\s*=\s*createApp\(/.test(code);
        const mountIdx = code.indexOf('app.mount(');
        if (hasAppVar && mountIdx !== -1 && !code.includes('app.use(i18n')) {
          code = code.slice(0, mountIdx) + `app.use(i18n);\n` + code.slice(mountIdx);
        } else {
          return false;
        }
      }
    }
  } else {
    if (!/\bi18n\s*[:,]/.test(code)) {
      const newVue = /new\s+Vue\s*\(\s*\{/;
      if (newVue.test(code)) {
        code = code.replace(newVue, (m) => m + '\n  i18n,');
      } else {
        return false;
      }
    }
  }

  writeFileSync(mainFile, code, 'utf-8');
  console.log(chalk.green(`  ✓ Updated ${mainFile} (wired i18n)`));
  return true;
}

function injectReactEntrypoint(cwd) {
  const candidates = [
    join(cwd, 'src', 'index.tsx'),
    join(cwd, 'src', 'index.js'),
    join(cwd, 'src', 'main.tsx'),
    join(cwd, 'src', 'main.jsx'),
  ];

  const entryFile = candidates.find((p) => existsSync(p));
  if (!entryFile) return false;

  let code = readFileSync(entryFile, 'utf-8');
  if (
    code.includes("from './i18n'") ||
    code.includes('from "./i18n"') ||
    code.includes("import './i18n'") ||
    code.includes('import "./i18n"')
  ) {
    return true;
  }

  const importRe = /^import\s.+?;\s*$/gm;
  let lastImportEnd = 0;
  let m;
  while ((m = importRe.exec(code)) !== null) lastImportEnd = m.index + m[0].length;
  code = code.slice(0, lastImportEnd) + `\nimport './i18n';\n` + code.slice(lastImportEnd);

  writeFileSync(entryFile, code, 'utf-8');
  console.log(chalk.green(`  ✓ Updated ${entryFile} (imported i18n)`));
  return true;
}

function injectVanillaI18nEntrypoint(cwd) {
  // Prefer HTML entrypoint if present
  const htmlPath = join(cwd, 'index.html');
  if (existsSync(htmlPath)) {
    const html = readFileSync(htmlPath, 'utf-8');
    if (!/\bi18n\.js\b/.test(html)) {
      const scriptTag = `  <script src="./i18n.js"></script>\n`;
      let updated = html;

      const firstScript = updated.match(/<script\b/i);
      if (firstScript) {
        updated = updated.replace(firstScript[0], scriptTag + firstScript[0]);
      } else if (updated.includes('</body>')) {
        updated = updated.replace('</body>', scriptTag + '</body>');
      } else if (updated.includes('</head>')) {
        updated = updated.replace('</head>', scriptTag + '</head>');
      } else {
        updated += '\n' + scriptTag;
      }

      writeFileSync(htmlPath, updated, 'utf-8');
      console.log(chalk.green(`  ✓ Updated ${htmlPath} (added i18n.js script)`));
    }
    return true;
  }

  // Fallback: ESM entrypoint
  const jsPath = join(cwd, 'index.js');
  if (existsSync(jsPath)) {
    const js = readFileSync(jsPath, 'utf-8');
    const alreadyImports = js.includes("./i18n.js") || js.includes("'./i18n.js'") || js.includes("\"./i18n.js\"");
    if (!alreadyImports && /\b(import|export)\b/.test(js)) {
      writeFileSync(jsPath, `import './i18n.js';\n` + js, 'utf-8');
      console.log(chalk.green(`  ✓ Updated ${jsPath} (imported i18n.js)`));
      return true;
    }
  }

  return false;
}
