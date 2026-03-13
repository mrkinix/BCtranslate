import { createHash } from 'crypto';

/**
 * Generate a readable, slug-based i18n key from a string.
 * "Submit" → "submit"
 * "Please enter your email" → "please_enter_your_email"
 * Falls back to a hash prefix for non-Latin or symbol-only strings.
 */
export function textKey(text) {
  const trimmed = text.trim();

  const slug = trimmed
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')   // punctuation → space
    .replace(/\s+/g, '_')        // spaces → underscores
    .replace(/^[^a-z]+/, '')     // strip non-alpha prefix
    .replace(/[^a-z0-9_]/g, '') // remove remaining non-ASCII
    .replace(/_+/g, '_')         // collapse multiple underscores
    .replace(/^_|_$/g, '')       // trim underscores
    .slice(0, 40)
    .replace(/_+$/, '');

  if (slug && slug.length >= 2 && /[a-z]/.test(slug)) {
    return slug;
  }

  // Fallback: hash (for Chinese, Arabic, emoji, symbols, etc.)
  const hash = createHash('sha256').update(trimmed).digest('hex').slice(0, 8);
  return `key_${hash}`;
}

/**
 * @deprecated Use textKey() instead. Kept for internal backward compat.
 */
export const hashKey = textKey;

/**
 * Determine if a string is "translatable" — contains actual human-readable
 * text rather than whitespace, numbers, symbols, or code identifiers.
 */
export function isTranslatable(text) {
  if (!text || typeof text !== 'string') return false;

  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  // Skip pure whitespace / newlines
  if (/^\s*$/.test(trimmed)) return false;

  // Skip pure numbers
  if (/^[\d.,]+$/.test(trimmed)) return false;

  // Skip single characters that are punctuation/symbols
  if (
    trimmed.length === 1 &&
    /[^a-zA-Z\u00C0-\u024F\u0400-\u04FF\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(trimmed)
  )
    return false;

  // Skip code identifiers (camelCase, snake_case with no spaces)
  if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(trimmed) && !trimmed.includes(' ') && trimmed.length > 1) {
    // Allow capitalised real words: "Submit", "Cancel", "Home"
    if (/[aeiouAEIOU]/.test(trimmed) && trimmed.length > 2 && /^[A-Z][a-z]+$/.test(trimmed)) {
      return true;
    }
    // Allow ALL-CAPS short labels: "OK", "FAQ"
    if (/^[A-Z]{2,12}$/.test(trimmed)) return true;
    return false;
  }

  // Skip URLs, paths, emails
  if (/^(https?:\/\/|\/|\.\/|\.\.\/)/.test(trimmed)) return false;
  if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(trimmed)) return false;

  // Skip pure template expressions {{ something }}
  if (/^\{\{[^}]+\}\}$/.test(trimmed)) return false;

  // Must contain at least one letter from any script
  if (
    !/[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uAC00-\uD7AF]/.test(
      trimmed
    )
  )
    return false;

  return true;
}

/**
 * Shield interpolation variables before sending to Argos Translate.
 * Replaces {{ name }}, {name}, ${name}, %{name} with XML-like tokens <xi/>
 * that NMT models are trained to preserve verbatim.
 *
 * Returns { shielded, tokens } — call unshieldInterpolations() to restore.
 */
export function shieldInterpolations(text) {
  const tokens = [];
  let shielded = text;

  // Vue {{ expr }} — must come first to avoid matching inner {
  shielded = shielded.replace(/\{\{[^}]*\}\}/g, (m) => {
    const i = tokens.length;
    tokens.push(m);
    return `<x${i}/>`;
  });

  // Template literal ${expr}
  shielded = shielded.replace(/\$\{[^}]*\}/g, (m) => {
    const i = tokens.length;
    tokens.push(m);
    return `<x${i}/>`;
  });

  // i18next / vue-i18n {varName} or {0}
  shielded = shielded.replace(/\{[^{}\s][^{}]*\}/g, (m) => {
    const i = tokens.length;
    tokens.push(m);
    return `<x${i}/>`;
  });

  // Ruby / Rails %{varName}
  shielded = shielded.replace(/%\{[^}]+\}/g, (m) => {
    const i = tokens.length;
    tokens.push(m);
    return `<x${i}/>`;
  });

  return { shielded, tokens };
}

/**
 * Restore interpolation variables after translation.
 * Tolerates minor whitespace changes the MT model may introduce.
 */
export function unshieldInterpolations(text, tokens) {
  if (!tokens || tokens.length === 0) return text;
  return text.replace(/<x(\d+)\s*\/>/gi, (_, idx) => tokens[parseInt(idx, 10)] ?? '');
}

/**
 * Check if a string contains interpolation expressions.
 */
export function parseInterpolation(text) {
  const vuePattern = /\{\{\s*([^}]+?)\s*\}\}/g;

  const parts = [];
  let hasInterpolation = false;

  if (vuePattern.test(text)) {
    hasInterpolation = true;
    vuePattern.lastIndex = 0;

    let lastIndex = 0;
    let match;
    while ((match = vuePattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const staticPart = text.slice(lastIndex, match.index);
        if (staticPart.trim()) parts.push({ type: 'static', value: staticPart });
      }
      parts.push({ type: 'expr', value: match[1].trim() });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      const remainder = text.slice(lastIndex);
      if (remainder.trim()) parts.push({ type: 'static', value: remainder });
    }
  }

  return { hasInterpolation, parts };
}
