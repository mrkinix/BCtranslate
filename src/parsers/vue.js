import * as compiler from '@vue/compiler-dom';
import { parse as babelParse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default;
import MagicString from 'magic-string';
import { contextKey, isTranslatable } from '../utils.js';

const ATTR_BLACKLIST = new Set([
  'id', 'class', 'style', 'src', 'href', 'ref', 'key', 'is',
  'v-model', 'v-bind', 'v-on', 'v-if', 'v-else', 'v-else-if',
  'v-for', 'v-show', 'v-html', 'v-text', 'v-slot', 'v-pre',
  'v-cloak', 'v-once', 'v-memo', 'name', 'type', 'value',
  'action', 'method', 'target', 'rel', 'media', 'lang',
  'charset', 'content', 'http-equiv', 'for', 'tabindex',
  'role', 'xmlns', 'viewBox', 'fill', 'stroke', 'd', 'cx', 'cy',
  'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'transform',
  'xmlns:xlink', 'xlink:href', 'data-testid', 'data-cy',
]);

const ATTR_WHITELIST = new Set([
  'title', 'placeholder', 'label', 'alt', 'aria-label',
  'aria-placeholder', 'aria-description', 'aria-roledescription',
]);

/**
 * Detect which t-function call to emit in templates.
 *
 * Rules:
 *  - If <script setup> and file already destructures `t` from a composable
 *    → use  t('key')          (matches user's existing pattern)
 *  - If <script setup> but no `t` yet
 *    → use  t('key')   AND inject `const { t } = useI18n()` into script
 *  - Options API (no setup)
 *    → use  $t('key')         (global plugin property)
 */

/**
 * Parse a .vue file and extract translatable strings.
 */
export function parseVue(source, filePath) {
  const extracted = [];
  const s = new MagicString(source);

  // Always use t() for consistency, as promised in the README.
  const tpl = (key) => `t('${key}')`;
  const scr = (key) => `t('${key}')`;

  // ── Template ────────────────────────────────────────────────────────────────
  const templateMatch = source.match(/<template\b[^>]*>([\s\S]*?)<\/template>/);
  if (templateMatch) {
    const templateContent = templateMatch[1];
    const templateOffset =
      source.indexOf(templateMatch[0]) + templateMatch[0].indexOf(templateContent);

    try {
      const ast = compiler.parse(templateContent, { comments: true, getTextMode: () => 0 });
      walkTemplate(ast.children, s, templateOffset, extracted, filePath, tpl);
    } catch {
      extractTemplateRegex(source, s, extracted, filePath, tpl);
    }
  }

  // ── Script ──────────────────────────────────────────────────────────────────
  const scriptMatch = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/);
  if (scriptMatch) {
    const scriptContent = scriptMatch[1];
    const scriptOffset =
      source.indexOf(scriptMatch[0]) + scriptMatch[0].indexOf(scriptContent);
    extractScriptStrings(scriptContent, s, scriptOffset, extracted, filePath, scr);
  }

  // ── Inject `const { t } = useI18n()` if not yet declared ────────
  if (extracted.length > 0) {
    const scriptSetupMatch = source.match(/(<script\b[^>]*\bsetup\b[^>]*>)([\s\S]*?)<\/script>/i);
    const hasT = /const\s*\{[^}]*\bt\b[^}]*\}\s*=/.test(source);
    
    if (scriptSetupMatch && !hasT) {
      const insertAt = source.indexOf(scriptSetupMatch[0]) + scriptSetupMatch[1].length;
      const needsImport = !source.includes('useI18n');
      const importLine = needsImport ? `import { useI18n } from 'vue-i18n';\n` : '';
      s.appendRight(insertAt, `\n${importLine}const { t } = useI18n();\n`);
    }
  }

  return {
    source: extracted.length > 0 ? s.toString() : source,
    extracted,
    modified: extracted.length > 0,
  };
}

// ── Template walker ───────────────────────────────────────────────────────────

function walkTemplate(nodes, s, baseOffset, extracted, filePath, tpl) {
  for (const node of nodes) {
    // Text node (type 2)
    if (node.type === 2) {
      const text = node.content.trim();
      if (isTranslatable(text)) {
        const start = baseOffset + node.loc.start.offset;
        const end   = baseOffset + node.loc.end.offset;

        if (!isAlreadyWrapped(s.original, start, end)) {
          const key = contextKey(text, filePath);
          const orig = node.content;
          const lws  = orig.match(/^(\s*)/)[1];
          const tws  = orig.match(/(\s*)$/)[1];
          s.overwrite(start, end, `${lws}{{ ${tpl(key)} }}${tws}`);
          extracted.push({ key, text, context: 'template-text' });
        }
      }
    }

    // Element (type 1) — check translatable attributes, then recurse
    if (node.type === 1) {
      for (const prop of node.props ?? []) {
        if (prop.type === 6 && prop.value) {
          const attrName = prop.name.toLowerCase();
          if (ATTR_WHITELIST.has(attrName) && isTranslatable(prop.value.content)) {
            const text = prop.value.content;
            if (!ATTR_BLACKLIST.has(attrName)) {
              const key      = contextKey(text, filePath);
              const attrStart = baseOffset + prop.loc.start.offset;
              const attrEnd   = baseOffset + prop.loc.end.offset;
              s.overwrite(attrStart, attrEnd, `:${attrName}="${tpl(key)}"`);
              extracted.push({ key, text, context: `template-attr-${attrName}` });
            }
          }
        }
      }
      if (node.children) walkTemplate(node.children, s, baseOffset, extracted, filePath, tpl);
    }

    // ForNode (type 11)
    if (node.type === 11 && node.children) {
      walkTemplate(node.children, s, baseOffset, extracted, filePath, tpl);
    }

    // IfNode (type 9) — walk branches
    if (node.type === 9 && node.branches) {
      for (const branch of node.branches) {
        if (branch.children) walkTemplate(branch.children, s, baseOffset, extracted, filePath, tpl);
      }
    }
  }
}

