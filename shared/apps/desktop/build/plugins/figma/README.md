# Figma builtin for NewBrain

This package adapts the Codex curated Figma plugin skills for NewBrain.

## What you get

- Skills for design-to-code, FigJam diagrams, libraries, slides, and motion
- Composer builtin entry **Figma**

## What you must configure

Cloud writes (“直接出现在 Figma 里”) need Figma tools:

1. **Recommended for NewBrain:** open Figma desktop → Dev Mode → enable **desktop MCP**, then in NewBrain **设置 → MCP → ＋ Figma Desktop MCP** (`http://127.0.0.1:3845/mcp`), save and start.
2. Optional: **设置 → 环境** → `FIGMA_ACCESS_TOKEN` (Personal Access Token) for REST-style helpers.
3. Optional remote: `https://mcp.figma.com/mcp` (may require Figma OAuth / client allowlisting).

Without MCP/auth, Agent falls back to Mermaid in chat or the **Visualize** plugin for local diagrams.

Create a token at: https://www.figma.com/developers/api#access-tokens

## License

See `LICENSE.txt` (Figma Developer Terms apply to Figma skill materials).
