import * as babelParser from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import MagicString from 'magic-string';
import { textKey, isTranslatable } from '../utils.js';

const traverse = _traverse.default || _traverse;

/**
 * Parse a .js/.ts file and extract translatable strings.
 * These are strings in common UI patterns: alert(), confirm(), DOM manipulation, etc.
 */
export function parseJs(source, filePath, project) {
  const extracted = [];
  const isTS = filePath.endsWith('.ts');

  let ast;
  try {
    ast = babelParser.parse(source, {
      sourceType: 'module',
      plugins: [
        isTS ? 'typescript' : null,
        'classProperties',
        'optionalChaining',
        'nullishCoalescingOperator',
        'decorators-legacy',
        'dynamicImport',
      ].filter(Boolean),
    });
  } catch {
    return { source, extracted: [], modified: false };
  }

  const s = new MagicString(source);

  // Track which string literals to translate
  traverse(ast, {
    // Object property values with translatable keys
    ObjectProperty(path) {
      const keyNode = path.node.key;
      const valueNode = path.node.value;

      if (valueNode.type !== 'StringLiteral') return;
      if (!isTranslatable(valueNode.value)) return;

      // Check if the key name suggests translatable content
      const keyName = keyNode.name || keyNode.value || '';
      const translatableKeys = new Set([
        'title', 'label', 'placeholder', 'message', 'text',
        'description', 'tooltip', 'hint', 'caption', 'header',
        'subtitle', 'errorMessage', 'successMessage', 'content',
        'heading', 'subheading', 'buttonText', 'linkText',
        'name', 'displayName',
      ]);

      if (!translatableKeys.has(keyName)) return;

      const key = textKey(valueNode.value);
      const tFunc = project.type === 'vue' ? `this.$t('${key}')` : `t('${key}')`;

      s.overwrite(valueNode.start, valueNode.end, tFunc);
      extracted.push({ key, text: valueNode.value, context: `js-prop-${keyName}` });
    },

    // Function calls: alert('text'), console messages excluded
    CallExpression(path) {
      const callee = path.node.callee;
      let calleeName = '';

      if (callee.type === 'Identifier') {
        calleeName = callee.name;
      } else if (callee.type === 'MemberExpression' && callee.property) {
        calleeName = `${callee.object?.name || ''}.${callee.property.name}`;
      }

      // Skip console.*, require(), import()
      if (calleeName.startsWith('console.') || calleeName === 'require') return;

      // Translate alert/confirm/prompt first arg
      if (['alert', 'confirm', 'prompt'].includes(calleeName)) {
        const arg = path.node.arguments[0];
        if (arg && arg.type === 'StringLiteral' && isTranslatable(arg.value)) {
          const key = textKey(arg.value);
          const tFunc = project.type === 'vue' ? `this.$t('${key}')` : `t('${key}')`;
          s.overwrite(arg.start, arg.end, tFunc);
          extracted.push({ key, text: arg.value, context: 'js-call' });
        }
      }

      // .textContent = 'text', .innerText = 'text', .title = 'text'
    },

    // Assignment: element.textContent = 'text'
    AssignmentExpression(path) {
      const left = path.node.left;
      const right = path.node.right;

      if (right.type !== 'StringLiteral') return;
      if (!isTranslatable(right.value)) return;

      if (left.type === 'MemberExpression' && left.property) {
        const propName = left.property.name || left.property.value;
        const domProps = new Set([
          'textContent', 'innerText', 'title', 'placeholder',
          'alt', 'innerHTML',
        ]);

        if (domProps.has(propName)) {
          const key = textKey(right.value);
          const tFunc = project.type === 'vanilla'
            ? `i18n.t('${key}')`
            : project.type === 'vue'
              ? `this.$t('${key}')`
              : `t('${key}')`;

          s.overwrite(right.start, right.end, tFunc);
          extracted.push({ key, text: right.value, context: `js-dom-${propName}` });
        }
      }
    },
  });

  return {
    source: extracted.length > 0 ? s.toString() : source,
    extracted,
    modified: extracted.length > 0,
  };
}