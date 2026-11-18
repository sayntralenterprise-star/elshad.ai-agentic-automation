"""Sandbox code execution runtime for Slice S0.3 [E0.3-5, ADR-0008]."""

from __future__ import annotations

import ast
import io
import json
import math
import statistics
import contextlib
from typing import Any

PACKAGE_NAME = "sandbox-runtime"
SLICE_TARGET = "S0.3"

BLOCKED_BUILTINS = frozenset({
    "__import__",
    "compile",
    "delattr",
    "dir",
    "eval",
    "exec",
    "globals",
    "input",
    "locals",
    "open",
    "vars",
})

BLOCKED_MODULES = frozenset({
    "ctypes",
    "http",
    "importlib",
    "os",
    "pathlib",
    "shutil",
    "socket",
    "subprocess",
    "sys",
    "urllib",
})

SAFE_BUILTINS: dict[str, Any] = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "filter": filter,
    "float": float,
    "int": int,
    "isinstance": isinstance,
    "len": len,
    "list": list,
    "map": map,
    "max": max,
    "min": min,
    "pow": pow,
    "range": range,
    "round": round,
    "set": set,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
}


def validate_python_ast(source: str) -> None:
    """Reject imports, dunder attribute escapes, and dangerous calls before execution."""
    tree = ast.parse(source, mode="exec")
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise PermissionError("Import statements are disabled in the Python sandbox.")
        if isinstance(node, ast.Name) and (
            node.id in BLOCKED_BUILTINS or node.id in BLOCKED_MODULES or node.id.startswith("__")
        ):
            raise PermissionError(f"Access to restricted identifier '{node.id}' is denied.")
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise PermissionError(f"Access to dunder attribute '{node.attr}' is denied.")


def execute_sandboxed_python(
    code: str,
    inputs: dict[str, Any] | None = None,
    max_output_bytes: int = 65_536,
) -> dict[str, Any]:
    """Execute validated Python snippet with strict builtins and captured stdout."""
    validate_python_ast(code)
    stdout_buf = io.StringIO()
    local_env: dict[str, Any] = {
        "inputs": inputs or {},
        "json": json,
        "math": math,
        "statistics": statistics,
        "result": None,
    }

    def safe_print(*args: Any, **kwargs: Any) -> None:
        text = " ".join(str(a) for a in args) + kwargs.get("end", "\n")
        if stdout_buf.tell() + len(text.encode("utf-8")) > max_output_bytes:
            raise MemoryError("Sandbox stdout exceeded 64 KB limit.")
        stdout_buf.write(text)

    safe_builtins = dict(SAFE_BUILTINS)
    safe_builtins["print"] = safe_print

    compiled = compile(code, "<sandbox>", "exec")
    with contextlib.redirect_stdout(stdout_buf):
        exec(compiled, {"__builtins__": safe_builtins}, local_env)

    return {
        "ok": True,
        "stdout": stdout_buf.getvalue(),
        "result": local_env.get("result"),
    }
