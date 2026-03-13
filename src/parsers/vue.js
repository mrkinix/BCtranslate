import * as compiler from '@vue/compiler-dom';
import MagicString from 'magic-string';
import { hashKey, isTranslatable, parseInterpolation } from '../utils.js';

/**
 * Non-translatable attribute names.
 */
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

/**
 * Translatable attribute names.
 */
const ATTR_WHITELIST = new Set([
  'title', 'placeholder', 'label', 'alt', 'aria-label',
  'aria-placeholder', 'aria-description', 'aria-roledescription',
]);

/**
 * Parse a .vue file and extract translatable strings.
 * Returns the modified source and the list of extracted strings.
 */
export function parseVue(source, filePath) {
  const extracted = []; // {key, text, context}
  const s = new MagicString(source);
  let modified = false;

  // Parse template section
  const templateMatch = source.match(/<template\b[^>]*>([\s\S]*?)<\/template>/);
  if (templateMatch) {
    const templateStart = source.indexOf(templateMatch[0]);
    const templateContent = templateMatch[1];
    const templateOffset = templateStart + templateMatch[0].indexOf(templateContent);

    try {
      const ast = compiler.parse(templateContent, {
        comments: true,
        getTextMode: () => 0,
      });

      walkTemplate(ast.children, s, templateOffset, extracted);
      modified = extracted.length > 0;
    } catch (err) {
      // If Vue parser fails, fall back to regex-based extraction for template
      extractTemplateRegex(source, s, extracted);
      modified = extracted.length > 0;
    }
  }

  // Parse script section for string literals
  const scriptMatch = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/);
  if (scriptMatch) {
    const scriptStart = source.indexOf(scriptMatch[0]);
    const scriptContent = scriptMatch[1];
    const scriptOffset = scriptStart + scriptMatch[0].indexOf(scriptContent);
    const isSetup = /<script\b[^>]*setup[^>]*>/.test(source);

    extractScriptStrings(scriptContent, s, scriptOffset, extracted, isSetup);
  }

  return {
    source: modified || extracted.length > 0 ? s.toString() : source,
    extracted,
    modified: modified || extracted.length > 0,
  };
}

function walkTemplate(nodes, s, baseOffset, extracted) {
  for (const node of nodes) {
    // Type 2 = Text
    if (node.type === 2) {
      const text = node.content.trim();
      if (isTranslatable(text)) {
        const key = hashKey(text);
        const start = baseOffset + node.loc.start.offset;
        const end = baseOffset + node.loc.end.offset;

        // Check if already wrapped in $t()
        if (!isAlreadyWrapped(s.original, start, end)) {
          // Preserve leading/trailing whitespace
          const originalText = node.content;
          const leadingWs = originalText.match(/^(\s*)/)[1];
          const trailingWs = originalText.match(/(\s*)$/)[1];

          s.overwrite(start, end, `${leadingWs}{{ $t('${key}') }}${trailingWs}`);
          extracted.push({ key, text, context: 'template-text' });
        }
      }
    }

    // Type 1 = Element
    if (node.type === 1) {
      // Check translatable attributes
      if (node.props) {
        for (const prop of node.props) {
          // Type 6 = Attribute (static)
          if (prop.type === 6 && prop.value) {
            const attrName = prop.name.toLowerCase();

            if (ATTR_WHITELIST.has(attrName) && isTranslatable(prop.value.content)) {
              const text = prop.value.content;
              const key = hashKey(text);
              const attrStart = baseOffset + prop.loc.start.offset;
              const attrEnd = baseOffset + prop.loc.end.offset;

              // Convert static attribute to v-bind with $t()
              s.overwrite(attrStart, attrEnd, `:${attrName}="$t('${key}')"`);
              extracted.push({ key, text, context: `template-attr-${attrName}` });
            }
          }
        }
      }

      // Recurse into children
      if (node.children) {
        walkTemplate(node.children, s, baseOffset, extracted);
      }
    }

    // Type 5 = Interpolation ({{ expr }})
    if (node.type === 5 && node.content) {
      // Check for compound expressions that contain string literals
      // e.g., {{ isError ? 'Failed' : 'Success' }}
      // We only extract simple string content, not expressions
    }

    // Type 8 = CompoundExpression — skip
    // Type 11 = ForNode — recurse into children
    if (node.type === 11 && node.children) {
      walkTemplate(node.children, s, baseOffset, extracted);
    }
    // Type 9 = IfNode — recurse into branches
    if (node.type === 9 && node.branches) {
      for (const branch of node.branches) {
        if (branch.children) {
          walkTemplate(branch.children, s, baseOffset, extracted);
        }
      }
    }
  }
}

function extractScriptStrings(scriptContent, s, baseOffset, extracted, isSetup) {
  // Match string literals that look like translatable text in common patterns:
  // - alert('text'), confirm('text')
  // - title: 'text', label: 'text', placeholder: 'text', message: 'text'
  // - toast('text'), notify('text')
  // - error/success/warning message strings

  const patterns = [
    // Function calls: alert('...'), confirm('...'), toast('...'), notify('...')
    /\b(alert|confirm|toast|notify|message\.(?:success|error|warning|info))\s*\(\s*(['"`])((?:(?!\2).)+)\2\s*\)/g,
    // Object properties: title: '...', label: '...', message: '...'
    /\b(title|label|placeholder|message|text|description|tooltip|hint|caption|header|subtitle|errorMessage|successMessage)\s*:\s*(['"`])((?:(?!\2).)+)\2/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(scriptContent)) !== null) {
      const text = match[3];
      if (isTranslatable(text) && text.length > 1) {
        const key = hashKey(text);
        const fullMatchStart = baseOffset + match.index;
        const quoteChar = match[2];
        const textStart = baseOffset + match.index + match[0].indexOf(quoteChar + text);
        const textEnd = textStart + text.length + 2; // +2 for quotes

        const tCall = isSetup ? `t('${key}')` : `this.$t('${key}')`;

        s.overwrite(textStart, textEnd, tCall);
        extracted.push({ key, text, context: 'script' });
      }
    }
  }
}

function isAlreadyWrapped(source, start, end) {
  // Check if the text is already inside a $t() call or {{ $t(...) }}
  const before = source.slice(Math.max(0, start - 20), start);
  return /\$t\s*\(\s*['"]/.test(before) || /t\s*\(\s*['"]/.test(before);
}

function extractTemplateRegex(source, s, extracted) {
  // Fallback regex extraction for when the Vue parser fails
  const textPattern = />([^<]+)</g;
  let match;
  while ((match = textPattern.exec(source)) !== null) {
    const text = match[1].trim();
    if (isTranslatable(text)) {
      const key = hashKey(text);
      const textStart = match.index + 1;
      const textEnd = textStart + match[1].length;
      if (!isAlreadyWrapped(source, textStart, textEnd)) {
        const original = match[1];
        const leadingWs = original.match(/^(\s*)/)[1];
        const trailingWs = original.match(/(\s*)$/)[1];
        s.overwrite(textStart, textEnd, `${leadingWs}{{ $t('${key}') }}${trailingWs}`);
        extracted.push({ key, text, context: 'template-text' });
      }
    }
  }
}