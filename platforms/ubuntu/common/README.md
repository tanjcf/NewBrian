# NewBrain for Ubuntu

This workspace packages the shared NewBrain desktop application for Ubuntu Linux.
It uses Bash for shell execution and produces AppImage and Debian packages.

## Supported architectures

- `x64`: standard Intel/AMD 64-bit Ubuntu desktops
- `arm64`: Ubuntu on ARM64 devices

Ubuntu 22.04 LTS and newer are the initial support baseline.

## Development

```bash
pnpm install
pnpm --dir apps/desktop dev
```

Electron desktop sessions require a graphical environment. On a headless Ubuntu
host, use Xvfb for automated UI tests.

## Validation

```bash
pnpm --dir apps/agentd check
pnpm --dir packages/protocol check
pnpm --dir apps/desktop check
pnpm --dir apps/desktop test:package-resources
pnpm --dir apps/desktop build
```

## Packaging

```bash
pnpm package:linux:x64
pnpm package:linux:arm64
```

Artifacts are written to `apps/desktop/release` as AppImage and `.deb` files.
The target architecture must match the native Node/Electron dependencies used by
the package. Build each architecture on a matching Ubuntu runner or a verified
cross-build environment.

## Runtime dependencies

Typical Ubuntu desktop installations already provide the Electron runtime
libraries. Minimal installations may need GTK 3, NSS, ALSA, X11/GBM libraries,
and desktop integration packages before launching the application.

