import { useEffect, useMemo, useState } from "react";

type ActorKind = "prop" | "enemy" | "boss" | "npc" | "start";

type LevelActor = {
  id: string;
  name: string;
  type: string;
  loc: string;
  ai: string;
  beh: string;
  kind: ActorKind;
  on?: boolean;
};

type LevelSpec = {
  id: string;
  title: string;
  umap: string;
  actors: LevelActor[];
};

const emptyLevels: LevelSpec[] = [];

const kindBadge = (kind: ActorKind) => {
  if (kind === "enemy") return <span className="brain-level-kind enemy">AI</span>;
  if (kind === "boss") return <span className="brain-level-kind boss">Boss</span>;
  if (kind === "npc") return <span className="brain-level-kind npc">NPC</span>;
  if (kind === "prop") return <span className="brain-level-kind">AI</span>;
  return null;
};

function fromCoreState(state: any): { levels: LevelSpec[]; levelIndex: number } {
  const levels = Array.isArray(state?.levels)
    ? state.levels.map((level: any, index: number) => ({
        id: String(level.id || `l${index}`),
        title: String(level.title || `关卡 ${index + 1}`),
        umap: String(level.umap || `L_Level_${index + 1}`),
        actors: Array.isArray(level.actors)
          ? level.actors.map((actor: any, actorIndex: number) => ({
              id: String(actor.id || `a${actorIndex}`),
              name: String(actor.name || "Actor"),
              type: String(actor.type || "Actor"),
              loc: String(actor.loc || "0, 0, 0"),
              ai: String(actor.ai || "—"),
              beh: String(actor.beh || "—"),
              kind: (actor.kind || "prop") as ActorKind,
              on: actorIndex === 0
            }))
          : []
      }))
    : [];
  const levelIndex = levels.length
    ? Math.min(Math.max(Number(state?.selectedLevelIndex || 0), 0), levels.length - 1)
    : 0;
  return { levels, levelIndex };
}

function toCoreState(levels: LevelSpec[], levelIndex: number) {
  return {
    schemaVersion: 1 as const,
    pipeline: "brain-game-runtime-v1" as const,
    selectedLevelIndex: levelIndex,
    levels: levels.map((level) => ({
      id: level.id,
      title: level.title,
      umap: level.umap,
      actors: level.actors.map(({ id, name, type, loc, ai, beh, kind }) => ({ id, name, type, loc, ai, beh, kind }))
    }))
  };
}

