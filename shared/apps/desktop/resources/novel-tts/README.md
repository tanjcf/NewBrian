# 小说离线朗读（Kokoro-zh）资源说明

## 目录布局

安装或下载后应出现：

```text
novel-tts/kokoro/
  model/          # ONNX 模型与 tokenizer（含 config.json）
  voices/         # 仅 8 个角色 .bin
  READY.json
```

查找顺序（运行时）：

1. `%LOCALAPPDATA%\.newbrain\novel-tts\kokoro`（或 Electron `userData/novel-tts/kokoro`）
2. 安装包 `resources/novel-tts/kokoro`（可选打进 extraResources）

## 下载 8 音色精简包

在 `windows/apps/desktop` 下：

```powershell
node .\scripts\fetch-novel-tts-kokoro.mjs
```

或指定目录：

```powershell
node .\scripts\fetch-novel-tts-kokoro.mjs --out "$env:LOCALAPPDATA\.newbrain\novel-tts\kokoro"
```

## 运行时行为

- 点朗读才探测 GPU / 启动 worker；空闲不常驻
- GPU 显存 ≥ 2GB → 优先 GPU，否则 CPU
- 无资源包 → 回退系统 `speechSynthesis`
