# Video Audio N1 Implementation Status

Status: IN PROGRESS. Not release-ready.

## Git Baseline

- Remote fetched; origin/main and main matched before baseline commit.
- Existing source, tests, configuration and design documents committed as 0586728.
- Implementation branch: codex/video-audio-workspace-n1.
- No push performed.

## Implemented

- Resource header contains Tools, files, artifacts and tasks using existing handlers.
- Video scene uses the original BRAIN column proportions after user review; Tools retains the existing resize and expand controls.
- Script segments edit existing shot title, prompt, narration and trim duration.
- Script confirmation awaits actual project persistence before switching to storyboard.
- Script validation rejects invalid duration and empty visual descriptions.
- Manual TTS now waits for project audio import before reporting success.
- Automatic TTS also waits for project import; each narration import uses a unique file name.
- Script fields are disabled while a save is in flight.

## Verification

- Four focused script/header checks passed.
- Repository layout verification passed.
- Production Electron build passed against the current layout and speech persistence changes.
- Full TypeScript check failed with numerous errors, including missing preload method declarations and validateFlowDefinition. Baseline comparison remains required before attributing them.
- Existing workspace-selection suite: 30 passed, 8 failed (plus 2 script-format tests passed in the same invocation). Failures require baseline comparison and review.
- Electron now starts successfully. The existing media E2E fails while looking for a conversation in the sidebar; media export acceptance remains incomplete.
- Dedicated Electron layout verification passes at 1520 and 1920 pixels: original horizontal integration cards, no chat overflow, Tools dragging and width restoration after reload. Screenshots and dimensions are under evidence/video-layout-n1 (not committed).

## Remaining Work

1. Reproduce and resolve isolated Electron startup; test actual UI dimensions, menus, project persistence and restart recovery.
2. Complete approved prototype audio workflow using actual capability contracts: provider/voice/speed/emotion, durable versions, preview/selection, BGM generation and ducking, ASR, subtitle review, export validation.
3. Integrate reviewed BaiLongma code with provenance and licenses; route provider credentials through spring-app. No upstream integration has been delivered yet.
4. Verify project switching, concurrent edits and saving; ensure invalid inputs cannot corrupt timeline state.
5. Run final type, integration, production build, real media and installed Windows acceptance checks. Report external-service errors without substituting generated success states.

The HTML prototype remains a design reference. Its simulated actions are not evidence of implementation.
