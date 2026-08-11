# Codex PM Knowledge

Use this file as the factual and analytical base for Codex-related PM work.

## Search Index

- `cloud agent`
- `desktop app`
- `CLI`
- `approval modes`
- `sandbox`
- `skills`
- `automations`
- `PM implications`
- `PM questions`

## cloud agent

Confirmed facts:

- OpenAI introduced Codex on **May 16, 2025** as a **cloud-based software engineering agent**.
- It can work on **many tasks in parallel**.
- Tasks run in **their own cloud sandbox environment**, preloaded with the repository.
- Product examples include writing features, answering codebase questions, fixing bugs, and proposing pull requests.

Source:

- OpenAI: [Introducing Codex](https://openai.com/index/introducing-codex/)

## desktop app

Confirmed facts:

- OpenAI introduced the Codex app in **2026**.
- The app is described as a **command center for agentic coding**.
- It supports **multi-agent workflows** and parallel work across projects.
- It includes **skills** and **automations**.
- The macOS app launched first; Windows availability was listed as upcoming in the announcement.

Sources:

- OpenAI: [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)
- OpenAI: [Codex product page](https://openai.com/codex)

## CLI

Confirmed facts:

- Codex CLI is an **open-source command-line tool**.
- It can **read, modify, and run code on the local machine**.

Source:

- OpenAI Help: [OpenAI Codex CLI – Getting Started](https://help.openai.com/en/articles/11096431-openai-codex-ligetting-started)

## approval modes

Confirmed facts:

- OpenAI documents **three approval modes**:
  - `Suggest`
  - `Auto Edit`
  - `Full Auto`
- `Suggest` requires approval before edits or command execution.
- `Auto Edit` can write files automatically but still asks before shell commands.
- `Full Auto` can read, write, and execute commands autonomously inside a **sandboxed, network-disabled environment** scoped to the current directory.

Source:

- OpenAI Help: [OpenAI Codex CLI – Getting Started](https://help.openai.com/en/articles/11096431-openai-codex-ligetting-started)

## sandbox

Confirmed facts:

- OpenAI states the Codex stack uses **system-level sandboxing** in the app and CLI.
- By default, agents are limited to editing files in the folder or branch where they are working and using cached web search.
- Elevated actions like network access require permission unless allowed by rules.
- The public app-server README describes approval requests as a structured controller/UI flow where the client presents commands or diffs inline and returns a decision.

Sources:

- OpenAI: [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)
- GitHub: [app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

## skills

Confirmed facts:

- The Codex app includes a **dedicated interface to create and manage skills**.
- Users can explicitly ask Codex to use skills, or allow Codex to use them automatically based on the task.
- Skills package **instructions, resources, and scripts** to make workflows repeatable.
- OpenAI maintains an **open skills catalog**.

Sources:

- OpenAI: [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)
- GitHub: [openai/skills](https://github.com/openai/skills)

## automations

Confirmed facts:

- Codex app supports **Automations** for scheduled background work.
- Automations combine **instructions** with optional **skills**.
- When an automation finishes, results land in a **review queue** for user follow-up.

Source:

- OpenAI: [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)

## PM implications

These are product interpretations based on the facts above:

- Codex is optimized around **delegation with supervision**, not blind autonomy.
- Approval mode is a core product axis because it changes the trust contract with the user.
- Skills are a packaging layer for repeatable team workflows, not just a prompt shortcut.
- Automations push the product from interactive coding assistant toward an **always-on engineering operator**.
- Multi-agent positioning suggests the app is a **control plane**, not just a chat UI.

## PM questions

- Which jobs should stay in `Suggest`-like mode by default?
- Which tasks justify `Auto Edit` or `Full Auto` despite higher risk?
- How should command approval, patch review, and automation review share one trust vocabulary?
- How should team-specific skills be created, governed, versioned, and discovered?
- What minimum UX makes parallel agents understandable instead of chaotic?

