import { useRef, useState } from "react";
import type { VideoVoiceCasting as Casting } from "@codex-forge/protocol/brain-video-runtime";
import { NOVEL_TTS_VOICES } from "../../shared/novel-tts-policy";
import { MINIMAX_NARRATION_VOICES } from "../../shared/minimax-narration-voices";
import { joinVoiceAudio } from "./video-voice-audio";

const voices = [...NOVEL_TTS_VOICES.map(v => ({ id: v.id, label: v.hint })), ...MINIMAX_NARRATION_VOICES.map(v => ({ id: v.id, label: v.label + "（远程同音色预设）" }))];
type Props = {
  projectId: string;
  script: string;
  shots: Array<{ id: string; title: string; line: string }>;
  value?: Casting;
  onChange: (value: Casting) => void;
  onSave: () => Promise<boolean>;
  onApply: (shotId: string, audio: { ok: boolean; audioBase64: string; mimeType: string; durationMs: number }) => Promise<unknown>;
};

export function VideoVoiceCasting(props: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preference, setPreference] = useState("");
  const [preview, setPreview] = useState("");
  const player = useRef<HTMLAudioElement>(null);
  const current = useRef(props.value);
  current.current = props.value;
  const change = (value: Casting) => { current.current = value; props.onChange(value); };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await action(); } catch (e) { setMessage(e instanceof Error ? e.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  };
  const sourceUrl = async (path: string) => {
    if (!window.newbrain) throw new Error("桌面服务未连接。");
    const files = await window.newbrain.listBrainFiles({ projectId: props.projectId });
    const file = files.find(f => (f.storageKey || "").replaceAll("\\", "/").endsWith(path));
    if (!file) throw new Error("试听文件未找到，请刷新项目。");
    return window.newbrain.getBrainFilePreviewUrl({ projectId: props.projectId, fileId: file.id });
  };
  const generate = async (lineId: string, voiceId: string) => {
    if (!window.newbrain) throw new Error("桌面服务未连接。");
    const state = current.current!;
    const line = state.lines.find(l => l.id === lineId)!;
    const result = await window.newbrain.synthesizeNovelSpeech({ text: line.text, voiceId, playback: false });
    if (!result.ok || !result.audioBase64) throw new Error(result.detail || "配音生成失败，原版本已保留。");
    const id = crypto.randomUUID();
    const mimeType = result.mimeType || "audio/wav";
    const imported = await window.newbrain.importBrainMedia({ projectId: props.projectId,
      fileName: `voice-${id}.${mimeType.includes("wav") ? "wav" : "mp3"}`, mimeType, bytesBase64: result.audioBase64, folder: "audio" });
    if (!imported.relativePath) throw new Error("候选音频保存失败。");
    const version = { id, lineId, text: line.text, voiceId, provider: result.provider || "unknown", relativePath: imported.relativePath, createdAt: new Date().toISOString() };
    change({ ...current.current!, versions: [...current.current!.versions, version] });
    if (!await props.onSave()) throw new Error("音频已写入，但候选记录保存失败，请保存配音方案后再离开。");
    setPreview(`data:${mimeType};base64,${result.audioBase64}`);
    setMessage("候选已生成，试听满意后采用；时间线尚未替换。请保存配音方案。");
  };
  const state = props.value;
  const sceneAudio = async (shotId: string) => {
    const value = current.current!;
    const lines = value.lines.filter(l => l.shotId === shotId);
    const urls: string[] = [];
    for (const line of lines) {
      const version = value.versions.find(v => v.id === value.accepted[line.id] && v.text === line.text);
      if (!version) throw new Error("请先为本场景的每句台词采用一个试听版本。");
      urls.push(await sourceUrl(version.relativePath));
    }
    return joinVoiceAudio(urls);
  };
  return <details className="video-voice-casting">
    <summary>角色配音 · 推荐、试听与版本</summary>
    <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 12, minWidth: 0 }}>
      <label>声音偏好与人物补充<textarea value={preference} onChange={e => setPreference(e.target.value)} placeholder="例如：旁白雄厚坚定但不拖慢；主角清亮，配角温和。" /></label>
      <button type="button" onClick={() => void run(async () => {
        if (!window.newbrain?.analyzeVideoVoices) throw new Error("此版本未接入角色分析。");
        const next = await window.newbrain.analyzeVideoVoices({ script: props.script, shots: props.shots, preference });
        change({ ...next, versions: state?.versions || [], accepted: {} });
        if (!await props.onSave()) throw new Error("推荐已生成，但项目保存失败。");
        setMessage("已按剧本推荐角色声音。重新分析后需要重新确认；旧音频文件仍保留。");
      })}>{state ? "根据剧本与偏好重新推荐" : "分析剧本，推荐角色声音"}</button>
      {state?.roles.map(role => <article key={role.id} style={{ paddingBlock: 12, borderBottom: "1px solid var(--border-color, #8884)" }}>
        <strong>{role.name}</strong><p>{role.description}</p><p>{role.reason}</p>
        <label>声音<select value={role.voiceId} onChange={e => change({ ...state, roles: state.roles.map(r => r.id === role.id ? { ...r, voiceId: e.target.value, confirmed: false } : r) })}>
          {voices.map(v => <option key={v.id} value={v.id}>{role.candidates.includes(v.id) ? "推荐 · " : ""}{v.label}</option>)}
        </select></label>
        <button type="button" onClick={() => void run(async () => {
          const line = state.lines.find(l => l.roleId === role.id);
          if (!line) throw new Error("该角色没有台词。");
          await generate(line.id, role.voiceId);
        })}>用角色台词试听</button>
        <button type="button" onClick={() => change({ ...state, roles: state.roles.map(r => r.id === role.id ? { ...r, confirmed: true } : r) })}>{role.confirmed ? "✓ 声音已确认" : "确认角色声音"}</button>
      </article>)}
      {state && <>
        <button type="button" disabled={!state.roles.every(r => r.confirmed)} onClick={() => void run(async () => {
          for (const line of state.lines) {
            const role = state.roles.find(r => r.id === line.roleId)!;
            await generate(line.id, role.voiceId);
          }
          setMessage("全部台词候选已生成，请试听并逐句采用。原时间线保持原版本。");
        })}>按已确认声音生成全部台词</button>
        {state.lines.map(line => <article key={line.id} style={{ paddingBlock: 10 }}>
          <strong>{state.roles.find(r => r.id === line.roleId)?.name} · {props.shots.find(s => s.id === line.shotId)?.title}</strong>
          <p>{line.text}</p><small>导演建议：{line.direction}（当前引擎不支持自动情绪控制）</small>
          <button type="button" disabled={!state.roles.find(r => r.id === line.roleId)?.confirmed} onClick={() => void run(() => generate(line.id, state.roles.find(r => r.id === line.roleId)!.voiceId))}>只重做这句</button>
          {state.versions.filter(v => v.lineId === line.id && v.text === line.text).map(version => <div key={version.id}>
            <span>{new Date(version.createdAt).toLocaleString()} · {voices.find(v => v.id === version.voiceId)?.label} · {version.provider}</span>
            <button type="button" onClick={() => void run(async () => setPreview(await sourceUrl(version.relativePath)))}>试听此版</button>
            <button type="button" onClick={() => change({ ...state, accepted: { ...state.accepted, [line.id]: version.id } })}>{state.accepted[line.id] === version.id ? "✓ 已采用" : "采用此版"}</button>
          </div>)}
        </article>)}
        <button type="button" onClick={() => void run(async () => { if (!await props.onSave()) throw new Error("方案保存失败。"); setMessage("配音方案已保存到项目。"); })}>保存配音方案</button>
        {props.shots.filter(shot => state.lines.some(l => l.shotId === shot.id)).map(shot => <div key={shot.id}>
          <strong>{shot.title}</strong>
          <button type="button" onClick={() => void run(async () => {
            const audio = await sceneAudio(shot.id);
            setPreview(`data:audio/wav;base64,${audio.audioBase64}`);
            setMessage(`场景试听 ${audio.duration.toFixed(1)} 秒，按剧本台词顺序连接。`);
          })}>试听完整场景</button>
          <button type="button" onClick={() => void run(async () => {
            const audio = await sceneAudio(shot.id);
            const applied = await props.onApply(shot.id, { ok: true, mimeType: "audio/wav", audioBase64: audio.audioBase64, durationMs: audio.duration * 1000 });
            if (!applied) throw new Error("时间线更新失败，旧文件仍保留。");
            setMessage("已采用场景配音，请保存项目。旧音频文件和台词版本仍保留。场景长度变化时请调整镜头时长。");
          })}>采用场景配音到时间线</button>
        </div>)}
      </>}
      {preview && <audio ref={player} controls src={preview} />}
      <p role="status">{busy ? "正在处理，请稍候…" : message}</p>
    </fieldset>
  </details>;
}
