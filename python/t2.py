import sys
import json
import os

# Suppress TensorFlow logs
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

try:
    import argostranslate.package
    import argostranslate.translate
except ImportError:
    print(json.dumps({"error": "argostranslate not found. Please run: pip install argostranslate"}), file=sys.stderr)
    sys.exit(1)

def main():
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: python translator.py <from_code> <to_code>"}), file=sys.stderr)
        sys.exit(1)

    from_code = sys.argv[1]
    to_code = sys.argv[2]

    try:
        input_data = sys.stdin.read()
        batch = json.loads(input_data)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON input"}), file=sys.stderr)
        sys.exit(1)

    try:
        # 1. Find the installed languages
        installed_languages = argostranslate.translate.get_installed_languages()
        from_lang = next((lang for lang in installed_languages if lang.code == from_code), None)
        to_lang = next((lang for lang in installed_languages if lang.code == to_code), None)

        if not from_lang or not to_lang:
            # This should ideally be handled by the check in the Node.js bridge,
            # but as a fallback, we report it here too.
            available_codes = [l.code for l in installed_languages]
            print(json.dumps({
                "error": f"Language pair not installed: {from_code}->{to_code}. Installed: {available_codes}"
            }), file=sys.stderr)
            sys.exit(1)

        # 2. Get the translation object
        translation = from_lang.get_translation(to_lang)
        if not translation:
             # This may happen if the translation direction is not supported (e.g., en->en)
            if from_code == to_code:
                # If source and target are the same, just return the original text
                print(json.dumps(batch))
                sys.exit(0)
            else:
                print(json.dumps({"error": f"Translation from {from_code} to {to_code} is not supported by the installed model."}), file=sys.stderr)
                sys.exit(1)


        # 3. Translate texts
        translated_batch = []
        for item in batch:
            original_text = item.get('text', '')
            translated_text = translation.translate(original_text)
            translated_batch.append({
                "key": item.get('key'),
                "text": translated_text
            })

        # 4. Output the result as a JSON array
        print(json.dumps(translated_batch, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"error": f"An unexpected error occurred: {str(e)}"}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
