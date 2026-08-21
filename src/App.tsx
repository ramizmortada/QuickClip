import { useState, useEffect, useMemo, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import {
  Search,
  Pin,
  Trash2,
  Copy,
  Code2,
  Link2,
  FileText,
  Image as ImageIcon,
  Check,
  Sparkles,
  Command as CommandIcon,
  X,
  Maximize2,
  Clock,
  Layers,
  RefreshCw,
  Settings,
  Keyboard,
  RotateCcw,
  AlertCircle,
  Plus,
  Pipette,
  Download,
  ChevronUp,
  ChevronDown,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import ColorPickerOverlay from "./components/ColorPickerOverlay"

export interface ClipboardItem {
  id: string
  content_type: "text" | "code" | "link" | "image"
  text_content?: string | null
  image_data_url?: string | null
  image_width?: number | null
  image_height?: number | null
  image_size_bytes?: number | null
  hash: string
  copied_at: string
  is_pinned: boolean
  char_count?: number | null
  language?: string | null
}

function formatTimeAMPM(timeStr?: string | null): string {
  if (!timeStr) return ""
  const trimmed = timeStr.trim()
  if (/am|pm/i.test(trimmed)) return trimmed

  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (match) {
    let hours = parseInt(match[1], 10)
    const minutes = match[2]
    const ampm = hours >= 12 ? "PM" : "AM"
    hours = hours % 12 || 12
    return `${hours}:${minutes} ${ampm}`
  }

  const d = new Date(trimmed)
  if (!isNaN(d.getTime())) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
  }

  return trimmed
}

function formatKeyDisplayName(key: string): string {
  const k = key.trim()
  if (k.toLowerCase() === "super" || k.toLowerCase() === "meta") return "Win"
  if (k.toLowerCase() === "command") return "Cmd"
  if (k.toLowerCase() === "control") return "Ctrl"
  if (k.toLowerCase() === "backquote") return "`"
  return k
}

function formatShortcutDisplay(shortcutStr: string): string {
  if (!shortcutStr) return ""
  return shortcutStr
    .split("+")
    .map((k) => formatKeyDisplayName(k))
    .join(" + ")
}

function getInitialWindowLabel(): string {
  try {
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      const win = getCurrentWebviewWindow()
      return win?.label || "main"
    }
  } catch {}
  return "main"
}

