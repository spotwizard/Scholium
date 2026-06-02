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
