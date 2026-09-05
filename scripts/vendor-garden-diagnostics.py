"""Copy the pinned upstream doctor implementation, without installing it at chat time."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import runpy

copy_content = runpy.run_path(str(Path(__file__).with_name("import-garden-experts.py")))["copy_content"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    copy_content(args.source / "agent_reach", args.output / "vendor" / "agent_reach")
    copy_content(args.source / "LICENSE", args.output / "AGENT-REACH-LICENSE")
    files = {p.relative_to(args.output).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in sorted((args.output / "vendor").rglob("*.py"))}
    (args.output / "agent-reach-provenance.json").write_text(json.dumps({
        "repository": "https://github.com/Panniantong/Agent-Reach", "license": "MIT",
        "commit": subprocess.check_output(["git", "-C", str(args.source), "rev-parse", "HEAD"], text=True).strip(),
        "files": files}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
