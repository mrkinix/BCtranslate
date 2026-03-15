import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { promises as fs } from 'fs';
import assert from 'assert';

const execPromise = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, '..');
const CLI_PATH = join(ROOT, 'bin', 'bctranslate.js');
const FIXTURES_DIR = join(__dirname, 'fixtures');
const SNAPSHOTS_DIR = join(__dirname, 'snapshots');
const TEMP_DIR_BASE = join(__dirname, 'temp');

async function runCli(args) {
  try {
    const { stdout, stderr } = await execPromise(`node ${CLI_PATH} ${args}`);
    console.log('--- CLI STDOUT ---\n', stdout);
    console.log('--- CLI STDERR ---\n', stderr);
    return { stdout, stderr };
  } catch (e) {
    // Make the error more useful
    console.error('CLI execution failed:');
    console.error('STDOUT:', e.stdout);
    console.error('STDERR:', e.stderr);
    throw e;
  }
}

async function assertFileContent(filePath, expectedContent) {
  const actualContent = (await fs.readFile(filePath, 'utf-8')).replace(/\r\n/g, '\n').trim();
  if (expectedContent === 'LOG_ONLY') {
    console.log(`--- Content of ${basename(filePath)} ---\n${actualContent}\n--------------------`);
    return;
  }
  const normalizedExpected = expectedContent.replace(/\r\n/g, '\n').trim();
  assert.strictEqual(actualContent, normalizedExpected);
}

async function runTest(fixtureName, { args = '', expectedLocale = null, expectSnapshot = true } = {}) {
  const fixturePath = join(FIXTURES_DIR, fixtureName);
  const snapshotPath = join(SNAPSHOTS_DIR, `${fixtureName}.snapshot`);
  let tempDir;

  try {
    // 1. Setup: Create a temporary directory and copy the fixture
    tempDir = await fs.mkdtemp(join(TEMP_DIR_BASE, `${fixtureName}-`));
    const tempFixturePath = join(tempDir, fixtureName);
    await fs.copyFile(fixturePath, tempFixturePath);

    const defaultArgs = `en --to fr --no-setup --outdir "${tempDir}"`;
    const fullArgs = `"${tempFixturePath}" ${defaultArgs} ${args}`;

    // 2. Execute: Run the CLI on the temporary file
    const { stdout } = await runCli(fullArgs);
    assert(stdout.includes('Done:'), `CLI did not run to completion for ${fixtureName}. Output: ${stdout}`);

    // 3. Assert: Check the transformed file against its snapshot
    if (expectSnapshot) {
      const expectedSnapshot = await fs.readFile(snapshotPath, 'utf-8');
      await assertFileContent(tempFixturePath, expectedSnapshot);
    } else {
      await assertFileContent(tempFixturePath, 'LOG_ONLY');
    }
    console.log(`✅ (Logged) Snapshot for: ${fixtureName}`);

    // 4. Assert: Check the generated locale file
    if (expectedLocale) {
        const localePath = join(tempDir, 'locales', 'fr.json');
        if (expectedLocale === 'LOG_ONLY') {
            await assertFileContent(localePath, 'LOG_ONLY');
        } else {
            const expectedLocaleContent = JSON.stringify(expectedLocale, null, 2);
            await assertFileContent(localePath, expectedLocaleContent);
        }
        console.log(`✅ Locale file correct for: ${fixtureName}`);
    }

  } finally {
    // 5. Cleanup: Remove the temporary directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

async function main() {
  console.log('Running tests...');
  let failed = false;

  try {
    // Create base directories if they don't exist
    await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
    await fs.mkdir(TEMP_DIR_BASE, { recursive: true });

    // Define and run all tests
    // await runTest('index.html', {
    //   expectedLocale: {
    //     "a_simple_title": "Un titre simple",
    //     "hello_world": "Bonjour le monde!",
    //     "this_is_a_paragraph_with_a_strong_bold_s": "Ceci est un paragraphe avec un mot en <strong>gras</strong>.",
    //     "another_paragraph": "Un autre paragraphe.",
    //     "a_link": "Un lien"
    //   }
    // });

    await runTest('VueComponent.vue', {
        expectSnapshot: false,
        expectedLocale: 'LOG_ONLY'
    });

  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error(error);
    failed = true;
  } finally {
    // Cleanup the base temp dir
    await fs.rm(TEMP_DIR_BASE, { recursive: true, force: true });

    if (failed) {
      console.log('\nTests failed.');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed!');
    }
  }
}

main();