export default function App() {
  const [windowLabel, setWindowLabel] = useState<string>(getInitialWindowLabel)
  const [items, setItems] = useState<ClipboardItem[]>([])
  const [primaryTab, setPrimaryTab] = useState<"recent" | "pinned">("recent")
  const [typeFilter, setTypeFilter] = useState<"all" | "text" | "image" | "color">("all")
  const [search, setSearch] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false)
  const [showSettings, setShowSettings] = useState<boolean>(false)
  const [globalShortcuts, setGlobalShortcuts] = useState<string[]>(["Alt+V"])
  const [colorPickerShortcut, setColorPickerShortcut] = useState<string>("Alt+C")
  const [recordingTarget, setRecordingTarget] = useState<"clipboard" | "picker" | null>(null)
  const [recordedKeys, setRecordedKeys] = useState<string[]>([])
  const [shortcutError, setShortcutError] = useState<string | null>(null)
  const [shortcutSuccess, setShortcutSuccess] = useState<string | null>(null)

  const [updateInfo, setUpdateInfo] = useState<Update | null>(null)
  const [isUpdating, setIsUpdating] = useState<boolean>(false)
  const [isCheckingUpdates, setIsCheckingUpdates] = useState<boolean>(false)
  const [updateStatusText, setUpdateStatusText] = useState<string>("")
  const [updateNotice, setUpdateNotice] = useState<string | null>(null)
  const [savedImageId, setSavedImageId] = useState<string | null>(null)
  const [canScrollUp, setCanScrollUp] = useState<boolean>(false)
  const [canScrollDown, setCanScrollDown] = useState<boolean>(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const isInitialFocusRef = useRef<boolean>(false)

  // Ensure window label is synchronized
  useEffect(() => {
    try {
      const currentWin = getCurrentWebviewWindow()
      if (currentWin && currentWin.label) {
        setWindowLabel(currentWin.label)
      }
    } catch {
      // Browser preview mode
    }
  }, [])

  // 1. Fetch initial clipboard history and listen for live updates
  useEffect(() => {
    if (windowLabel === "picker") return

    // Initial fetch from Rust backend
    invoke<ClipboardItem[]>("get_history")
      .then((data) => {
        if (data && data.length > 0) {
          setItems(data)
        }
      })
      .catch((err) => {
        console.warn("Could not fetch history via Tauri IPC (Running in browser mode):", err)
      })

    // Fetch active global shortcuts
    invoke<string[]>("get_shortcuts")
      .then((shortcuts) => {
        if (shortcuts && shortcuts.length > 0) {
          setGlobalShortcuts(shortcuts)
        }
      })
      .catch(() => {})

    // Fetch color picker shortcut
    invoke<string>("get_color_picker_shortcut")
      .then((sc) => {
        if (sc) setColorPickerShortcut(sc)
      })
      .catch(() => {})

    // Listen for live updates emitted by Rust background thread
    let unlistenClipboard: (() => void) | undefined
    listen<ClipboardItem[]>("clipboard-updated", (event) => {
      setItems(event.payload)
    }).then((fn) => {
      unlistenClipboard = fn
    }).catch((err) => {
      console.warn("Event listener not registered in browser preview:", err)
    })

    // Listen for check-for-updates event from System Tray
    let unlistenTrayUpdate: (() => void) | undefined
    listen("check-for-updates", () => {
      checkUpdates(true)
    }).then((fn) => {
      unlistenTrayUpdate = fn
    }).catch(() => {})

    // Auto-focus search, reset scroll to top & auto-check for updates whenever window is opened
    const handleFocus = () => {
      searchInputRef.current?.focus()
      checkUpdates(false)
      setSelectedIndex(0)
      if (viewportRef.current) {
        viewportRef.current.scrollTop = 0
      }
      // Temporarily ignore mouseenter so opening over mouse cursor does not jump selection
      isInitialFocusRef.current = true
      setTimeout(() => {
        isInitialFocusRef.current = false
      }, 150)
    }
    window.addEventListener("focus", handleFocus)

    // Periodic background check every 15 minutes
    const interval = setInterval(() => {
      checkUpdates(false)
    }, 15 * 60 * 1000)

    return () => {
      if (unlistenClipboard) unlistenClipboard()
      if (unlistenTrayUpdate) unlistenTrayUpdate()
      window.removeEventListener("focus", handleFocus)
      clearInterval(interval)
    }
  }, [windowLabel])

  // Check for app updates via GitHub Releases
  const checkUpdates = async (manual = false) => {
    try {
      if (manual) {
        setIsCheckingUpdates(true)
        setUpdateNotice("Checking for updates...")
      }
      const update = await check()
      if (update) {
        setUpdateInfo(update)
        setUpdateNotice(null)
      } else if (manual) {
        setUpdateNotice("WinFlow is up to date!")
        setTimeout(() => setUpdateNotice(null), 3000)
      }
    } catch (err) {
      console.log("Update check:", err)
      if (manual) {
        setUpdateNotice("Could not connect to update server")
        setTimeout(() => setUpdateNotice(null), 3000)
      }
    } finally {
      if (manual) setIsCheckingUpdates(false)
    }
  }

  useEffect(() => {
    if (windowLabel !== "picker") {
      checkUpdates(false)
    }
  }, [windowLabel])

  const handleDownloadAndInstallUpdate = async () => {
    if (!updateInfo) return
    try {
      setIsUpdating(true)
      setUpdateStatusText("Downloading...")
      let downloaded = 0
      let contentLength = 0
      await updateInfo.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength || 0
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength
          if (contentLength > 0) {
            const pct = Math.round((downloaded / contentLength) * 100)
            setUpdateStatusText(`Downloading ${pct}%...`)
          }
        } else if (event.event === "Finished") {
          setUpdateStatusText("Restarting...")
        }
      })
      await relaunch()
    } catch (e) {
      console.error("Update error:", e)
      setUpdateStatusText("Failed")
      setTimeout(() => setIsUpdating(false), 2500)
    }
  }

  // Handle adding a new global shortcut for Clipboard toggle
  const handleAddShortcut = async (newShortcutStr: string) => {
    try {
      setShortcutError(null)
      const updated = await invoke<string[]>("add_shortcut", { newShortcut: newShortcutStr })
      setGlobalShortcuts(updated)
      setShortcutSuccess(`Added ${formatShortcutDisplay(newShortcutStr)}`)
      setRecordingTarget(null)
      setRecordedKeys([])
      setTimeout(() => setShortcutSuccess(null), 3000)
    } catch (err: any) {
      console.error("Failed to add shortcut:", err)
      setShortcutError(typeof err === "string" ? err : "Could not register shortcut")
    }
  }

  // Handle removing a global shortcut
  const handleRemoveShortcut = async (shortcutToRemove: string) => {
    try {
      setShortcutError(null)
      const updated = await invoke<string[]>("remove_shortcut", { shortcutToRemove })
      setGlobalShortcuts(updated)
      setShortcutSuccess(`Removed ${formatShortcutDisplay(shortcutToRemove)}`)
      setTimeout(() => setShortcutSuccess(null), 3000)
    } catch (err: any) {
      console.error("Failed to remove shortcut:", err)
      setShortcutError(typeof err === "string" ? err : "Could not remove shortcut")
    }
  }

  // Handle resetting clipboard shortcuts to default
  const handleResetShortcuts = async () => {
    try {
      setShortcutError(null)
      const updated = await invoke<string[]>("reset_shortcuts")
      setGlobalShortcuts(updated)
      setShortcutSuccess("Reset to Alt + V")
      setRecordingTarget(null)
      setRecordedKeys([])
      setTimeout(() => setShortcutSuccess(null), 3000)
    } catch (err: any) {
      console.error("Failed to reset shortcuts:", err)
      setShortcutError(typeof err === "string" ? err : "Could not reset shortcuts")
    }
  }

  // Handle saving color picker shortcut
  const handleSaveColorPickerShortcut = async (newShortcutStr: string) => {
    try {
      setShortcutError(null)
      const saved = await invoke<string>("set_color_picker_shortcut", { newShortcut: newShortcutStr })
      setColorPickerShortcut(saved)
      setShortcutSuccess(`Color Picker shortcut set to ${formatShortcutDisplay(saved)}`)
      setRecordingTarget(null)
      setRecordedKeys([])
      setTimeout(() => setShortcutSuccess(null), 3000)
    } catch (err: any) {
      console.error("Failed to set color picker shortcut:", err)
      setShortcutError(typeof err === "string" ? err : "Could not register shortcut")
    }
  }

  // Intercept key recording in Settings Modal
  useEffect(() => {
    if (!recordingTarget) return

    const handleRecordKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === "Escape") {
        setRecordingTarget(null)
        setRecordedKeys([])
        return
      }

      const isModifier = ["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(e.key)
      const modifiers: string[] = []
      if (e.ctrlKey) modifiers.push("Ctrl")
      if (e.altKey) modifiers.push("Alt")
      if (e.shiftKey) modifiers.push("Shift")
      if (e.metaKey) modifiers.push("Super")

      if (isModifier) {
        setRecordedKeys(modifiers)
        return
      }

      let keyName = ""
      if (e.code.startsWith("Key")) {
        keyName = e.code.slice(3).toUpperCase()
      } else if (e.code.startsWith("Digit")) {
        keyName = e.code.slice(5)
      } else if (e.code === "Space") {
        keyName = "Space"
      } else if (e.code === "Backquote") {
        keyName = "Backquote"
      } else if (/^F\d{1,2}$/i.test(e.key)) {
        keyName = e.key.toUpperCase()
      } else {
        keyName = e.key.toUpperCase()
      }

      const allKeys = [...modifiers]
      if (!allKeys.includes(keyName)) {
        allKeys.push(keyName)
      }

      setRecordedKeys(allKeys)

      if (modifiers.length > 0 && keyName) {
        const candidate = `${modifiers.join("+")}+${keyName}`
        if (recordingTarget === "clipboard") {
          handleAddShortcut(candidate)
        } else if (recordingTarget === "picker") {
          handleSaveColorPickerShortcut(candidate)
        }
      } else {
        setShortcutError("Please include at least one modifier key (Alt, Win, Ctrl, or Shift)")
      }
    }

    window.addEventListener("keydown", handleRecordKey, true)
    return () => window.removeEventListener("keydown", handleRecordKey, true)
  }, [recordingTarget])

