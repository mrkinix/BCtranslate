import * as babelParser from '@babel/parser';
import _traverse from '@babel/traverse';
import MagicString from 'magic-string';
import { contextKey, isTranslatable } from '../utils.js';

// Handle ESM default export quirks
const traverse = _traverse.default || _traverse;

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
 * Walk up the Babel path tree to find the nearest enclosing function
 * with a BlockStatement body — that is the React component function.
 * Returns the character offset right after the opening `{`.
 */
function findComponentBodyStart(jsxPath) {
  let p = jsxPath.parentPath;
  while (p) {
    const { node } = p;
    if (
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression') &&
      node.body?.type === 'BlockStatement'
    ) {
      return node.body.start + 1; // right after opening {
    }
    p = p.parentPath;
  }
  return -1;
}

/**
 * Parse a JSX/TSX file and extract translatable strings.
 * Hook injection uses AST-derived character positions — no regex.
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
  } catch {
    return { source, extracted: [], modified: false };
  }

  const s = new MagicString(source);
  let hookInsertPos = -1;

  traverse(ast, {
    // JSX text children: <div>Hello World</div>
    JSXText(path) {
      const text = path.node.value.trim();
      if (!isTranslatable(text)) return;

      const key = contextKey(text, filePath);
      const { start, end } = path.node;
      const original = path.node.value;
      const leadingWs = original.match(/^(\s*)/)[1];
      const trailingWs = original.match(/(\s*)$/)[1];

      s.overwrite(start, end, `${leadingWs}{t('${key}')}${trailingWs}`);
      extracted.push({ key, text, context: 'jsx-text' });

      if (hookInsertPos === -1) hookInsertPos = findComponentBodyStart(path);
    },

    // JSX string attributes: <input placeholder="Enter name" />
    JSXAttribute(path) {
      const name = path.node.name?.name;
      if (!name || ATTR_BLACKLIST.has(name)) return;

      const value = path.node.value;
      if (!value || value.type !== 'StringLiteral') return;

      const text = value.value;
      if (!isTranslatable(text)) return;
      if (!ATTR_WHITELIST.has(name) && text.length < 3) return;

      const key = contextKey(text, filePath);
      s.overwrite(path.node.start, path.node.end, `${name}={t('${key}')}`);
      extracted.push({ key, text, context: `jsx-attr-${name}` });

      if (hookInsertPos === -1) hookInsertPos = findComponentBodyStart(path);
    },

    // alert('...'), confirm('...')
    CallExpression(path) {
      const callee = path.node.callee;
      const calleeName = callee.name || callee.property?.name;
      if (!['alert', 'confirm'].includes(calleeName)) return;

      const arg = path.node.arguments[0];
      if (arg?.type === 'StringLiteral' && isTranslatable(arg.value)) {
        const key = contextKey(arg.value, filePath);
        s.overwrite(arg.start, arg.end, `t('${key}')`);
        extracted.push({ key, text: arg.value, context: 'call-arg' });
      }
    },
  });

  // ── Inject import and hook using AST-derived positions ───────────────────────
  if (extracted.length > 0) {
    if (!source.includes('useTranslation')) {
      // Find the last ImportDeclaration node — safe even with 'use client' directives
      let lastImportEnd = 0;
      for (const node of ast.program.body) {
        if (node.type === 'ImportDeclaration') lastImportEnd = node.end;
      }
      s.appendRight(lastImportEnd, `\nimport { useTranslation } from 'react-i18next';`);
    }

    if (!source.includes('useTranslation()') && hookInsertPos > 0) {
      s.appendRight(hookInsertPos, `\n  const { t } = useTranslation();\n`);
    }
  }

  return {
    source: extracted.length > 0 ? s.toString() : source,
    extracted,
    modified: extracted.length > 0,
  };
}
