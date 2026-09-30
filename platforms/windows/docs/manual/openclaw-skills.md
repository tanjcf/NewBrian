# Install OpenClaw / ClawHub skills in NewBrain

NewBrain can install **OpenClaw-compatible** community skills (AgentSkills layout centered on `SKILL.md`), including packages from [ClawHub](https://clawhub.ai).

## Compatibility model

| Layer | Layout | NewBrain behavior |
|---|---|---|
| OpenClaw / ClawHub | `{slug}/SKILL.md` (+ optional `references/`, `scripts/`, `assets/`, `agents/openai.yaml`) | Detected and installed as-is into managed skills root |
| Spring SkillAsset ZIP | `asset.json` + `skill/SKILL.md` (+ `knowledge/`) | Remapped on install: root `SKILL.md`, `knowledge/` → `references/` |
| NewBrain local scaffold | `{name}/SKILL.md` + `agents/openai.yaml` | Unchanged |

Installed skills land in the desktop managed root:

`{appWorkspace}/.newbrain/skills/{skill-name}/`

Runtime loading uses the existing `SkillRegistry` (`SKILL.md` at skill root). After install, the skill appears in **技能 → 已安装** and can be selected in the composer like any local skill.

Provenance is written to:

`.clawhub/origin.json`

## Security notes

- ClawHub installs require an explicit **risk acknowledgement** in the UI (or `acknowledgeRisk: true` over IPC).
- Skills are **instruction packs**. `scripts/` may be copied but are **never auto-executed**.
- Zip entries are checked for path traversal.
- A lightweight static scan looks for credential / download-cradle patterns in `SKILL.md`. Suspicious packages still require risk acknowledgement.
- Prefer reviewing the ClawHub page and `SKILL.md` before installing community skills.
- Registry base URL defaults to `https://clawhub.ai` and can be overridden with `NEWBRAIN_CLAWHUB_URL` / `OPENCLAW_CLAWHUB_URL` / `CLAWHUB_URL`.

## How to install (UI)

1. Open NewBrain → **技能**.
2. Open the **OpenClaw** tab.
3. Either:
   - Search ClawHub and click **安装**, or
   - Enter `@owner/slug` / `slug` and click **安装 OpenClaw 技能**, or
   - Click **从 zip 安装** and pick a ClawHub/OpenClaw skill zip.
4. Check the risk acknowledgement box before ClawHub installs.
5. Switch to **已安装**, enable the skill if needed, then use **在对话中试用** or pick it in the composer.

## How to install (manual folder drop)

1. Download a ClawHub skill zip from `https://clawhub.ai` (or export an OpenClaw skill folder).
2. Ensure the package contains `SKILL.md` at the skill root (or spring `skill/SKILL.md`).
3. Unpack into `{appWorkspace}/.newbrain/skills/{skill-name}/` **or** use the OpenClaw tab zip installer.
4. Refresh skills / restart desktop if the catalog does not refresh automatically.
5. Select the skill in chat.

## How to install (IPC / preload)

```ts
await window.newbrain.searchOpenClawSkills({ query: "calendar", limit: 20 });

await window.newbrain.installOpenClawSkillFromClawHub({
  ref: "@owner/slug",
  acknowledgeRisk: true,
  force: true
});

await window.newbrain.selectAndInstallOpenClawSkill({
  acknowledgeRisk: true,
  force: true
});

// Backup an installed skill as a portable zip (preferred over copying loose folders)
await window.newbrain.exportOpenClawSkillZip({
  skillId: "skill-my-skill",
  skillName: "my-skill"
});

// Uninstall known writing skills from the local managed catalog first
await window.newbrain.uninstallWritingSkills({});
```

## Backup / export as zip

1. Open **技能 → 已安装**.
2. Click **备份 zip** on a card, or open detail and click **备份为 zip**.
3. Choose the destination `.zip` path.
4. Reinstall later with **OpenClaw → 从 zip 安装**.

Writing skills (`government-research-writing`, `prd-writer`, `prompt-optimizer`) can be removed from the local install catalog with the toolbar action **卸载写作技能**. Product-central 政务写作 remains available in the composer until central-skills is changed separately. After uninstall, use zip export for remaining skill backups.

## Residual gaps

- No full ClawHub marketplace parity (publish, sync, verify card UI, lockfile sync with OpenClaw CLI).
- No Ed25519 signature enforcement for ClawHub skill archives (ClawHub verify API is not yet surfaced in UI).
- No automatic update / `skills update --all`.
- Spring desktop distribution APIs (`/api/desktop/v1/skills/...`) remain separate from ClawHub.
- GitHub-backed ClawHub installs download the commit zip; nested monorepo path trimming follows OpenClaw archive root detection, not a full git checkout.
- Direct ClawHub network install stays gated (`market.directClawhubAllowed` / spring proxy); offline zip import remains available.
