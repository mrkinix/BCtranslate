import MagicString from 'magic-string';
import { parse, NodeTypes } from '@vue/compiler-dom';
import { textKey, isTranslatable } from '../utils.js';

const ATTR_WHITELIST = new Set([
  'title',
  'placeholder',
  'label',
  'alt',
  'aria-label',
  'aria-placeholder',
  'aria-description',
]);

const CONTENT_TAGS = new Set([
  'title',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'a',
  'button',
  'label',
  'option',
  'li',
  'th',
  'td',
]);

const SKIP_TAGS = new Set(['script', 'style', 'noscript']);

function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse an HTML file and extract translatable strings.
 * For vanilla HTML, we use data-i18n attributes instead of $t() calls.
 */
export function parseHtml(source, filePath, project) {
  const extracted = [];
  const s = new MagicString(source);

  const ast = parse(source, { comments: false });

  function visit(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }

    if (node.type === NodeTypes.ROOT) {
      visit(node.children);
      return;
    }

    if (node.type !== NodeTypes.ELEMENT) return;

    const tag = (node.tag || '').toLowerCase();
    if (SKIP_TAGS.has(tag)) return;

    const openTagEnd = source.indexOf('>', node.loc.start.offset);
    if (openTagEnd < 0 || openTagEnd > node.loc.end.offset) {
      visit(node.children);
      return;
    }

    const openTagText = source.slice(node.loc.start.offset, openTagEnd);

    // 1) Extract translatable attributes
    for (const prop of node.props || []) {
      if (prop.type !== NodeTypes.ATTRIBUTE) continue;
      const name = prop.name;
      if (!ATTR_WHITELIST.has(name)) continue;
      const value = prop.value?.content;
      if (!value || !isTranslatable(value)) continue;

      const marker = `data-i18n-${name}`;
      if (openTagText.includes(marker)) continue;

      const key = textKey(value);
      s.appendRight(prop.loc.end.offset, ` ${marker}="${key}"`);
      extracted.push({ key, text: value, context: `html-attr-${name}` });
    }

    // 2) Extract element inner HTML for common content tags
    if (CONTENT_TAGS.has(tag) && !node.isSelfClosing) {
      const closeRel = node.loc.source.lastIndexOf('</');
      if (closeRel > -1) {
        const closeTagStart = node.loc.start.offset + closeRel;
        const innerHtml = source.slice(openTagEnd + 1, closeTagStart);
        const text = innerHtml.trim();
        const plain = stripTags(text);

        const marker = tag === 'title' ? 'data-i18n-title' : 'data-i18n';
        if (!openTagText.includes(marker) && isTranslatable(plain)) {
          const key = textKey(text);
          s.appendLeft(openTagEnd, ` ${marker}="${key}"`);
          extracted.push({ key, text, context: `html-inner-${tag}` });
        }
      }
    }

    visit(node.children);
  }

  visit(ast);

  return {
    source: extracted.length > 0 ? s.toString() : source,
    extracted,
    modified: extracted.length > 0,
  };
}
