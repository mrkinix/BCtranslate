import * as babelParser from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import MagicString from 'magic-string';
import { hashKey, isTranslatable } from '../utils.js';

// Handle ESM default export quirks
const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

/**
 * Non-translatable JSX attribute names.
 */
const ATTR_BLACKLIST = new Set([
  'className', 'id', 'style', 'key', 'ref', 'src', 'href',
  'type', 'name', 'value', 'htmlFor', 'tabIndex', 'role',
  'data-testid', 'data-cy', 'onClick', 'onChange', 'onSubmit',
  'onFocus', 'onBlur', 'onKeyDown', 'onKeyUp', 'onMouseEnter',
  'onMouseLeave', 'target', 'rel', 'method', 'action',
]);

const ATTR_WHITELIST = new Set([
  'title', 'placeholder', 'label', 'alt', 'aria-label',
  'aria-placeholder', 'aria-description',
]);

/**
 * Parse a JSX/TSX file and extract translatable strings.
 */
export function parseReact(source, filePath) {
  const extracted = [];
  const isTS = filePath.endsWith('.tsx') || filePath.endsWith('.ts');

  let ast;
  try {
    ast = babelParser.parse(source, {
      sourceType: 'module',
      plugins: [
        'jsx',
        isTS ? 'typescript' : null,
        'classProperties',
        'optionalChaining',
        'nullishCoalescingOperator',
        'decorators-legacy',
      ].filter(Boolean),
    });
  } catch (err) {
    // If Babel fails, return unmodified
    return { source, extracted: [], modified: false };
  }

  const s = new MagicString(source);
  let needsImport = false;

  traverse(ast, {
    // JSX text children: <div>Hello World</div>
    JSXText(path) {
      const text = path.node.value.trim();
      if (!isTranslatable(text)) return;

      const key = hashKey(text);
      const start = path.node.start;
      const end = path.node.end;

      // Preserve whitespace
      const original = path.node.value;
      const leadingWs = original.match(/^(\s*)/)[1];
      const trailingWs = original.match(/(\s*)$/)[1];

      s.overwrite(start, end, `${leadingWs}{t('${key}')}${trailingWs}`);
      extracted.push({ key, text, context: 'jsx-text' });
      needsImport = true;
    },

    // JSX string attributes: <input placeholder="Enter name" />
    JSXAttribute(path) {
      const name = path.node.name?.name;
      if (!name) return;

      if (ATTR_BLACKLIST.has(name)) return;

      // Only translate whitelisted attrs, or unknown attrs if they have translatable values
      const value = path.node.value;
      if (!value || value.type !== 'StringLiteral') return;

      const text = value.value;
      if (!isTranslatable(text)) return;
      if (!ATTR_WHITELIST.has(name) && text.length < 3) return;

      const key = hashKey(text);
      const attrStart = path.node.start;
      const attrEnd = path.node.end;

      s.overwrite(attrStart, attrEnd, `${name}={t('${key}')}`);
      extracted.push({ key, text, context: `jsx-attr-${name}` });
      needsImport = true;
    },

    // String literals in common patterns (not JSX)
    CallExpression(path) {
      const callee = path.node.callee;
      const calleeName = callee.name || (callee.property && callee.property.name);

      // alert('...'), confirm('...'), toast('...')
      if (['alert', 'confirm'].includes(calleeName)) {
        const arg = path.node.arguments[0];
        if (arg && arg.type === 'StringLiteral' && isTranslatable(arg.value)) {
          const key = hashKey(arg.value);
          s.overwrite(arg.start, arg.end, `t('${key}')`);
          extracted.push({ key, text: arg.value, context: 'call-arg' });
          needsImport = true;
        }
      }
    },
  });

  // Add useTranslation import if needed
  if (needsImport) {
    const hasUseTranslation = source.includes('useTranslation');
    if (!hasUseTranslation) {
      // Find the first import statement or top of file
      let insertPos = 0;
      const importMatch = source.match(/^import\s.+$/m);
      if (importMatch) {
        // Insert after all imports
        const lastImportMatch = [...source.matchAll(/^import\s.+$/gm)];
        if (lastImportMatch.length > 0) {
          const last = lastImportMatch[lastImportMatch.length - 1];
          insertPos = last.index + last[0].length;
        }
      }

      s.appendRight(insertPos, `\nimport { useTranslation } from 'react-i18next';\n`);
    }

    // Add const { t } = useTranslation() if not present
    if (!source.includes('useTranslation()')) {
      // Find the function body
      const funcMatch = source.match(/(?:function\s+\w+|const\s+\w+\s*=\s*(?:\([^)]*\)\s*=>|\w+\s*=>))\s*\{/);
      if (funcMatch) {
        const insertAt = funcMatch.index + funcMatch[0].length;
        s.appendRight(insertAt, `\n  const { t } = useTranslation();\n`);
      }
    }
  }

  return {
    source: extracted.length > 0 ? s.toString() : source,
    extracted,
    modified: extracted.length > 0,
  };
}