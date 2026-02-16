import json
import sys


def main():
    raw = sys.stdin.read()
    if not raw:
        print(json.dumps({"error": "No input provided"}))
        return
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON payload"}))
        return

    method = payload.get("method")
    print(
        json.dumps(
            {
                "error": f"AI bridge not configured for method '{method}'. "
                "Provide a custom bridge via STUDIO_AI_BRIDGE.",
            }
        )
    )


if __name__ == "__main__":
    main()

