import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PYTHON_SCRIPT = join(__dirname, '..', '..', 'python', 'translator.py');

let cachedPythonCmd = null;

/**
 * Find the correct python command on this system.
 */
async function findPython() {
  if (cachedPythonCmd) return cachedPythonCmd;

  for (const cmd of ['python3', 'python']) {
    try {
      const result = await execSimple(cmd, ['--version']);
      if (result.includes('Python 3')) {
        cachedPythonCmd = cmd;
        return cmd;
      }
    } catch { /* try next */ }
  }
  throw new Error(
    'Python 3 not found. Install Python 3.8+ and ensure it is on your PATH.\n' +
    '  Also install argostranslate: pip install argostranslate'
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
 * Check that Python and argostranslate are available,
 * and that the required language pair is installed.
 */
export async function checkPythonBridge(from, to) {
  const py = await findPython();

  // Check argostranslate is installed and language pair available
  const checkScript = `
import sys, json
try:
    import argostranslate.package
    import argostranslate.translate
except ImportError:
    print(json.dumps({"error": "argostranslate not installed. Run: pip install argostranslate"}))
    sys.exit(0)

from_code = "${from}"
to_code = "${to}"

installed = argostranslate.translate.get_installed_languages()
from_lang = None
to_lang = None
for lang in installed:
    if lang.code == from_code:
        from_lang = lang
    if lang.code == to_code:
        to_lang = lang

if not from_lang or not to_lang:
    available_codes = [l.code for l in installed]
    # Try to auto-download
    try:
        argostranslate.package.update_package_index()
        available_packages = argostranslate.package.get_available_packages()
        pkg = next((p for p in available_packages if p.from_code == from_code and p.to_code == to_code), None)
        if pkg:
            print(json.dumps({"status": "downloading", "pair": f"{from_code}->{to_code}"}))
            argostranslate.package.install_from_path(pkg.download())
            print(json.dumps({"status": "ready"}))
        else:
            print(json.dumps({"error": f"Language pair {from_code}->{to_code} not available. Installed: {available_codes}"}))
    except Exception as e:
        print(json.dumps({"error": f"Failed to download language pair: {str(e)}. Installed: {available_codes}"}))
else:
    print(json.dumps({"status": "ready"}))
`;

  const result = await execSimple(py, ['-c', checkScript]);

  // Parse last JSON line (might have multiple from downloading)
  const lines = result.split('\n').filter(l => l.trim());
  for (const line of lines.reverse()) {
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
 * Sends all strings at once for efficiency (model loads once).
 *
 * @param {Array<{key: string, text: string}>} batch - Strings to translate
 * @param {string} from - Source language code
 * @param {string} to - Target language code
 * @returns {Promise<Object<string, string>>} Map of key -> translated text
 */
export async function translateBatch(batch, from, to) {
  if (batch.length === 0) return {};

  const py = await findPython();

  return new Promise((resolve, reject) => {
    const proc = spawn(py, [PYTHON_SCRIPT, from, to], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    const input = JSON.stringify(batch);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python translator failed (code ${code}): ${stderr}`));
      }

      try {
        // Find the JSON output line (ignore any debug/warning output)
        const lines = stdout.split('\n');
        let result = null;
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith('{') || line.startsWith('[')) {
            try {
              result = JSON.parse(line);
              break;
            } catch { /* try previous line */ }
          }
        }

        if (!result) {
          return reject(new Error(`No valid JSON in Python output: ${stdout.slice(0, 500)}`));
        }

        // Convert array to map
        const map = {};
        if (Array.isArray(result)) {
          for (const item of result) {
            map[item.key] = item.text;
          }
        } else {
          Object.assign(map, result);
        }

        resolve(map);
      } catch (err) {
        reject(new Error(`Failed to parse Python output: ${err.message}\nOutput: ${stdout.slice(0, 500)}`));
      }
    });

    proc.on('error', (err) => reject(new Error(`Failed to spawn Python: ${err.message}`)));

    proc.stdin.write(input);
    proc.stdin.end();
  });
}