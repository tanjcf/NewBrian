/**
 * Lightweight local-first project entrypoint detection for prompt / prep hints.
 * Prefer npm/pnpm/python over docker compose unless the user asked for containers.
 */

export type LocalBootstrapKind = "node" | "python" | "unknown";

export interface LocalBootstrapHint {
  kind: LocalBootstrapKind;
  /** Human-readable preferred commands (local first). */
  preferredCommands: string[];
  /** True when docker compose files exist but local entrypoints also exist. */
  dockerPresent: boolean;
  /** Short Chinese/English guidance for the model. */
  guidance: string;
}

function hasAny(names: Set<string>, candidates: string[]) {
  return candidates.some((name) => names.has(name));
}

/**
 * @param entryNames Root-level file/dir names from workspace.scan (or equivalent).
 */
export function detectLocalProjectBootstrap(entryNames: Iterable<string> = []): LocalBootstrapHint {
  const names = new Set(
    [...entryNames].map((name) => String(name ?? "").trim().replace(/\\/g, "/").split("/").pop() || "")
      .filter(Boolean)
      .map((name) => name.toLowerCase())
  );

  const dockerPresent = hasAny(names, [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    "dockerfile"
  ]);

  const isNode = hasAny(names, ["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);
  const isPython = hasAny(names, [
    "pyproject.toml",
    "requirements.txt",
    "manage.py",
    "setup.py",
    "pipfile"
  ]);

  if (isNode) {
    const preferredCommands = [
      "pnpm install / npm install (when dependencies missing)",
      "pnpm dev / npm run dev / npm start",
      "node ./… for one-off scripts"
    ];
    return {
      kind: "node",
      preferredCommands,
      dockerPresent,
      guidance: dockerPresent
        ? "Detected Node project markers (package.json). Prefer local npm/pnpm/node. Do not default to docker compose unless the user asks or local scripts are missing."
        : "Detected Node project markers (package.json). Prefer local npm/pnpm/node to install and start."
    };
  }

  if (isPython) {
    const preferredCommands = [
      "py -3 / python -m pip install -r requirements.txt (when needed)",
      "py -3 manage.py runserver / python -m uvicorn … / python main.py",
      "Prefer the launcher that already works on this host (py or python)"
    ];
    return {
      kind: "python",
      preferredCommands,
      dockerPresent,
      guidance: dockerPresent
        ? "Detected Python project markers (pyproject.toml / requirements.txt / manage.py). Prefer local py/python/uvicorn. Do not default to docker compose unless the user asks or no local entrypoint exists."
        : "Detected Python project markers. Prefer local py/python/uvicorn to install and start."
    };
  }

  return {
    kind: "unknown",
    preferredCommands: [],
    dockerPresent,
    guidance: dockerPresent
      ? "No clear local Node/Python entrypoint detected. Only use docker compose when the user asks for containers or after confirming there is no local start script."
      : "No clear local Node/Python entrypoint detected. Inspect package manifests before choosing a start command."
  };
}