export function GameLevelEditor({ projectId }: { projectId?: string }) {
  const [levels, setLevels] = useState<LevelSpec[]>(emptyLevels);
  const [levelIndex, setLevelIndex] = useState(0);
  const [treeTab, setTreeTab] = useState<"content" | "outliner">("content");
  const [cbFilter, setCbFilter] = useState<"all" | "levels" | "ai" | "fav">("all");
  const [contentEntries, setContentEntries] = useState<Array<{ path: string; name: string; kind: string; ext: string }>>([]);
  const [contentExists, setContentExists] = useState(false);
  const [selectedAssetPath, setSelectedAssetPath] = useState("Content");
  const [status, setStatus] = useState("关卡编辑器");
  const [busy, setBusy] = useState(false);
  const [persisted, setPersisted] = useState(false);

  const level = levels[levelIndex];
  const selectedActor = useMemo(
    () => level?.actors.find((actor) => actor.on) || level?.actors[0],
    [level]
  );
  const hasCore = Boolean(projectId && window.newbrain?.getBrainGameLevelEditor);
  const bound = Boolean(projectId);
  const canMutate = bound && hasCore && !busy;

  const refreshFromCore = async () => {
    if (!projectId || !window.newbrain?.getBrainGameLevelEditor) return;
    setBusy(true);
    try {
      const result = await window.newbrain.getBrainGameLevelEditor({ projectId });
      const mapped = fromCoreState(result?.state);
      setLevels(mapped.levels);
      setLevelIndex(mapped.levelIndex);
      setPersisted(Boolean(result?.persisted));
      setStatus(
        result?.persisted
          ? "已从 .brain-game/level-editor.json 加载"
          : mapped.levels.length
            ? "工程内有关卡草稿 · 保存后写入磁盘"
            : "尚无关卡 · 请新建关卡后保存到工程"
      );
      if (window.newbrain.getBrainGameContentTree) {
        const tree = await window.newbrain.getBrainGameContentTree({ projectId });
        setContentExists(Boolean(tree?.exists));
        setContentEntries(Array.isArray(tree?.entries) ? tree.entries : []);
      } else {
        setContentExists(false);
        setContentEntries([]);
      }
    } catch (error) {
      setLevels([]);
      setLevelIndex(0);
      setPersisted(false);
      setContentEntries([]);
      setContentExists(false);
      setStatus(error instanceof Error ? error.message : "关卡状态加载失败");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!projectId) {
      setLevels([]);
      setLevelIndex(0);
      setPersisted(false);
      setContentEntries([]);
      setContentExists(false);
      setStatus("请先绑定本地游戏工程；未绑定工程时不提供演示关卡或假 Content");
      return;
    }
    if (!window.newbrain?.getBrainGameLevelEditor) {
      setLevels([]);
      setLevelIndex(0);
      setPersisted(false);
      setContentEntries([]);
      setContentExists(false);
      setStatus("当前构建未接入 game.level_editor IPC，无法读写真实关卡状态");
      return;
    }
    void refreshFromCore();
  }, [projectId]);

  const selectLevel = (index: number) => {
    if (!levels[index]) return;
    setLevels((prev) => prev.map((item, i) => ({
      ...item,
      actors: item.actors.map((actor, j) => ({ ...actor, on: i === index ? j === 0 : false }))
    })));
    setLevelIndex(index);
    setStatus(`已选择关卡草稿 ${levels[index].umap}（非 UE Editor 打开 .umap）`);
  };

  const selectActor = (actorId: string) => {
    setLevels((prev) => prev.map((item, i) => {
      if (i !== levelIndex) return item;
      return { ...item, actors: item.actors.map((actor) => ({ ...actor, on: actor.id === actorId })) };
    }));
  };

  const spawn = async (kind: "enemy" | "boss" | "npc") => {
    if (!projectId || !window.newbrain?.spawnBrainGameActor) {
      setStatus("请先绑定本地游戏工程后再生成 Actor");
      return;
    }
    if (!levels.length) {
      setStatus("请先新建关卡并保存，再生成 Actor");
      return;
    }
    setBusy(true);
    try {
      // spawn_actor reads disk state; persist editor draft first so empty defaults are never used.
      const saved = await persist();
      if (!saved) return;
      const result = await window.newbrain.spawnBrainGameActor({ projectId, kind, levelIndex });
      const mapped = fromCoreState(result?.saved?.state || result?.state);
      setLevels(mapped.levels);
      setLevelIndex(mapped.levelIndex);
      setPersisted(true);
      setTreeTab("outliner");
      setStatus(`已写入工程：${result?.actor?.name || kind}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "生成 Actor 失败");
    } finally {
      setBusy(false);
    }
  };

  const persist = async () => {
    if (!projectId || !window.newbrain?.saveBrainGameLevelEditor) {
      setStatus("请先绑定本地游戏工程");
      return null;
    }
    const result = await window.newbrain.saveBrainGameLevelEditor({
      projectId,
      state: toCoreState(levels, levelIndex)
    });
    setPersisted(true);
    if (result?.state) {
      const mapped = fromCoreState(result.state);
      setLevels(mapped.levels);
      setLevelIndex(mapped.levelIndex);
    }
    setStatus(`已保存 · sha256 ${(result?.sha256 || "").slice(0, 12)}…`);
    return result;
  };

  const save = async () => {
    setBusy(true);
    try {
      return await persist();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const play = async () => {
    if (!projectId || !window.newbrain?.startBrainGamePreview) {
      setStatus("请先绑定本地游戏工程后再试玩");
      return;
    }
    setBusy(true);
    setStatus("正在启动试玩…");
    try {
      const preview = await window.newbrain.startBrainGamePreview({ projectId });
      setStatus(preview?.previewUrl ? `试玩已启动 · ${preview.previewUrl}` : `试玩状态：${preview?.status || "running"}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "启动试玩失败");
    } finally {
      setBusy(false);
    }
  };

  const cook = async () => {
    if (!projectId) {
      setStatus("请先绑定本地游戏工程");
      return;
    }
    if (!window.newbrain?.exportBrainGameDesign) {
      setStatus("当前构建未接入 Cook IPC，拒绝假成功");
      return;
    }
    setBusy(true);
    try {
      const saved = await persist();
      if (!saved) return;
      setStatus("正在 Cook 工程…");
      const cooked = await window.newbrain.exportBrainGameDesign({ projectId });
      const detail = Array.isArray(cooked?.written)
        ? `${cooked.written.length} 文件`
        : (cooked?.artifactCount ?? "Docs/BRAIN");
      setStatus(`Cook 完成 · ${detail}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Cook 失败");
    } finally {
      setBusy(false);
    }
  };

  const addLevel = () => {
    if (!bound || !hasCore) {
      setStatus("请先绑定本地游戏工程后再新建关卡");
      return;
    }
    const nextIndex = levels.length + 1;
    const id = `L${String(nextIndex).padStart(2, "0")}`;
    const next: LevelSpec = {
      id,
      title: `新关卡 ${nextIndex}`,
      umap: `LVL_New_${nextIndex}`,
      actors: [
        { id: `${id}-start`, name: "PlayerStart", type: "出生点", loc: "0, 0, 0", ai: "—", beh: "—", kind: "start", on: true }
      ]
    };
    setLevels((prev) => [
      ...prev.map((item) => ({
        ...item,
        actors: item.actors.map((actor) => ({ ...actor, on: false }))
      })),
      next
    ]);
    setLevelIndex(levels.length);
    setTreeTab("outliner");
    setStatus(`已在编辑器新建 ${next.umap} · 必须「保存关卡状态」才会写入 .brain-game/level-editor.json`);
  };

  const refuseAiPlaceholder = (label: string) => {
    setStatus(`${label} 需真实 AI/资产管线；当前未接入，不会写假 ✓ 或假 AI/ 目录`);
  };

  const filteredContent = useMemo(() => {
    if (!contentEntries.length) return [];
    return contentEntries.filter((asset) => {
      if (cbFilter === "all" || cbFilter === "fav") return true;
      if (cbFilter === "levels") return /levels|\.umap|content\/?$/i.test(`${asset.path} ${asset.name}`);
      return /ai|enemy|boss|npc|characters|content\/?$/i.test(`${asset.path} ${asset.name}`);
    });
  }, [cbFilter, contentEntries]);

  return (
    <section className="brain-level-editor" aria-label="BRAIN Level Editor" data-testid="brain-game-level-editor">
      <div className="brain-level-toolbar">
        <button type="button" className="primary" disabled={!canMutate} onClick={() => void play()}>▶ Play</button>
        <button type="button" className="ai" disabled={!canMutate || !levels.length} onClick={() => refuseAiPlaceholder("AI 补全本关")}>✦ AI 补全本关</button>
        <button type="button" className="ai" disabled={!canMutate || !levels.length} onClick={() => void spawn("enemy")}>✦ 敌人</button>
        <button type="button" className="ai" disabled={!canMutate || !levels.length} onClick={() => void spawn("boss")}>✦ Boss</button>
        <button type="button" className="ai" disabled={!canMutate || !levels.length} onClick={() => void spawn("npc")}>✦ NPC</button>
        <span className="spacer" />
        <span className="proj">{bound ? (persisted ? "已落盘" : hasCore ? "已绑定 · 未保存" : "已绑定 · 无 IPC") : "未绑定"} · {hasCore ? "Rust" : "不可用"}</span>
      </div>

      <div className="brain-level-list-block" aria-label="关卡列表">
        <div className="brain-level-list-head">
          <strong>关卡列表</strong>
          <span>一关一草稿 · 共 <b>{levels.length}</b> 关 · 非演示数据</span>
          <button type="button" className="level-add" disabled={!canMutate} onClick={() => addLevel()}>＋ 新建</button>
        </div>
        {levels.length ? (
          <div className="brain-level-list" role="listbox">
            {levels.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`brain-level-item${index === levelIndex ? " on" : ""}`}
                role="option"
                aria-selected={index === levelIndex}
                onClick={() => selectLevel(index)}
              >
                <span className="brain-level-idx">{index + 1}</span>
                <span className="brain-level-text">
                  <strong>{item.title}</strong>
                  <span className="umap">{item.umap}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="brain-level-empty" data-testid="brain-game-level-empty">
            <strong>{bound ? "尚无关卡" : "未绑定工程"}</strong>
            <span>{bound ? "点击「＋ 新建」创建关卡草稿，再保存到工程。不会预置山门/试炼等演示关卡。" : "绑定本地游戏工程后，从磁盘加载真实关卡状态。"}</span>
          </div>
        )}
      </div>

      <div className="brain-level-body">
        <div className="brain-level-viewport">
          <div className="grid" aria-hidden="true" />
          <div className="label">
            <b>{level ? `${level.umap} · 列表预览` : "无关卡"}</b>
            <span>非 UE 视口 · 仅展示已保存草稿坐标，不假装渲染场景</span>
          </div>
        </div>

        <div className="brain-level-split">
          <div className="brain-level-tree-panel">
            <div className="brain-tree-tabs" role="tablist">
              <button type="button" className={treeTab === "content" ? "on" : ""} role="tab" aria-selected={treeTab === "content"} onClick={() => setTreeTab("content")}>Content</button>
              <button type="button" className={treeTab === "outliner" ? "on" : ""} role="tab" aria-selected={treeTab === "outliner"} onClick={() => setTreeTab("outliner")}>Outliner</button>
            </div>

            {treeTab === "content" ? (
              <div className="brain-tree-pane on" role="tabpanel">
                <div className="cb-tools">
                  {(["all", "levels", "ai", "fav"] as const).map((key) => (
                    <button key={key} type="button" className={cbFilter === key ? "on" : ""} onClick={() => setCbFilter(key)}>
                      {key === "all" ? "全部" : key === "levels" ? "Levels" : key === "ai" ? "AI/" : "★"}
                    </button>
                  ))}
                </div>
                {filteredContent.length ? (
                  <ul className="brain-content-tree">
                    {filteredContent.map((asset) => (
                      <li
                        key={asset.path}
                        className={[
                          asset.kind === "folder" ? "folder" : "",
                          selectedAssetPath === asset.path ? "on" : "",
                          String(asset.path).split("/").length === 2 ? "indent" : "",
                          String(asset.path).split("/").length >= 3 ? "indent2" : ""
                        ].filter(Boolean).join(" ")}
                        onClick={() => {
                          setSelectedAssetPath(asset.path);
                          const match = levels.findIndex((item) => asset.path?.includes?.(item.umap) || asset.name?.includes?.(item.umap));
                          if (match >= 0) {
                            selectLevel(match);
                            setTreeTab("outliner");
                            return;
                          }
                          setStatus(`Content · ${asset.name}`);
                        }}
                      >
                        {asset.name}
                        {asset.ext ? <span className="ext">.{asset.ext}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="brain-level-empty compact">
                    <span>{!bound ? "未绑定工程" : contentExists ? "Content 下暂无匹配条目" : "工程尚无 Content/ 目录（不会伪造空 .umap）"}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="brain-tree-pane on" role="tabpanel">
                {level ? (
                  <>
                    <ul className="brain-actor-tree">
                      <li className="folder">Persistent Level</li>
                      {level.actors.map((actor) => (
                        <li key={actor.id} className={`indent${actor.on ? " on" : ""}`} onClick={() => selectActor(actor.id)}>
                          {actor.name}
                          {kindBadge(actor.kind)}
                        </li>
                      ))}
                    </ul>
                    <div className="spawn-hint">本关 Actor · ✦ 敌人 / Boss / NPC → game.spawn_actor 写入磁盘</div>
                  </>
                ) : (
                  <div className="brain-level-empty compact"><span>无选中关卡</span></div>
                )}
              </div>
            )}
          </div>

          <div className="brain-level-details">
            <h4>详情 · <span>{selectedActor?.name || "—"}</span></h4>
            <div className="prop"><span>类型</span><b>{selectedActor?.type || "—"}</b></div>
            <div className="prop"><span>位置</span><b>{selectedActor?.loc || "—"}</b></div>
            <div className="prop"><span>AI 资产</span><b>{selectedActor?.ai || "—"}</b></div>
            <div className="prop"><span>行为</span><b>{selectedActor?.beh || "—"}</b></div>
            <div className="ai-actions">
              <button type="button" disabled={!canMutate || !selectedActor} onClick={() => refuseAiPlaceholder("材质")}>✦ 材质<em>贴图 / 发光</em></button>
              <button type="button" disabled={!canMutate || !selectedActor} onClick={() => refuseAiPlaceholder("动作")}>✦ 动作<em>待机 / 技能</em></button>
              <button type="button" disabled={!canMutate || !selectedActor} onClick={() => refuseAiPlaceholder("叙事")}>✦ 叙事<em>对白 / 目标</em></button>
              <button type="button" disabled={!canMutate || !selectedActor} onClick={() => refuseAiPlaceholder("逻辑")}>✦ 逻辑<em>蓝图级脚本</em></button>
              <button type="button" disabled={!canMutate || !selectedActor} onClick={() => refuseAiPlaceholder("行为")}>✦ 行为<em>巡逻 / 仇恨 / 对话</em></button>
              <button type="button" disabled={!canMutate || !selectedActor} onClick={() => refuseAiPlaceholder("战斗")}>✦ 战斗<em>技能表 / 血条</em></button>
            </div>
          </div>
        </div>

        <div className="brain-level-cook">
          <div>
            <strong>Cook / 保存</strong>
            <span>{status}</span>
          </div>
          <button type="button" disabled={!canMutate} onClick={() => void save()}>
            {busy ? "处理中…" : "保存关卡状态"}
          </button>
          <button type="button" className="primary" disabled={!canMutate} onClick={() => void cook()}>
            {busy ? "处理中…" : "Cook 工程"}
          </button>
        </div>
      </div>
    </section>
  );
}
