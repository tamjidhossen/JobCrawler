#!/usr/bin/env python3
"""
List all Google Gemini models available on your API key.
Usage:
    python3 list_models.py
    GEMINI_API_KEY=your_key python3 list_models.py
"""

import os
import sys
import urllib.request
import json

def main():
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()

    if not api_key:
        # Try reading from the .env file in the same project
        env_path = os.path.join(os.path.dirname(__file__), ".env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("GEMINI_API_KEY="):
                        api_key = line.split("=", 1)[1].strip()
                        break

    if not api_key:
        print("ERROR: GEMINI_API_KEY not found in environment or .env file", file=sys.stderr)
        sys.exit(1)

    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"

    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(1)

    models = data.get("models", [])
    if not models:
        print("No models returned.")
        return

    # Print header
    print(f"\n{'─'*70}")
    print(f"  {'MODEL NAME':<45}  {'SUPPORTS'}")
    print(f"{'─'*70}")

    for m in sorted(models, key=lambda x: x.get("name", "")):
        name     = m.get("name", "").replace("models/", "")
        methods  = m.get("supportedGenerationMethods", [])
        supports = ", ".join(methods) if methods else "—"
        print(f"  {name:<45}  {supports}")

    print(f"{'─'*70}")
    print(f"  Total: {len(models)} models\n")

if __name__ == "__main__":
    main()
