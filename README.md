# ⚡ QuickClip

A fast, lightweight, and modern clipboard manager for Windows built with **Tauri v2**, **Rust**, **React 19**, **Tailwind CSS**, and **shadcn/ui**.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6.svg)
![RAM Footprint](https://img.shields.io/badge/RAM-~25MB-emerald.svg)

---

## ✨ Features

- 📋 **Text & Screenshot Capture**: Automatically listens to clipboard updates and stores both plain/rich text and high-resolution screenshot images.
- 🔄 **Smart Deduplication & Reordering**: Re-copying an item moves it straight to the top of the history with a refreshed timestamp rather than creating duplicate entries.
- ⚡ **Auto-Paste on Click / Enter**: Selecting any card or pressing `Enter` automatically writes to clipboard, closes the palette, and simulates `Ctrl + V` into your active input field.
- 📌 **Recent & Pinned Tabs**: Dedicated tab for pinned snippets and persistent items that survive history clears and computer restarts.
- 🔍 **Sub-Filters & Search**: Fast search with filter chips for **All**, **Text Only**, and **Images Only**.
- 🎯 **Smart Caret / Input Field Anchoring**: Automatically opens docked above or below your active text box, with edge-clamping and instant click-outside auto-close.
- 🚀 **Windows Auto-Start**: Runs silently in the system tray on Windows startup.
- ⌨️ **Global Shortcut**: Press **`Alt + V`** anywhere on Windows to toggle the palette.

---

## 🛠️ Tech Stack

- **Backend**: [Tauri v2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/) (native Win32 API hooks & low memory footprint ~25MB)
- **Frontend**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/) (`cmdk`, `tabs`, `badges`, `scroll-area`, `context-menu`, `lucide-react`)

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Rust & Cargo](https://www.rust-lang.org/tools/install) (MSVC toolchain)

### Installation & Development

```bash
# Clone the repository
git clone https://github.com/ramizmortada/clipbaord.git
cd clipbaord

# Install dependencies
npm install

# Run in desktop development mode
npm run tauri:dev
```

### Production Build

```bash
npm run tauri:build
```
The compiled executable and installer will be generated in `src-tauri/target/release/`.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt + V` | Open / Toggle QuickClip anywhere |
| `↑` / `↓` | Navigate clipboard items |
| `Enter` | Paste selected item into active field |
| `Ctrl + P` | Pin / Unpin selected item |
| `Delete` | Remove selected item |
| `Esc` | Hide QuickClip |