// ── Script string extractor ───────────────────────────────────────────────────

function extractScriptStrings(scriptContent, s, baseOffset, extracted, filePath, scr) {
  try {
    const ast = babelParse(scriptContent, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'], // Enable TS and JSX support
    });

    const replacements = [];

    traverse(ast, {
      enter(path) {
        let text;

        if (path.isStringLiteral()) {
          text = path.node.value;
        } else if (path.isTemplateLiteral()) {
          if (path.node.expressions.length > 0 || path.node.quasis.length !== 1) {
            return;
          }
          text = path.node.quasis[0].value.cooked;
        } else {
          return;
        }
        
        if (!isTranslatable(text)) return;

        // --- Parent checks to avoid replacing the wrong strings ---
        if (path.parent.type === 'CallExpression' && path.parent.callee.name === 't') return;
        if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(path.parent.type)) return;
        if (path.parent.type === 'ObjectProperty' && path.parent.key === path.node) return;
        if (path.parent.type === 'Property' && ['name'].includes(path.parent.key.name)) return;

        // --- Passed all checks, schedule replacement ---
        const key = contextKey(text, filePath);
        const start = baseOffset + path.node.start;
        const end = baseOffset + path.node.end;
        replacements.push({ start, end, key });
        extracted.push({ key, text, context: 'script' });
      }
    });

    // Apply replacements in reverse order to avoid offset issues
    for (let i = replacements.length - 1; i >= 0; i--) {
      const { start, end, key } = replacements[i];
      s.overwrite(start, end, scr(key));
    }

  } catch (e) {
    console.error('Babel parsing failed:', e);
    // If babel parsing fails, fallback to regex.
    extractScriptStringsRegex(scriptContent, s, baseOffset, extracted, filePath, scr);
  }
}


function extractScriptStringsRegex(scriptContent, s, baseOffset, extracted, filePath, scr) {
  // This is the old regex-based implementation, kept as a fallback.
  const patterns = [
    /\b(alert|confirm|toast|notify|message\.(?:success|error|warning|info))\s*\(\s*(['"`])((?:(?!\2).)+)\2\s*\)/g,
    /\b(title|label|placeholder|message|text|description|tooltip|hint|caption|header|subtitle|errorMessage|successMessage|emptyText|noData|loadingText|buttonText|confirmText|cancelText|successText|failText|warningText|helperText|hintText)\s*:\s*(['"`])((?:(?!\2).)+)\2/g,
    /\bref\s*\(\s*(['"`])((?:(?!\1)[^\\]|\\.)+)\1\s*\)/g,
    /\bcomputed\s*\(\s*\(\s*\)\s*=>\s*(['"`])((?:(?!\1)[^\\]|\\.)+)\1\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(scriptContent)) !== null) {
      const text = match[3] || match[2];
      if (!isTranslatable(text) || text.length <= 1) continue;
      
      const quoteChar = match[2] || match[1];
      const innerStr = quoteChar + text + quoteChar;
      const relPos = match.index + match[0].lastIndexOf(innerStr);

      if (isAlreadyWrappedScript(scriptContent, relPos)) continue;

      const key = contextKey(text, filePath);
      const textStart = baseOffset + relPos;
      const textEnd = textStart + innerStr.length;

      s.overwrite(textStart, textEnd, scr(key));
      extracted.push({ key, text, context: 'script-regex' });
    }
  }
}

function isAlreadyWrappedScript(scriptContent, pos) {
  const before = scriptContent.slice(Math.max(0, pos - 30), pos);
  return /\$?t\s*\(\s*$/.test(before);
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function isAlreadyWrapped(source, start, end) {
  // Look back 25 chars for an open t( call — node is inside an interpolation
  const before = source.slice(Math.max(0, start - 25), start);
  // Note: We only check for `t` now, not `$t`.
  return /t\s*\(\s*['"]/.test(before);
}

function extractTemplateRegex(source, s, extracted, filePath, tpl) {
  const pattern = />([^<]+)</g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const text = match[1].trim();
    if (isTranslatable(text)) {
      const textStart = match.index + 1;
      const textEnd   = textStart + match[1].length;
      if (!isAlreadyWrapped(source, textStart, textEnd)) {
        const key  = contextKey(text, filePath);
        const orig = match[1];
        const lws  = orig.match(/^(\s*)/)[1];
        const tws  = orig.match(/(\s*)$/)[1];
        s.overwrite(textStart, textEnd, `${lws}{{ ${tpl(key)} }}${tws}`);
        extracted.push({ key, text, context: 'template-text' });
      }
    }
  }
}
