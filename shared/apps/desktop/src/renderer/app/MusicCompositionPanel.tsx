import { useEffect, useState } from "react";

type Composition = { theme: string; bpm: number; keySignature: string; lyrics: string; arrangement: string };

const defaults: Composition = { theme: "", bpm: 120, keySignature: "C major", lyrics: "", arrangement: "" };

export function MusicCompositionPanel(props: { projectId?: string; onMetadataSaved?: (value: Composition) => void }) {
  const [value, setValue] = useState<Composition>(defaults);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!props.projectId || !window.newbrain?.getBrainWorkspaceSection) return;
    void Promise.all([
      window.newbrain.getBrainWorkspaceSection({ projectId: props.projectId, workspaceKey: "music", sectionKey: "lyrics" }),
      window.newbrain.getBrainWorkspaceSection({ projectId: props.projectId, workspaceKey: "music", sectionKey: "arrangement" })
    ]).then(([lyrics, arrangement]) => {
      let meta = defaults;
      try { meta = { ...defaults, ...JSON.parse(arrangement.content) }; } catch { /* keep defaults */ }
      setValue({ ...meta, lyrics: lyrics.content || meta.lyrics });
      setRevision(Math.max(lyrics.revision, arrangement.revision));
    }).catch(() => undefined);
  }, [props.projectId]);

  const save = async () => {
    if (!props.projectId || !window.newbrain?.saveBrainWorkspaceSection) return;
    const { lyrics, arrangement, ...meta } = value;
    await window.newbrain.saveBrainWorkspaceSection({
      projectId: props.projectId, workspaceKey: "music", sectionKey: "lyrics",
      content: lyrics, expectedRevision: revision
    });
    const saved = await window.newbrain.saveBrainWorkspaceSection({
      projectId: props.projectId, workspaceKey: "music", sectionKey: "arrangement",
      content: JSON.stringify({ theme: meta.theme, bpm: meta.bpm, keySignature: meta.keySignature, arrangement }, null, 2),
      expectedRevision: revision
    });
    setRevision(saved.revision);
    setStatus("歌词与编曲信息已保存");
    props.onMetadataSaved?.(value);
  };

  return (
    <section className="brain-music-composition" data-testid="brain-music-composition">
      <header><strong>歌词与编曲</strong><button type="button" onClick={() => void save()}>保存并同步时间线</button></header>
      <label><span>主题</span><input value={value.theme} onChange={(e) => setValue((current) => ({ ...current, theme: e.target.value }))} /></label>
      <label><span>BPM</span><input type="number" value={value.bpm} onChange={(e) => setValue((current) => ({ ...current, bpm: Number(e.target.value) || 120 }))} /></label>
      <label><span>调性</span><input value={value.keySignature} onChange={(e) => setValue((current) => ({ ...current, keySignature: e.target.value }))} /></label>
      <label><span>歌词</span><textarea value={value.lyrics} onChange={(e) => setValue((current) => ({ ...current, lyrics: e.target.value }))} rows={6} /></label>
      <label><span>编曲说明</span><textarea value={value.arrangement} onChange={(e) => setValue((current) => ({ ...current, arrangement: e.target.value }))} rows={4} /></label>
      {status ? <p>{status}</p> : null}
    </section>
  );
}
