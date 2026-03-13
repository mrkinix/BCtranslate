import { createHash } from 'crypto';

/**
 * Generate a deterministic, short key from a string.
 * Same input always produces the same key — idempotent across runs.
 */
export function hashKey(text) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  return `key_${hash}`;
}

/**
 * Determine if a string is "translatable" — i.e. it contains actual
 * human-readable text and not just whitespace, numbers, symbols, or code.
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
  if (trimmed.length === 1 && /[^a-zA-Z\u00C0-\u024F\u0400-\u04FF\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(trimmed)) return false;

  // Skip things that look like code identifiers (camelCase, snake_case with no spaces)
  if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(trimmed) && !trimmed.includes(' ') && trimmed.length > 1) {
    // But allow single real words (check if it has vowels or is a common word)
    if (/[aeiouAEIOU]/.test(trimmed) && trimmed.length > 2 && /^[A-Z][a-z]+$/.test(trimmed)) {
      return true; // Likely a real word like "Submit", "Cancel", "Home"
    }
    // Allow ALL CAPS short words (likely labels)
    if (/^[A-Z]{2,12}$/.test(trimmed)) return true;
    return false;
  }

  // Skip URLs, paths, emails
  if (/^(https?:\/\/|\/|\.\/|\.\.\/)/.test(trimmed)) return false;
  if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(trimmed)) return false;

  // Skip template expressions that are purely code ({{ something }})
  if (/^\{\{[^}]+\}\}$/.test(trimmed)) return false;

  // Must contain at least one letter from any script
  if (!/[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uAC00-\uD7AF]/.test(trimmed)) return false;

  return true;
}

/**
 * Check if a string contains interpolation expressions ({{ }}, {}, ${}).
 * Returns the parts if so.
 */
export function parseInterpolation(text) {
  // Vue-style {{ expr }}
  const vuePattern = /\{\{\s*([^}]+?)\s*\}\}/g;
  // React/JS-style {expr} or ${expr}
  const jsPattern = /\$?\{([^}]+)\}/g;

  const parts = [];
  let hasInterpolation = false;

  // Check for Vue interpolation
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
