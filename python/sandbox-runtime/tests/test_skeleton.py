import pytest

from sandbox_runtime import PACKAGE_NAME, SLICE_TARGET, execute_sandboxed_python


def test_sandbox_runtime_skeleton() -> None:
    assert PACKAGE_NAME == "sandbox-runtime"
    assert SLICE_TARGET == "S0.3"


def test_sandbox_executes_pure_math_and_blocks_imports() -> None:
    res = execute_sandboxed_python(
        "result = math.sqrt(inputs['x']) + sum([1, 2, 3])\nprint('done')",
        inputs={"x": 16},
    )
    assert res["ok"] is True
    assert res["result"] == 10.0
    assert res["stdout"].strip() == "done"

    with pytest.raises(PermissionError):
        execute_sandboxed_python("import os\nresult = os.environ")

    with pytest.raises(PermissionError):
        execute_sandboxed_python("open('/etc/passwd').read()")
