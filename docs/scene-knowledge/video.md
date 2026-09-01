# 视频制作场景

能力：脚本、分镜、单镜生成、音视频轨、字幕、合成与导出。

**右侧 Tools 子架构（必走）：** 脚本 / 分镜 / 单镜生成 / 本镜音视频轨（`VideoPipelineShell`）。

对话必须调用场景 Agent 工具：`video.project.inspect`、`video.pipeline.save`、`video.shot.generate`、`video.timeline.*`、`video.audio.*`、`video.render.*`。裸 `video_generate` 仅作非视频场景 Auto 兜底；本场景优先 `video.*`，返回任务状态与实际产物路径。
