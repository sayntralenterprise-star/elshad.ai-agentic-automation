from elshad_sdk import API_VERSION, PACKAGE_NAME


def test_sdk_py_skeleton() -> None:
    assert PACKAGE_NAME == "sdk-py"
    assert API_VERSION == "v1"