function isHexColorItem(item: ClipboardItem): boolean {
  if (!item.text_content) return false
  return /^#[0-9A-Fa-f]{6}$/.test(item.text_content.trim())
}

// Filter items based on Primary Tab (Recent vs Pinned), Type Filter, and Search
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 1. Primary tab filter
      if (primaryTab === "pinned" && !item.is_pinned) {
        return false
      }

      // 2. Content type filter
      if (typeFilter === "text" && (item.content_type === "image" || isHexColorItem(item))) {
        return false
      }
      if (typeFilter === "image" && item.content_type !== "image") {
        return false
      }
      if (typeFilter === "color" && !isHexColorItem(item)) {
        return false
      }

      // 3. Search query filter
      if (!search.trim()) return true
      const q = search.toLowerCase()

      if (item.content_type === "image") {
        return (
          item.copied_at.toLowerCase().includes(q) ||
          formatTimeAMPM(item.copied_at).toLowerCase().includes(q) ||
          (item.image_width && `${item.image_width}x${item.image_height}`.includes(q)) ||
          "image screenshot graphic".includes(q)
        )
      }

      if (item.text_content) {
        return (
          item.text_content.toLowerCase().includes(q) ||
          (item.language && item.language.toLowerCase().includes(q)) ||
          item.copied_at.toLowerCase().includes(q) ||
          formatTimeAMPM(item.copied_at).toLowerCase().includes(q)
        )
      }

      return false
    })
  }, [items, primaryTab, typeFilter, search])

  // Reset selected index on filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [search, primaryTab, typeFilter])

  // Reset selected index if list length changes
  useEffect(() => {
    if (selectedIndex >= filteredItems.length && filteredItems.length > 0) {
      setSelectedIndex(0)
    }
  }, [filteredItems.length, selectedIndex])

  // Auto-scroll to selected card during keyboard navigation
  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex)
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "auto" })
    }
  }, [selectedIndex])

  // Scroll helper functions
  const handleScroll = () => {
    const el = viewportRef.current
    if (!el) return
    const hasScroll = el.scrollHeight > el.clientHeight + 4
    setCanScrollUp(hasScroll && el.scrollTop > 20)
    setCanScrollDown(hasScroll && el.scrollTop + el.clientHeight < el.scrollHeight - 20)
  }

  useEffect(() => {
    const timer = setTimeout(handleScroll, 50)
    return () => clearTimeout(timer)
  }, [filteredItems.length, selectedIndex])

  const scrollToTop = () => {
    setSelectedIndex(0)
    if (viewportRef.current) {
      viewportRef.current.scrollTo({ top: 0, behavior: "smooth" })
    }
  }

  const scrollToBottom = () => {
    const lastIdx = Math.max(filteredItems.length - 1, 0)
    setSelectedIndex(lastIdx)
    if (viewportRef.current) {
      viewportRef.current.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" })
    }
  }

  // Paste selected item into active input field and close clipboard
  const handlePaste = async (item: ClipboardItem) => {
    try {
      await invoke("paste_item", { id: item.id })
    } catch {
      // Fallback for browser preview
      if (item.text_content) {
        await navigator.clipboard.writeText(item.text_content)
      }
      handleClose()
    }
  }

  // Pure Copy (without closing)
  const handleCopyOnly = async (item: ClipboardItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    try {
      await invoke("copy_to_system", { id: item.id })
    } catch {
      if (item.text_content) {
        await navigator.clipboard.writeText(item.text_content)
      }
    }
    setCopiedId(item.id)
    setTimeout(() => setCopiedId(null), 1000)
  }

  // Toggle Pin
  const handleTogglePin = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    try {
      const updated = await invoke<ClipboardItem[]>("toggle_pin", { id })
      setItems(updated)
    } catch {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, is_pinned: !i.is_pinned } : i))
      )
    }
  }

  // Delete Item
  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    try {
      const updated = await invoke<ClipboardItem[]>("delete_item", { id })
      setItems(updated)
    } catch {
      setItems((prev) => prev.filter((i) => i.id !== id))
    }
  }

  // Save Image to disk (Downloads folder)
  const handleSaveImage = async (item: ClipboardItem, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!item.image_data_url) return

    try {
      const filename = `WinFlow_Screenshot_${Date.now()}.png`
      await invoke<string>("save_image_to_disk", {
        dataUrl: item.image_data_url,
        defaultName: filename,
      })
      setSavedImageId(item.id)
      setTimeout(() => setSavedImageId(null), 2000)
    } catch (err) {
      console.error("Save image failed via Rust, using fallback:", err)
      const link = document.createElement("a")
      link.href = item.image_data_url
      link.download = `WinFlow_Screenshot_${Date.now()}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setSavedImageId(item.id)
      setTimeout(() => setSavedImageId(null), 2000)
    }
  }

  // Clear Unpinned History
  const handleClearUnpinned = async () => {
    try {
      const updated = await invoke<ClipboardItem[]>("clear_unpinned")
      setItems(updated)
    } catch {
      setItems((prev) => prev.filter((i) => i.is_pinned))
    }
  }

  // Hide Window
  const handleClose = () => {
    invoke("hide_window").catch(() => {})
  }

  // Global Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (recordingTarget) return

      if (e.key === "Escape") {
        if (previewImage) {
          setPreviewImage(null)
        } else if (showSettings) {
          setShowSettings(false)
        } else if (showClearConfirm) {
          setShowClearConfirm(false)
        } else {
          handleClose()
        }
        return
      }

      if (showSettings || showClearConfirm) return

      if (e.key === "ArrowDown") {
        e.preventDefault()
        if (e.ctrlKey || e.metaKey) {
          scrollToBottom()
        } else {
          setSelectedIndex((prev) => Math.min(prev + 1, Math.max(filteredItems.length - 1, 0)))
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        if (e.ctrlKey || e.metaKey) {
          scrollToTop()
        } else {
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
        }
      } else if (e.key === "Home") {
        e.preventDefault()
        scrollToTop()
      } else if (e.key === "End") {
        e.preventDefault()
        scrollToBottom()
      } else if (e.key === "PageDown") {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 5, Math.max(filteredItems.length - 1, 0)))
      } else if (e.key === "PageUp") {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 5, 0))
      } else if (e.key === "Enter" && filteredItems[selectedIndex]) {
        e.preventDefault()
        handlePaste(filteredItems[selectedIndex])
      } else if (e.key === "p" && (e.ctrlKey || e.metaKey) && filteredItems[selectedIndex]) {
        e.preventDefault()
        handleTogglePin(filteredItems[selectedIndex].id)
      } else if (e.key === "Delete" && filteredItems[selectedIndex]) {
        e.preventDefault()
        handleDelete(filteredItems[selectedIndex].id)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [filteredItems, selectedIndex, previewImage, showSettings, showClearConfirm, recordingTarget])

  // If this window is the fullscreen Color Picker overlay, render ColorPickerOverlay
  if (windowLabel === "picker") {
    return <ColorPickerOverlay />
  }

  const pinnedCount = useMemo(() => items.filter((i) => i.is_pinned).length, [items])
  const colorCount = useMemo(() => items.filter(isHexColorItem).length, [items])
  const textCount = useMemo(
    () => items.filter((i) => i.content_type !== "image" && !isHexColorItem(i)).length,
    [items]
  )
  const imageCount = useMemo(() => items.filter((i) => i.content_type === "image").length, [items])

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden rounded-2xl border border-emerald-800/60 bg-[#070f0a]/98 text-emerald-50 shadow-2xl backdrop-blur-2xl select-none">
      {/* Row 1: Search Input + Color Picker + Settings & Actions */}
      <div className="relative flex items-center justify-between border-b border-emerald-900/60 px-3 py-2 bg-[#091710]/70">
        <div className="flex flex-1 items-center mr-2">
          <Search className="h-3.5 w-3.5 text-emerald-400/70 shrink-0 mr-2" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clipboard history..."
            className="w-full bg-transparent text-xs text-emerald-100 placeholder:text-emerald-500/50 focus:outline-none"
            autoFocus
          />
          {search && (
            <button
              onClick={() => {
                setSearch("")
                searchInputRef.current?.focus()
              }}
              className="text-emerald-500 hover:text-emerald-300 mr-1 text-xs"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 border-l border-emerald-900/60 pl-2">
          {/* Color Picker Eyedropper Button */}
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => invoke("start_color_picker").catch(() => {})}
            title={`Screen Color Picker (${formatShortcutDisplay(colorPickerShortcut)})`}
            className="text-emerald-400/70 hover:text-[#14ad72] hover:bg-emerald-900/40 h-6 w-6"
          >
            <Pipette className="h-3.5 w-3.5" />
          </Button>

          {/* Settings Button */}
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => {
              setShowSettings(true)
              setShortcutError(null)
              setShortcutSuccess(null)
              setRecordingTarget(null)
            }}
            title="Settings & Shortcuts"
            className="text-emerald-400/70 hover:text-[#14ad72] hover:bg-emerald-900/40 h-6 w-6"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>

          {/* Refresh / Check updates button */}
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => checkUpdates(true)}
            title="Check for updates"
            className="text-emerald-400/70 hover:text-emerald-300 hover:bg-emerald-900/40 h-6 w-6"
          >
            <RefreshCw className={`h-3 w-3 ${isCheckingUpdates ? "animate-spin text-emerald-400" : ""}`} />
          </Button>

          {/* Clear history button */}
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => setShowClearConfirm(true)}
            title="Clear unpinned history"
            className="text-emerald-400/70 hover:text-red-400 hover:bg-red-500/10 h-6 w-6"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>

          {/* Close button */}
          <Button
            variant="ghost"
            size="iconSm"
            onClick={handleClose}
            title="Close (Esc)"
            className="text-emerald-400/70 hover:text-emerald-200 hover:bg-emerald-900/40 h-6 w-6"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Manual Check Update Notice (if active) */}
      {updateNotice && (
        <div className="flex items-center justify-between border-b border-emerald-700/40 bg-emerald-950/80 px-3 py-1 text-[11px] text-emerald-200 animate-in fade-in-50">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-[#14ad72]" />
            <span>{updateNotice}</span>
          </div>
          <button
            onClick={() => setUpdateNotice(null)}
            className="text-emerald-400 hover:text-emerald-200"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Row 2: Dual Segmented Controls Side-by-Side */}
      <div className="flex items-center justify-between border-b border-emerald-900/60 px-2.5 py-1.5 bg-[#08130d]/80 gap-2">
        {/* Left: Recent vs Pinned Tabs */}
        <div className="inline-flex h-6.5 items-center rounded-lg bg-[#06100a] p-0.5 border border-emerald-900/60">
          <button
            onClick={() => setPrimaryTab("recent")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${
              primaryTab === "recent"
                ? "bg-emerald-900/60 text-emerald-300 shadow-sm border border-emerald-700/40"
                : "text-emerald-400/60 hover:text-emerald-200"
            }`}
          >
            <Clock className="h-3 w-3" />
            <span>Recent</span>
            <span className="text-[9px] opacity-60">({items.length})</span>
          </button>
          <button
            onClick={() => setPrimaryTab("pinned")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${
              primaryTab === "pinned"
                ? "bg-emerald-900/60 text-amber-300 shadow-sm border border-amber-500/40"
                : "text-emerald-400/60 hover:text-emerald-200"
            }`}
          >
            <Pin className="h-3 w-3" />
            <span>Pinned</span>
            <span className="text-[9px] opacity-60">({pinnedCount})</span>
          </button>
        </div>

        {/* Right: Icon-based Filters with Tooltips */}
        <div className="inline-flex h-6.5 items-center rounded-lg bg-[#06100a] p-0.5 border border-emerald-900/60">
          <button
            onClick={() => setTypeFilter("all")}
            className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10px] font-medium transition-all ${
              typeFilter === "all"
                ? "bg-emerald-900/60 text-emerald-100 shadow-sm border border-emerald-700/40"
                : "text-emerald-400/60 hover:text-emerald-200"
            }`}
            title="Show All"
          >
            <Layers className="h-3 w-3 mr-1" />
            <span>All</span>
          </button>
          <button
            onClick={() => setTypeFilter("text")}
            className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10px] font-medium transition-all ${
              typeFilter === "text"
                ? "bg-emerald-900/60 text-emerald-300 shadow-sm border border-emerald-700/40"
                : "text-emerald-400/60 hover:text-emerald-200"
            }`}
            title={`Text & Code (${textCount})`}
          >
            <FileText className="h-3 w-3" />
          </button>
          <button
            onClick={() => setTypeFilter("color")}
            className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10px] font-medium transition-all ${
              typeFilter === "color"
                ? "bg-emerald-900/60 text-[#14ad72] shadow-sm border border-[#14ad72]/60 font-semibold"
                : "text-emerald-400/60 hover:text-emerald-200"
            }`}
            title={`Colors & Hex (${colorCount})`}
          >
            <Pipette className="h-3 w-3" />
          </button>
          <button
            onClick={() => setTypeFilter("image")}
            className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10px] font-medium transition-all ${
              typeFilter === "image"
                ? "bg-emerald-900/60 text-amber-300 shadow-sm border border-amber-500/40"
                : "text-emerald-400/60 hover:text-emerald-200"
            }`}
            title={`Screenshots & Images (${imageCount})`}
          >
            <ImageIcon className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Clipboard Items Scroll Area Container */}
      <div className="relative flex-1 overflow-hidden flex flex-col min-h-0">
        {/* Subtle Top Gradient Shadow */}
        {canScrollUp && (
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-[#070f0a]/90 to-transparent z-10" />
        )}

        {/* Centered Jump to Top Arrow */}
        {canScrollUp && (
          <button
            onClick={scrollToTop}
            title="Scroll to Top (Home / Ctrl+↑)"
            className="absolute top-1.5 left-1/2 -translate-x-1/2 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-[#06120b]/80 border border-emerald-600/30 text-emerald-400/70 shadow-md backdrop-blur-sm opacity-60 hover:opacity-100 hover:text-emerald-200 hover:bg-emerald-900/80 hover:border-emerald-500/60 transition-all cursor-pointer animate-in fade-in"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        )}

        <ScrollArea
          viewportRef={viewportRef}
          onScroll={handleScroll}
          className="flex-1 px-2.5 py-2"
        >
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-emerald-500/60">
              <Sparkles className="h-8 w-8 mb-2 stroke-1 text-emerald-600/50" />
              <p className="text-xs font-medium text-emerald-200">
                {primaryTab === "pinned"
                  ? "No pinned items yet"
                  : "Clipboard history is empty"}
              </p>
              <p className="text-[11px] text-emerald-400/50 mt-1 max-w-[220px]">
                {primaryTab === "pinned"
                  ? "Pin any copied text or screenshot to access it quickly anytime."
                  : search
                  ? "No items match your search filter."
                  : "Copy text, screenshot, or pick a color with Alt+C to see it appear live."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 pb-2">
              {filteredItems.map((item, idx) => {
                const isSelected = selectedIndex === idx
                const isCopied = copiedId === item.id
                const isImage = item.content_type === "image"
                const formattedTime = formatTimeAMPM(item.copied_at)

                // Check if item looks like a hex color code
                const isHexColor =
                  item.text_content && /^#[0-9A-Fa-f]{6}$/.test(item.text_content.trim())

                return (
                  <ContextMenu key={item.id}>
                    <ContextMenuTrigger>
                      <div
                        ref={(el) => {
                          if (el) itemRefs.current.set(idx, el)
                          else itemRefs.current.delete(idx)
                        }}
                        onClick={() => {
                          setSelectedIndex(idx)
                          handlePaste(item)
                        }}
                        onMouseEnter={() => {
                          if (!isInitialFocusRef.current) {
                            setSelectedIndex(idx)
                          }
                        }}
                        className={`group relative flex flex-col gap-1.5 rounded-xl border p-2.5 transition-all cursor-pointer ${
                          isSelected
                            ? "border-emerald-500/60 bg-[#0d2218]/90 shadow-md ring-1 ring-emerald-500/30"
                            : "border-emerald-900/40 bg-[#09150f]/60 hover:border-emerald-700/50 hover:bg-[#0c1d14]/80"
                        }`}
                      >
                        {/* Top metadata row */}
                        <div className="flex items-center justify-between text-[10px] text-emerald-400/70">
                          <div className="flex items-center gap-1.5">
                            {isImage ? (
                              <>
                                <ImageIcon className="h-3.5 w-3.5 text-amber-400" />
                                <span className="capitalize font-medium text-amber-300">
                                  Image / Screenshot
                                </span>
                                {item.image_width && item.image_height && (
                                  <Badge variant="warning" className="h-3.5 px-1 font-mono">
                                    {item.image_width}×{item.image_height}
                                  </Badge>
                                )}
                              </>
                            ) : isHexColor ? (
                              <>
                                <Pipette className="h-3.5 w-3.5 text-[#14ad72]" />
                                <span className="capitalize font-medium text-emerald-300">
                                  Color Hex
                                </span>
                              </>
                            ) : item.content_type === "code" ? (
                              <>
                                <Code2 className="h-3.5 w-3.5 text-emerald-400" />
                                <span className="capitalize font-medium text-emerald-300">Code</span>
                                {item.language && (
                                  <Badge variant="accent" className="h-3.5 px-1 uppercase">
                                    {item.language}
                                  </Badge>
                                )}
                              </>
                            ) : item.content_type === "link" ? (
                              <>
                                <Link2 className="h-3.5 w-3.5 text-teal-400" />
                                <span className="capitalize font-medium text-teal-300">
                                  Link
                                </span>
                              </>
                            ) : (
                              <>
                                <FileText className="h-3.5 w-3.5 text-emerald-400/80" />
                                <span className="capitalize font-medium text-emerald-300">
                                  Text
                                </span>
                              </>
                            )}
                          </div>

                          {/* Right side: Metadata + Timestamp + Action Buttons */}
                          <div className="flex items-center gap-1.5">
                            {item.char_count && (
                              <span className="text-[10px] text-emerald-500/70">{item.char_count} chars</span>
                            )}
                            <span className="text-[10px] text-emerald-500/80 font-mono">{formattedTime}</span>

                            {/* Quick Pin, Save & Delete Action Buttons (Always Visible) */}
                            <div className="flex items-center gap-0.5 ml-0.5">
                              {isImage && item.image_data_url && (
                                <button
                                  onClick={(e) => handleSaveImage(item, e)}
                                  className={`p-1 rounded transition-colors ${
                                    savedImageId === item.id
                                      ? "text-emerald-400 bg-emerald-900/60"
                                      : "text-amber-400/80 hover:text-amber-300 hover:bg-amber-500/10"
                                  }`}
                                  title={savedImageId === item.id ? "Saved to Downloads!" : "Save image to Downloads"}
                                >
                                  {savedImageId === item.id ? (
                                    <Check className="h-3 w-3" />
                                  ) : (
                                    <Download className="h-3 w-3" />
                                  )}
                                </button>
                              )}

                              <button
                                onClick={(e) => handleTogglePin(item.id, e)}
                                className={`p-1 rounded hover:bg-emerald-900/60 transition-colors ${
                                  item.is_pinned
                                    ? "text-amber-400 fill-amber-400"
                                    : "text-emerald-500/60 hover:text-amber-300"
                                }`}
                                title={item.is_pinned ? "Unpin Item (Ctrl+P)" : "Pin to Top (Ctrl+P)"}
                              >
                                <Pin
                                  className={`h-3 w-3 ${item.is_pinned ? "fill-amber-400 text-amber-400" : ""}`}
                                />
                              </button>
                              <button
                                onClick={(e) => handleDelete(item.id, e)}
                                className="p-1 rounded text-emerald-500/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Delete Item (Del)"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Content Preview */}
                        {isImage && item.image_data_url ? (
                          <div className="relative rounded-lg overflow-hidden border border-emerald-900/50 bg-[#050c08] max-h-24 flex items-center justify-center group/img">
                            <img
                              src={item.image_data_url}
                              alt="Copied clipboard content"
                              className="max-h-24 w-full object-contain rounded-md"
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setPreviewImage(item.image_data_url!)
                              }}
                              className="absolute top-1.5 right-1.5 p-1 rounded-md bg-[#0a1811]/90 hover:bg-[#0f241a] text-emerald-300 opacity-0 group-hover/img:opacity-100 transition-opacity"
                              title="Expand preview"
                            >
                              <Maximize2 className="h-3 w-3" />
                            </button>
                          </div>
                        ) : isHexColor ? (
                          <div className="flex items-center gap-2 py-0.5">
                            <span
                              className="h-5 w-5 rounded-md border border-white/30 shadow-sm shrink-0"
                              style={{ backgroundColor: item.text_content!.trim() }}
                            />
                            <span className="font-mono text-xs font-semibold text-emerald-100">
                              {item.text_content!.trim()}
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs text-emerald-100/90 font-normal line-clamp-2 break-all whitespace-pre-wrap font-sans select-text">
                            {item.text_content}
                          </div>
                        )}

                        {/* Copied feedback overlay */}
                        {isCopied && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[#071f13]/90 border border-emerald-500/70 backdrop-blur-sm animate-in fade-in-50">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-200">
                              <Check className="h-4 w-4 text-[#14ad72]" />
                              Copied to Clipboard!
                            </div>
                          </div>
                        )}
                      </div>
                    </ContextMenuTrigger>

                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => handlePaste(item)}>
                        <Check className="mr-2 h-3.5 w-3.5 text-[#14ad72]" />
                        Paste into Input Field
                      </ContextMenuItem>
                      <ContextMenuItem onClick={(e) => handleCopyOnly(item, e)}>
                        <Copy className="mr-2 h-3.5 w-3.5 text-emerald-400" />
                        Copy to Clipboard Only
                      </ContextMenuItem>
                      {isImage && item.image_data_url && (
                        <ContextMenuItem onClick={(e) => handleSaveImage(item, e)}>
                          <Download className="mr-2 h-3.5 w-3.5 text-amber-400" />
                          Save Image to Downloads
                        </ContextMenuItem>
                      )}
                      <ContextMenuItem onClick={(e) => handleTogglePin(item.id, e)}>
                        <Pin className="mr-2 h-3.5 w-3.5 text-amber-400" />
                        {item.is_pinned ? "Unpin Item" : "Pin to Top"}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onClick={(e) => handleDelete(item.id, e)}
                        className="text-red-400 focus:text-red-300 focus:bg-red-900/30"
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Delete Item
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })}
            </div>
          )}
        </ScrollArea>

        {/* Centered Jump to Bottom Arrow */}
        {canScrollDown && (
          <button
            onClick={scrollToBottom}
            title="Scroll to Bottom (End / Ctrl+↓)"
            className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-[#06120b]/80 border border-emerald-600/30 text-emerald-400/70 shadow-md backdrop-blur-sm opacity-60 hover:opacity-100 hover:text-emerald-200 hover:bg-emerald-900/80 hover:border-emerald-500/60 transition-all cursor-pointer animate-in fade-in"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Subtle Bottom Gradient Shadow */}
        {canScrollDown && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-[#070f0a]/90 to-transparent z-10" />
        )}
      </div>

      {/* Footer Navigation Bar with Shortcut indicator */}
      <div className="flex items-center justify-between border-t border-emerald-900/60 bg-[#07130c]/90 px-3.5 py-1.5 text-[11px] text-emerald-400/80">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-[10.5px]">
            <CommandIcon className="h-3 w-3 text-emerald-500/70" />
            <span className="text-emerald-400/70">Navigate</span>
            <div className="flex items-center gap-0.5 font-mono text-[9.5px]">
              <kbd className="rounded bg-emerald-950/90 px-1 py-0.5 border border-emerald-800/60 text-emerald-300">↑</kbd>
              <kbd className="rounded bg-emerald-950/90 px-1 py-0.5 border border-emerald-800/60 text-emerald-300">↓</kbd>
            </div>
          </div>

          <div className="h-3 w-[1px] bg-emerald-800/60" />

          <div className="flex items-center gap-1.5 text-[10.5px]">
            <span className="text-emerald-400/70">Paste</span>
            <kbd className="rounded bg-emerald-950/90 px-1.5 py-0.5 border border-emerald-800/60 font-mono text-[9.5px] text-emerald-300">↵ Enter</kbd>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] text-emerald-400/60 font-medium">
            {filteredItems.length} {filteredItems.length === 1 ? "entry" : "entries"}
          </span>
        </div>
      </div>

      {/* Update Available Notification Banner */}
      {updateInfo && (
        <div className="flex items-center justify-between border-t border-emerald-700/60 bg-emerald-950/90 px-3 py-1.5 text-xs text-emerald-200 backdrop-blur-md animate-in slide-in-from-bottom-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-[#14ad72] shrink-0" />
            <span className="font-medium text-[11px]">
              Update v{updateInfo.version} available!
            </span>
          </div>
          <Button
            size="sm"
            onClick={handleDownloadAndInstallUpdate}
            disabled={isUpdating}
            className="h-6 px-2.5 text-[10px] bg-[#14ad72] hover:bg-emerald-400 text-slate-950 font-semibold shadow-sm"
          >
            {isUpdating ? updateStatusText : "Update & Restart"}
          </Button>
        </div>
      )}

      {/* Settings Modal (Clipboard Shortcuts & Color Picker Shortcut) */}
      {showSettings && (
        <div
          onClick={() => {
            setShowSettings(false)
            setRecordingTarget(null)
          }}
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3.5 animate-in fade-in-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col p-4 rounded-2xl bg-[#091811] border border-emerald-800/80 shadow-2xl max-w-[320px] w-full text-emerald-100 animate-in zoom-in-95"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-2.5 border-b border-emerald-900/60">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-[#14ad72] border border-emerald-500/20">
                  <Keyboard className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-emerald-100">Shortcut Settings</h4>
                  <p className="text-[10px] text-emerald-400/60">Configure global shortcuts</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowSettings(false)
                  setRecordingTarget(null)
                }}
                className="p-1 rounded-md text-emerald-400 hover:text-emerald-200 hover:bg-emerald-900/40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="py-2.5 space-y-3.5 max-h-[300px] overflow-y-auto pr-0.5">
              {/* Section 1: Clipboard Palette Shortcuts */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-medium text-emerald-400/70 uppercase tracking-wider block">
                  Toggle Clipboard Manager:
                </span>

                <div className="space-y-1">
                  {globalShortcuts.map((sc, i) => (
                    <div
                      key={sc + i}
                      className="flex items-center justify-between px-2 py-1 rounded-lg bg-[#06100a] border border-emerald-900/70"
                    >
                      <div className="flex items-center gap-1">
                        {sc.split("+").map((key, kIdx) => (
                          <kbd
                            key={kIdx}
                            className="rounded-md bg-emerald-950 px-1.5 py-0.5 border border-emerald-700/60 font-mono text-[10px] font-semibold text-[#14ad72]"
                          >
                            {formatKeyDisplayName(key)}
                          </kbd>
                        ))}
                      </div>

                      {globalShortcuts.length > 1 && (
                        <button
                          onClick={() => handleRemoveShortcut(sc)}
                          className="p-1 rounded text-emerald-500/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Remove this shortcut"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add new clipboard shortcut button */}
                <div
                  onClick={() => {
                    setRecordingTarget("clipboard")
                    setRecordedKeys([])
                    setShortcutError(null)
                    setShortcutSuccess(null)
                  }}
                  className={`relative flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all cursor-pointer ${
                    recordingTarget === "clipboard"
                      ? "border-[#14ad72] bg-emerald-950/90 ring-2 ring-[#14ad72]/40 animate-pulse"
                      : "border-dashed border-emerald-800/80 bg-[#06100a]/50 hover:border-[#14ad72]/60 hover:bg-[#0c1d14]"
                  }`}
                >
                  {recordingTarget === "clipboard" ? (
                    <div className="space-y-0.5">
                      <p className="text-[11px] font-semibold text-[#14ad72]">
                        {recordedKeys.length > 0
                          ? recordedKeys.map((k) => formatKeyDisplayName(k)).join(" + ")
                          : "Press keys to add (e.g. Win+V)..."}
                      </p>
                      <p className="text-[9px] text-emerald-400/60">Press Esc to cancel</p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-emerald-300 hover:text-[#14ad72]">
                      <Plus className="h-3 w-3 text-[#14ad72]" />
                      <span className="text-[10.5px] font-medium">Add Another Shortcut</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Section 2: Screen Color Picker Shortcut */}
              <div className="space-y-1.5 pt-2 border-t border-emerald-900/60">
                <span className="text-[10px] font-medium text-emerald-400/70 uppercase tracking-wider block">
                  Screen Color Picker:
                </span>

                <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-[#06100a] border border-emerald-900/70">
                  <div className="flex items-center gap-1.5">
                    <Pipette className="h-3.5 w-3.5 text-[#14ad72]" />
                    <div className="flex items-center gap-1">
                      {colorPickerShortcut.split("+").map((key, kIdx) => (
                        <kbd
                          key={kIdx}
                          className="rounded-md bg-emerald-950 px-1.5 py-0.5 border border-emerald-700/60 font-mono text-[10px] font-semibold text-[#14ad72]"
                        >
                          {formatKeyDisplayName(key)}
                        </kbd>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setRecordingTarget("picker")
                      setRecordedKeys([])
                      setShortcutError(null)
                      setShortcutSuccess(null)
                    }}
                    className="text-[10px] text-emerald-400 hover:text-[#14ad72] underline underline-offset-2"
                  >
                    Change
                  </button>
                </div>

                {recordingTarget === "picker" && (
                  <div className="relative flex flex-col items-center justify-center p-2 rounded-lg border border-[#14ad72] bg-emerald-950/90 ring-2 ring-[#14ad72]/40 animate-pulse text-center">
                    <p className="text-[11px] font-semibold text-[#14ad72]">
                      {recordedKeys.length > 0
                        ? recordedKeys.map((k) => formatKeyDisplayName(k)).join(" + ")
                        : "Press new Color Picker keys (e.g. Alt+C)..."}
                    </p>
                    <p className="text-[9px] text-emerald-400/60">Press Esc to cancel</p>
                  </div>
                )}
              </div>

              {/* Status feedback message */}
              {shortcutSuccess && (
                <div className="flex items-center gap-1.5 mt-2 p-1.5 rounded-lg bg-emerald-950/90 border border-[#14ad72]/60 text-[10px] text-emerald-200">
                  <Check className="h-3 w-3 text-[#14ad72] shrink-0" />
                  <span>{shortcutSuccess}</span>
                </div>
              )}

              {shortcutError && (
                <div className="flex items-center gap-1.5 mt-2 p-1.5 rounded-lg bg-red-950/80 border border-red-500/40 text-[10px] text-red-200">
                  <AlertCircle className="h-3 w-3 text-red-400 shrink-0" />
                  <span>{shortcutError}</span>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-emerald-900/60 mt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  handleResetShortcuts()
                  handleSaveColorPickerShortcut("Alt+C")
                }}
                className="h-7 px-2 text-[10px] text-emerald-400/60 hover:text-emerald-200"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset Defaults
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setShowSettings(false)
                  setRecordingTarget(null)
                }}
                className="h-7 px-3 text-[11px] bg-[#14ad72] hover:bg-emerald-400 text-slate-950 font-semibold"
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Clear History Confirmation Modal */}
      {showClearConfirm && (
        <div
          onClick={() => setShowClearConfirm(false)}
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col items-center text-center p-4 rounded-xl bg-[#0a1811] border border-emerald-900 shadow-2xl max-w-[270px] w-full"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/10 text-red-400 mb-2 border border-red-500/20">
              <Trash2 className="h-4 w-4" />
            </div>
            <h4 className="text-xs font-semibold text-emerald-100">Clear Clipboard History?</h4>
            <p className="text-[11px] text-emerald-400/60 mt-1 mb-3.5 leading-relaxed">
              This will remove unpinned items. Pinned items will remain safe.
            </p>
            <div className="flex items-center gap-2 w-full">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 h-7 text-xs border-emerald-800/80 hover:bg-emerald-900/40 text-emerald-300"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  handleClearUnpinned()
                  setShowClearConfirm(false)
                }}
                className="flex-1 h-7 text-xs bg-red-600 hover:bg-red-700 text-white font-medium"
              >
                Clear All
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Image Preview Lightbox Modal */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in-50 cursor-pointer"
        >
          <div className="relative max-h-full max-w-full">
            <img
              src={previewImage}
              alt="Fullscreen Preview"
              className="max-h-[440px] max-w-[420px] object-contain rounded-xl border border-emerald-800 shadow-2xl"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-2 right-2 p-1 rounded-full bg-[#0a1811]/90 hover:bg-[#0f241a] text-emerald-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
