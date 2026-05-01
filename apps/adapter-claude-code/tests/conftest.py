"""
pytest configuration for adapter-claude-code tests.

Fixtures directory: tests/fixtures/<hook_name>.json
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> dict:
    """Load a hook payload fixture by hook event name (e.g. 'PreToolUse')."""
    path = FIXTURES_DIR / f"{name}.json"
    with open(path) as fh:
        return json.load(fh)


@pytest.fixture
def fixture_loader():
    return load_fixture
