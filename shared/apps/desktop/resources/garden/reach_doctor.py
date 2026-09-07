"""Read-only, bounded BRAIN adapter for the real Agent Reach doctor."""
import json
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent / "vendor"))


def diagnose():
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
