# bctranslate ⚡

`bctranslate` is a command-line tool to automatically transform source code into an i18n-ready format. It extracts hardcoded strings from your files, replaces them with calls to a translation function, and generates locale files with translations powered by [Argos Translate](https://www.argosopentech.com/).

It's designed to be a quick and easy way to "bake in" internationalization into a project with minimal refactoring.

## Features

- **Automatic String Extraction:** Finds and extracts hardcoded strings from various file types.
- **Code Transformation:** Replaces extracted strings with i18n function calls (e.g., `t('key')`).
- **Machine Translation:** Uses Python and Argos Translate to provide instant translations for extracted strings.
- **Project-Aware:** Automatically detects project types (Vue, React, Vanilla JS/HTML) to apply the correct parsing and transformation rules.
- **Framework Support:**
    - Vue (`.vue`, `.js`, `.ts`)
    - React (`.jsx`, `.tsx`, `.js`, `.ts`)
    - Vanilla JS and HTML
    - JSON (`.json`)
- **Dry Run Mode:** Preview all changes without modifying any files.

## Prerequisites

1.  **Node.js:** Requires Node.js version 18.0.0 or higher.
2.  **Python:** Requires Python 3.8 or higher.
3.  **Argos Translate:** The `argostranslate` Python package must be installed.
    ```sh
    pip install argostranslate
    ```

## Installation

You can install `bctranslate` globally via npm:

```sh
npm install -g .
```

This will make the `bctranslate` command available in your terminal.

## Usage

The most common use case is to run `bctranslate` in the root of your project to automatically detect and process all relevant files.

```sh
bctranslate
```

### Command-Line Options

```
bctranslate [file] [from] [options]
```

**Arguments:**

-   `[file]`: (Optional) A specific file or glob pattern to process. If omitted, the tool auto-detects files based on the project type.
-   `[from]`: (Optional) The source language code for translation (default: `en`).

**Options:**

| Option                 | Description                                                                  | Default    |
| ---------------------- | ---------------------------------------------------------------------------- | ---------- |
| `-t, --to <lang>`      | Target language code for translation.                                        | `fr`       |
| `-d, --dry-run`        | Preview changes without writing to files.                                    | `false`    |
| `-o, --outdir <dir>`   | Output directory for new locale files (default: in-place).                   |            |
| `--no-setup`           | Skip the generation of i18n setup files (e.g., `i18n.js`).                    |            |
| `--json-mode <mode>`   | For `.json` files, translate `values` or the `full` file structure.          | `values`   |
| `-v, --verbose`        | Enable verbose logging for debugging.                                        | `false`    |
| `-h, --help`           | Display help for the command.                                                |            |

### Examples

**Auto-translate a whole project from English to French:**

```sh
bctranslate --to fr
```

**Translate a single HTML file from English to Spanish:**

```sh
bctranslate "src/index.html" en -t es
```

**Preview changes for all Vue files without modifying them:**

```sh
bctranslate "src/**/*.vue" --dry-run
```
