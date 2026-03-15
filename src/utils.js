import { createHash } from 'crypto';
import { basename, extname } from 'path';

// Words too generic to use as the sole semantic component of a key
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could',
  'to', 'for', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'by',
  'as', 'if', 'its', 'it', 'this', 'that', 'these', 'those',
  'my', 'your', 'our', 'their', 'with', 'from', 'up', 'about',
  'no', 'not', 'so',
]);

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
 * Generate a context-aware i18n key using the component name as namespace
 * and key content words as the slug.
 *
 * "Notes"           in HomeView.vue  → home.notes
 * "Quick Note"      in HomeView.vue  → home.quickNote
 * "View livestock"  in HomeView.vue  → home.viewLivestock
 * "Submit"          in LoginForm.vue → loginForm.submit
 * "你好"             in App.vue       → app.key_3d2a1f
 *
 * @param {string} text     The source string to key
 * @param {string} filePath Absolute or relative path of the source file
 */
export function contextKey(text, filePath) {
  const trimmed = text.trim();

  // ── Namespace: derive from filename ──────────────────────────────────────
  const fileName = basename(filePath, extname(filePath));
  // Strip common Vue/React suffixes: HomeView → Home, UserCard → User, etc.
  const stripped = fileName.replace(
    /(?:View|Component|Page|Screen|Modal|Dialog|Card|Panel|Widget|Layout|Container)$/,
    ''
  ) || fileName;
  // camelCase namespace: "UserProfile" → "userProfile", "home" → "home"
  const ns = stripped[0].toLowerCase() + stripped.slice(1);

  // ── Slug: 1-3 meaningful words in camelCase ───────────────────────────────
  const words = trimmed
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 2 && /[a-z]/.test(w) && !STOP_WORDS.has(w));

  if (!words.length) {
    // Non-Latin scripts, emoji, or all stop words — fall back to hash suffix
    const hash = createHash('sha256').update(trimmed).digest('hex').slice(0, 6);
    return `${ns}.key${hash}`;
  }

  const slug =
    words[0] + words.slice(1, 3).map((w) => w[0].toUpperCase() + w.slice(1)).join('');

  return `${ns}.${slug}`;
}

/**
 * @deprecated Use contextKey() for new code. textKey() kept for non-file contexts.
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
