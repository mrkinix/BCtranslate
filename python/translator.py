#!/usr/bin/env python3
"""
bctranslate Python worker — translates a batch of strings using argostranslate.

Usage: python translator.py <from_code> <to_code>
  Reads JSON array from stdin: [{"key": "t_abc123", "text": "Hello"}, ...]
  Writes JSON array to stdout: [{"key": "t_abc123", "text": "Bonjour"}, ...]
"""

import sys
import json

def ensure_model(from_code, to_code):
    """Ensure the translation model is installed, downloading if needed."""
    import argostranslate.package
    import argostranslate.translate

    installed_languages = argostranslate.translate.get_installed_languages()
    from_lang = next((l for l in installed_languages if l.code == from_code), None)
    to_lang = next((l for l in installed_languages if l.code == to_code), None)

    if from_lang and to_lang:
        translation = from_lang.get_translation(to_lang)
        if translation:
            return translation

    # Try to install the package
    print(f"Downloading language model {from_code}->{to_code}...", file=sys.stderr)
    argostranslate.package.update_package_index()
    available = argostranslate.package.get_available_packages()
    pkg = next(
        (p for p in available if p.from_code == from_code and p.to_code == to_code),
        None
    )

    if not pkg:
        print(
            json.dumps({"error": f"No package available for {from_code}->{to_code}"}),
            file=sys.stderr
        )
        sys.exit(1)

    argostranslate.package.install_from_path(pkg.download())

    # Reload
    installed_languages = argostranslate.translate.get_installed_languages()
    from_lang = next((l for l in installed_languages if l.code == from_code), None)
    to_lang = next((l for l in installed_languages if l.code == to_code), None)

    if not from_lang or not to_lang:
        print(json.dumps({"error": "Failed to load model after install"}), file=sys.stderr)
        sys.exit(1)

    return from_lang.get_translation(to_lang)


def main():
    if len(sys.argv) != 3:
        print("Usage: translator.py <from_code> <to_code>", file=sys.stderr)
        sys.exit(1)

    from_code = sys.argv[1]
    to_code = sys.argv[2]

    # Load model once
    try:
        translator = ensure_model(from_code, to_code)
    except Exception as e:
        print(json.dumps({"error": f"Model loading failed: {str(e)}"}), file=sys.stderr)
        sys.exit(1)

    # Read batch from stdin
    try:
        raw = sys.stdin.read()
        batch = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {str(e)}"}), file=sys.stderr)
        sys.exit(1)

    # Translate each item
    results = []
    for item in batch:
        key = item.get("key", "")
        text = item.get("text", "")

        if not text.strip():
            results.append({"key": key, "text": text})
            continue

        try:
            translated = translator.translate(text)
            results.append({"key": key, "text": translated})
        except Exception as e:
            # On error, preserve original
            print(f"Warning: failed to translate '{text[:50]}': {e}", file=sys.stderr)
            results.append({"key": key, "text": text})

    # Output result as JSON to stdout
    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()