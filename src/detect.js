import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Detect the project type (vue, react, vanilla) based on package.json and file structure.
 */
export function detectProject(cwd) {
  const pkgPath = join(cwd, 'package.json');
  let pkg = {};

  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch { /* ignore */ }
  }

  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  // Vue detection
  if (allDeps['vue'] || allDeps['nuxt'] || allDeps['@vue/cli-service']) {
    const i18nPkg = allDeps['vue-i18n'] ? 'vue-i18n' : null;
    return {
      type: 'vue',
      i18nPackage: i18nPkg,
      usesCompositionApi: detectVueCompositionApi(cwd, allDeps),
      srcDir: existsSync(join(cwd, 'src')) ? 'src' : '.',
    };
  }

  // React detection
  if (allDeps['react'] || allDeps['next'] || allDeps['gatsby']) {
    const i18nPkg = allDeps['react-i18next'] ? 'react-i18next'
      : allDeps['react-intl'] ? 'react-intl' : null;
    return {
      type: 'react',
      i18nPackage: i18nPkg,
      srcDir: existsSync(join(cwd, 'src')) ? 'src' : '.',
    };
  }

  // Vanilla
  return {
    type: 'vanilla',
    i18nPackage: null,
    srcDir: '.',
  };
}

function detectVueCompositionApi(cwd, deps) {
  if (deps['@vue/composition-api']) return true;
  // Vue 3 uses composition API by default
  const vueVer = deps['vue'] || '';
  if (vueVer.match(/[~^]?3/)) return true;
  return false;
}