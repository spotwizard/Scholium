# Scholium

Scholium is a macOS Markdown notes app built with Tauri, React, and TypeScript.

## Development Environment

Required tools:

- Xcode Command Line Tools
- Node.js 22
- Rust stable toolchain
- npm

This machine currently uses Homebrew `node@22` and Homebrew `rustup`, so prepend both paths when running project commands:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH"
```

## Commands

Install dependencies:

```bash
npm install
```

Run the Vite web dev server:

```bash
npm run dev
```

Run the macOS desktop app in development mode:

```bash
npm run tauri dev
```

Build the frontend:

```bash
npm run build
```

Build the macOS app and installer:

```bash
npm run tauri build
```

Build outputs:

- `src-tauri/target/release/bundle/macos/Scholium.app`
- `src-tauri/target/release/bundle/dmg/Scholium_0.1.0_aarch64.dmg`

## Git Flow

Development follows a Git Flow style branch model:

- `main` keeps production-ready history
- `develop` is the integration branch for active development
- `feature/*` branches start from `develop` and open pull requests back to `develop`
- `release/*` branches start from `develop` and open pull requests back to `main`
- `hotfix/*` branches start from `main` and open pull requests back to `main`

Use concise Traditional Chinese commit messages, for example:

```bash
git commit -m "建立 Markdown 編輯器介面"
```

Pull requests should describe the user-facing change, verification steps, and any follow-up work.
