import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { shieldInterpolations, unshieldInterpolations } from '../utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PYTHON_SCRIPT = join(__dirname, '..', '..', 'python', 'translator.py');

let cachedPythonCmd = null;

async function findPython() {
  if (cachedPythonCmd) return cachedPythonCmd;
  for (const cmd of ['python3', 'python']) {
    try {
      const out = await execSimple(cmd, ['--version']);
      if (out.includes('Python 3')) {
        cachedPythonCmd = cmd;
        return cmd;
      }
    } catch { /* try next */ }
  }
  throw new Error(
    'Python 3 not found. Install Python 3.8+ and add it to your PATH.\n' +
    '  Then run: pip install argostranslate'
  );
}

function execSimple(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err || `Process exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

/**
 * Install argostranslate via pip.
 * Called from `init` and from checkPythonBridge when the package is missing.
 */
export async function installArgostranslate() {
  const py = await findPython();
  return execSimple(py, ['-m', 'pip', 'install', '--quiet', 'argostranslate']);
}

/**
 * Check Python + argostranslate availability and download the language pair
 * model if not already installed.
 */
export async function checkPythonBridge(from, to) {
  const py = await findPython();

  const checkScript = `
import sys, json
try:
    import argostranslate.package
    import argostranslate.translate
except ImportError:
    print(json.dumps({"error": "argostranslate not installed. Run: pip install argostranslate"}))
    sys.exit(0)

from_code = "${from}"
to_code   = "${to}"

installed = argostranslate.translate.get_installed_languages()
from_lang = next((l for l in installed if l.code == from_code), None)
to_lang   = next((l for l in installed if l.code == to_code),   None)

if from_lang and to_lang and from_lang.get_translation(to_lang):
    print(json.dumps({"status": "ready"}))
else:
    try:
        argostranslate.package.update_package_index()
        available = argostranslate.package.get_available_packages()
        pkg = next((p for p in available if p.from_code == from_code and p.to_code == to_code), None)
        if pkg:
            print(json.dumps({"status": "downloading", "pair": f"{from_code}->{to_code}"}))
            argostranslate.package.install_from_path(pkg.download())
            print(json.dumps({"status": "ready"}))
        else:
            available_codes = [l.code for l in installed]
            print(json.dumps({"error": f"Language pair {from_code}->{to_code} not available. Installed: {available_codes}"}))
    except Exception as e:
        print(json.dumps({"error": f"Failed to download language pair: {str(e)}"}))
`;

  const result = await execSimple(py, ['-c', checkScript]);

  const lines = result.split('\n').filter((l) => l.trim());
  for (const line of [...lines].reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.status === 'ready') return true;
    } catch (e) {
      if (e.message && !e.message.includes('Unexpected')) throw e;
    }
  }
  return true;
}

/**
 * Translate a batch of strings using argostranslate via Python.
 *
 * Interpolation variables like {{ name }}, {count}, ${val} are shielded
 * before sending and restored after — Argos never sees them.
 *
 * @param {Array<{key: string, text: string}>} batch
 * @param {string} from  Source language code
 * @param {string} to    Target language code
 * @returns {Promise<Record<string, string>>}  key → translated text
 */
export async function translateBatch(batch, from, to) {
  if (batch.length === 0) return {};

  const py = await findPython();

  // ── Shield interpolations so Argos never mangles {name} / {{ expr }} ────────
  const shielded = batch.map((item) => {
    const { shielded: text, tokens } = shieldInterpolations(item.text);
    return { key: item.key, text, tokens };
  });

  return new Promise((resolve, reject) => {
    const proc = spawn(py, [PYTHON_SCRIPT, from, to], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    const input = JSON.stringify(shielded.map(({ key, text }) => ({ key, text })));
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python translator failed (code ${code}): ${stderr}`));
      }

      try {
        // Find the JSON output line (skip debug/warning lines)
        const lines = stdout.split('\n');
        let raw = null;
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith('[') || line.startsWith('{')) {
            try { raw = JSON.parse(line); break; } catch { /* try previous */ }
          }
        }

        if (!raw) {
          return reject(new Error(`No valid JSON in Python output: ${stdout.slice(0, 500)}`));
        }

        // Convert array → map, then unshield interpolations
        const rawMap = {};
        if (Array.isArray(raw)) {
          for (const item of raw) rawMap[item.key] = item.text;
        } else {
          Object.assign(rawMap, raw);
        }

        const result = {};
        for (const { key, tokens } of shielded) {
          const translated = rawMap[key] ?? batch.find((b) => b.key === key)?.text ?? '';
          result[key] = unshieldInterpolations(translated, tokens);
        }

        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse Python output: ${err.message}\nOutput: ${stdout.slice(0, 500)}`));
      }
    });

    proc.on('error', (err) => reject(new Error(`Failed to spawn Python: ${err.message}`)));

    proc.stdin.write(input);
    proc.stdin.end();
  });
}
