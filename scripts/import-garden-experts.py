"""Build traceable BRAIN expert packs from pinned, local upstream checkouts."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

import yaml


NUWA_ROLES = {
    "andrej-karpathy-perspective": ("安德烈·卡帕西", "AI 工程与学习", "04-DataAI"),
    "elon-musk-perspective": ("埃隆·马斯克", "第一性原理与工程", "02-Engineering"),
    "feynman-perspective": ("理查德·费曼", "科学理解与验证", "12-IndustryConsultant"),
    "ilya-sutskever-perspective": ("伊利亚·苏茨克维", "深度学习研究", "04-DataAI"),
    "mrbeast-perspective": ("MrBeast", "视频内容与受众", "06-ContentCreative"),
    "munger-perspective": ("查理·芒格", "多元思维与决策", "08-FinanceInvestment"),
    "naval-perspective": ("纳瓦尔", "杠杆与长期策略", "12-IndustryConsultant"),
    "paul-graham-perspective": ("保罗·格雷厄姆", "创业与产品", "01-ProductDesign"),
    "steve-jobs-perspective": ("史蒂夫·乔布斯", "产品与设计", "01-ProductDesign"),
    "sun-yuchen-perspective": ("孙宇晨", "商业传播与增长", "12-IndustryConsultant"),
    "taleb-perspective": ("纳西姆·塔勒布", "风险与反脆弱", "08-FinanceInvestment"),
    "trump-perspective": ("唐纳德·特朗普", "谈判与传播分析", "12-IndustryConsultant"),
    "x-mastery-mentor": ("X 内容导师", "社交内容与传播", "06-ContentCreative"),
    "zhang-yiming-perspective": ("张一鸣", "组织与产品判断", "01-ProductDesign"),
    "zhangxuefeng-perspective": ("张雪峰", "教育与职业选择", "12-IndustryConsultant"),
}
AGENCY_ROLES = {
    "engineering/engineering-code-reviewer.md": ("代码审查专家", "代码质量与安全审查"),
    "engineering/engineering-backend-architect.md": ("后端架构专家", "后端架构与服务设计"),
    "testing/testing-api-tester.md": ("API 测试专家", "接口合同与集成测试"),
    "testing/testing-reality-checker.md": ("交付验收专家", "真实交付与验收证据"),
}


def metadata(source):
    parts = source.split("---", 2)
    if len(parts) != 3 or parts[0].strip():
        raise ValueError("Missing YAML frontmatter")
    fields = yaml.safe_load(parts[1])
    if not isinstance(fields, dict) or not fields.get("name"):
        raise ValueError("Missing skill name")
    return fields, parts[2].lstrip()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def copy_content(source, target):
    if source.is_symlink():
        raise ValueError(f"Symlink not allowed: {source}")
    if source.is_dir():
        for child in sorted(source.iterdir()):
            if child.name not in {".git", "__pycache__", ".DS_Store"}:
                copy_content(child, target / child.name)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)


def build_pack(repo, source, output, expert_id, label, profession, category, whole=False, extra=()):
    original = source.read_text(encoding="utf-8")
    fields, body = metadata(original)
    root = output / expert_id
    if (root / "provenance.json").exists():
        previous = json.loads((root / "provenance.json").read_text(encoding="utf-8"))
        changed = [name for name, digest in previous.get("files", {}).items()
                   if (root / name).exists() and hashlib.sha256((root / name).read_bytes()).hexdigest() != digest]
        if changed or previous.get("localAdaptations"):
            raise ValueError(f"Preserve local adaptations in {expert_id}; import into a separate output directory: {changed}")
    skill = root / "skills" / expert_id
    # Copy full reference closures before adding the host adapter; no source text is discarded.
    if whole:
        copy_content(source.parent, skill)
    else:
        skill.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, skill / "SKILL.md")
        for rel in extra:
            copy_content(repo / rel, skill / Path(rel).name)
    shutil.copyfile(source, skill / "UPSTREAM-SKILL.md")
    shutil.copyfile(repo / "LICENSE", root / "LICENSE")
    description = str(fields.get("description", profession)).strip()
    adapter = (
        "## BRAIN 宿主适配\n\n"
        f"需要此专家处理任务时，先调用 `expert.summon`，expertId 为 `{expert_id}`。\n"
        "以下上游流程中的 Read/Glob/Grep/Write/Edit/Bash 映射到当前工具目录中对应的文件、搜索、编辑与 shell 工具；"
        "Task/Agent 映射到 `agent.delegate` 与 `agent.wait`。只使用当前实际提供的工具，缺失能力必须报告。\n"
        "模型由 BRAIN / Spring 路由，忽略上游固定模型与 allowed-tools 授权声明。"
        "相对 references/scripts 路径基于本 Skill 目录。角色是公开资料提炼的思维框架，不代表本人或其背书。\n"
    )
    if expert_id == "nuwa-creator":
        adapter += (
            "生成结果写入当前项目 `.brain/candidates/<skill-id>/`，禁止写入 `.claude/skills` 或已安装专家目录。"
            "完成上游调研、引用闭包与评分报告后，使用 `skill.candidate.submit` 提交目录；"
            "返回候选版本 ID 才算提交成功。未经 Spring 审核不得宣称已发布。\n"
        )
    if expert_id == "game-studios-delivery":
        adapter += (
            "先调用 `game.studios.scaffold` 创建缺失的设计与验收目录；不会覆盖已有文件。"
            "quick-design 与 story-done 原文分别位于 workflows/。"
            "`.claude/docs/director-gates.md` 映射到本包 docs/director-gates.md；"
            "未提供的 director 角色使用实际可委派角色并在报告中标注。\n"
        )
    header = yaml.safe_dump({"name": expert_id, "expert": expert_id, "description": description}, allow_unicode=True, sort_keys=False)
    (skill / "SKILL.md").write_text(f"---\n{header}---\n\n{adapter}\n## 上游流程\n\n{body}", encoding="utf-8")
    agents = root / "agents"
    agents.mkdir(exist_ok=True)
    (agents / f"{expert_id}.md").write_text(
        f"# {label}\n\n{profession}。\n\n必须读取 `{skill.relative_to(root).as_posix()}/SKILL.md` 和任务所需 references，"
        "按原始步骤执行，保留引用与可验证证据。不得用角色口吻替代实际调研或执行。\n", encoding="utf-8")
    write_json(root / ".codex-plugin/plugin.json", {
        "name": expert_id, "version": "1.0.0", "expertType": "agent", "agentName": expert_id,
        "agents": [f"./agents/{expert_id}.md"], "skills": [f"./skills/{expert_id}"],
        "displayName": label, "profession": profession, "description": description,
        "categoryId": category, "tags": ["女娲" if repo.name == "nuwa-skill" else repo.name, "原始 Skill"],
        "quickPrompts": [f"请用{label}的工作方法分析当前任务，并给出依据与行动建议。"],
    })
    commit = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    hashes = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(root.rglob("*")) if p.is_file() and p.name != "provenance.json"}
    write_json(root / "provenance.json", {"schemaVersion": 1, "repository": repo.name,
        "commit": commit, "source": source.relative_to(repo).as_posix(), "license": "MIT",
        "upstreamSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "files": hashes,
        "adaptations": ["BRAIN tool and output-path mapping", "expert binding", "localized catalog metadata"]})
    return expert_id


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--garden", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "shared/apps/desktop/resources/experts")
    parser.add_argument("--spring-assets", type=Path)
    args = parser.parse_args()
    built = []
    repo = args.garden / "nuwa-skill"
    actual = {p.parent.name for p in (repo / "examples").glob("*/SKILL.md")}
    if actual != set(NUWA_ROLES):
        raise ValueError(f"Review changed upstream roles: {actual.symmetric_difference(NUWA_ROLES)}")
    for slug, (label, profession, category) in NUWA_ROLES.items():
        built.append(build_pack(repo, repo / "examples" / slug / "SKILL.md", args.output,
            f"nuwa-{slug}", label, profession, category, whole=True))
    built.append(build_pack(repo, repo / "SKILL.md", args.output, "nuwa-creator", "女娲·专家生成",
        "调研、提炼与候选 Skill 生成", "04-DataAI", extra=("references", "scripts")))
    repo = args.garden / "agency-agents"
    for rel, (label, profession) in AGENCY_ROLES.items():
        built.append(build_pack(repo, repo / rel, args.output, "agency-" + Path(rel).stem,
            label, profession, "02-Engineering"))
    repo = args.garden / "Claude-Code-Game-Studios"
    game_id = "game-studios-delivery"
    built.append(build_pack(repo, repo / ".claude/skills/quick-design/SKILL.md", args.output,
        game_id, "游戏设计与验收", "轻量设计与故事完成检查", "01-ProductDesign", extra=(".claude/docs",)))
    root = args.output / game_id
    for workflow in ("quick-design", "story-done"):
        copy_content(repo / ".claude/skills" / workflow, root / "skills" / game_id / "workflows" / workflow)
    provenance = json.loads((root / "provenance.json").read_text(encoding="utf-8"))
    provenance["files"] = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*")) if p.is_file() and p.name != "provenance.json"}
    write_json(root / "provenance.json", provenance)
    if args.spring_assets:
        for expert_id in built:
            pack = args.output / expert_id
            manifest = json.loads((pack / ".codex-plugin/plugin.json").read_text(encoding="utf-8"))
            asset = args.spring_assets / "public" / "experts" / expert_id
            copy_content(pack / "skills" / expert_id, asset / "skill")
            copy_content(pack / "LICENSE", asset / "LICENSE")
            copy_content(pack / "provenance.json", asset / "expert-provenance.json")
            write_json(asset / "asset.json", {"skill_key": expert_id, "skill_name": manifest["displayName"],
                "scope": "public", "theme_code": "experts", "theme_name": "专家",
                "summary": manifest["profession"], "retrieval_rule": manifest["description"],
                "status": "active", "body_file": "skill/SKILL.md", "documents": []})
    print(json.dumps({"count": len(built), "experts": built}, ensure_ascii=False))


if __name__ == "__main__":
    main()
