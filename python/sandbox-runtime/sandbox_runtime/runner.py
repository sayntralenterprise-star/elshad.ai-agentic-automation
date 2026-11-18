"""CLI entrypoint invoked by Node ToolGateway SandboxRunner."""

from __future__ import annotations

import json
import sys

from sandbox_runtime import execute_sandboxed_python


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw or "{}")
        code = str(payload.get("code", ""))
        inputs = payload.get("inputs") if isinstance(payload.get("inputs"), dict) else {}
        output = execute_sandboxed_python(code, inputs=inputs)
        sys.stdout.write(json.dumps(output))
        return 0
    except Exception as exc:  # noqa: BLE001
        sys.stdout.write(
            json.dumps({
                "ok": False,
                "error_type": type(exc).__name__,
                "error": str(exc),
            })
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
