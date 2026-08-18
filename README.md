# ⚡ WinFlow

A fast, lightweight, and modern clipboard manager and desktop utilities companion for Windows built with **Tauri v2**, **Rust**, **React 19**, **Tailwind CSS**, and **shadcn/ui**.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6.svg)
![RAM Footprint](https://img.shields.io/badge/RAM-~25MB-emerald.svg)

---

## ✨ Features

- 📋 **Text & Screenshot Capture**: Automatically listens to clipboard updates and stores plain/rich text, code blocks, URLs, and high-resolution screenshots.
- 🎨 **Screen Color Picker (`Alt + C`)**: Instant magnifying loupe that samples any pixel on your desktop and copies the `#HEX` code with one click.
- 🎨 **Color History Filter**: Dedicated color filter tab to quickly browse, review, and copy your captured palette colors.
- 🔄 **Smart Deduplication & Reordering**: Re-copying an item moves it straight to the top of your history with a refreshed timestamp.
- ⚡ **Instant Paste on Click / Enter**: Selecting any card or pressing `Enter` automatically writes to clipboard, closes the palette, and simulates `Ctrl + V` into your active input field.
- 📌 **Recent & Pinned Tabs**: Dedicated tab for pinned snippets and persistent items that survive history clears and computer restarts.
- 🔍 **Sub-Filters & Search**: Fast search with filter chips for **All**, **Text**, **Colors**, and **Images**.
- 🎯 **Smart Caret / Input Field Anchoring**: Automatically opens docked above or below your active text box, with edge-clamping and instant click-outside auto-close.
- ⚙️ **Custom Multi-Shortcuts**: Configure multiple global shortcuts for opening the clipboard or color picker directly in Settings.
- 🚀 **Windows Auto-Start**: Runs silently in the system tray on Windows startup.
- 🔄 **In-App Auto Updates**: Built-in automatic updates directly from GitHub Releases.

---

## 🛠️ Tech Stack

- **Backend**: [Tauri v2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/) (native Win32 API hooks & low memory footprint ~25MB)
- **Frontend**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) (Dark Emerald Theme)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/) (`cmdk`, `tabs`, `badges`, `scroll-area`, `context-menu`, `lucide-react`)

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Rust & Cargo](https://www.rust-lang.org/tools/install) (MSVC toolchain)

### Installation & Development

```bash
# Clone the repository
git clone https://github.com/ramizmortada/QuickClip.git
cd QuickClip

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
| `Alt + V` | Open / Toggle WinFlow Clipboard anywhere |
| `Alt + C` | Open / Toggle Screen Color Picker |
| `↑` / `↓` | Navigate clipboard items |
| `Enter` | Paste selected item into active field |
| `Ctrl + P` | Pin / Unpin selected item |
| `Delete` | Remove selected item |
| `Esc` | Hide WinFlow / Exit Color Picker |
