# 音乐创作场景

能力：生成整曲/片段、音轨、切片、编曲和导出。

**右侧 Tools 子架构（必走）：** 工作台切换到「音乐创作」后，右侧 Tools 页签为 **生成 / 音轨 / 标记切片 / 导出**（`MusicDawShell`）。对话里的音乐工作必须调用场景 Agent 工具 `music.daw.save`、`music.song.generate`、`music.project.inspect`、`music.render.*`，写入同一套 DAW/时间线，用户应在右侧看到歌词、风格与生成音轨更新。

`music.song.generate` 内部调用 spring-app `music_generate` 并落盘到 `media/stems/`；裸 `music_generate` 只作非音乐场景的 Auto 兜底，不在本场景替代右侧 Tools。
