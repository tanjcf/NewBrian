"""Read-only, bounded BRAIN adapter for the real Agent Reach doctor."""
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import types

sys.path.insert(0, str(Path(__file__).parent / "vendor"))


def _ensure_rich_markup():
    # Upstream doctor imports rich only to format its console report; check_all never uses it,
    # and rich is not vendored or guaranteed on the user's Python.
    try:
        import rich.markup  # noqa: F401
    except ImportError:
        markup = types.ModuleType("rich.markup")
        markup.escape = lambda text: str(text).replace("[", "\\[")
        rich = types.ModuleType("rich")
        rich.markup = markup
        sys.modules.setdefault("rich", rich)
        sys.modules["rich.markup"] = markup


def diagnose():
    _ensure_rich_markup()
    import agent_reach.doctor as doctor
    from agent_reach.channels import get_channel
    from agent_reach.config import Config
    # N1 enables only these two channels, avoiding cookie probes and unrelated network calls.
    doctor.get_all_channels = lambda: [get_channel("github"), get_channel("web")]
    results = doctor.check_all(Config(read_only=True))
    # Upstream web.check is a constant OK; it does not prove network connectivity.
    results["web"]["status"] = "unverified"
    results["web"]["message"] = "Jina Reader 适配器已加载；尚未验证网络读取。"
    return {"schemaVersion": 1, "checkedAt": datetime.now(timezone.utc).isoformat(), "channels": results}


if __name__ == "__main__":
    try:
        print(json.dumps(diagnose(), ensure_ascii=False))
    except ImportError as error:
        print(json.dumps({"error": "REACH_DEPENDENCY_MISSING", "dependency": error.name}))
        sys.exit(2)
