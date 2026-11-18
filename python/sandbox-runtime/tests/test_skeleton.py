from sandbox_runtime import PACKAGE_NAME, SLICE_TARGET


def test_sandbox_runtime_skeleton() -> None:
    assert PACKAGE_NAME == "sandbox-runtime"
    assert SLICE_TARGET == "S0.3"
