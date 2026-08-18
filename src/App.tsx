import { useState, useEffect, useMemo, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
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

export default function App() {
  const [items, setItems] = useState<ClipboardItem[]>([])
  const [primaryTab, setPrimaryTab] = useState<"recent" | "pinned">("recent")
  const [typeFilter, setTypeFilter] = useState<"all" | "text" | "image">("all")
  const [search, setSearch] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 1. Fetch initial clipboard history and listen for live updates
  useEffect(() => {
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

    // Listen for live updates emitted by Rust background thread
    let unlistenFn: (() => void) | undefined
    listen<ClipboardItem[]>("clipboard-updated", (event) => {
      setItems(event.payload)
    }).then((fn) => {
      unlistenFn = fn
    }).catch((err) => {
      console.warn("Event listener not registered in browser preview:", err)
    })

    // Auto-focus search when window gets focus
    const handleFocus = () => {
      searchInputRef.current?.focus()
    }
    window.addEventListener("focus", handleFocus)

    return () => {
      if (unlistenFn) unlistenFn()
      window.removeEventListener("focus", handleFocus)
    }
  }, [])

  // Filter items based on Primary Tab (Recent vs Pinned), Type Filter, and Search
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 1. Primary tab filter
      if (primaryTab === "pinned" && !item.is_pinned) {
        return false
      }

      // 2. Content type filter
      if (typeFilter === "text" && item.content_type === "image") {
        return false
      }
      if (typeFilter === "image" && item.content_type !== "image") {
        return false
      }

      // 3. Search query filter
      if (!search.trim()) return true
      const q = search.toLowerCase()

      if (item.content_type === "image") {
        return (
          item.copied_at.toLowerCase().includes(q) ||
          (item.image_width && `${item.image_width}x${item.image_height}`.includes(q)) ||
          "image screenshot graphic".includes(q)
        )
      }

      if (item.text_content) {
        return (
          item.text_content.toLowerCase().includes(q) ||
          (item.language && item.language.toLowerCase().includes(q)) ||
          item.copied_at.toLowerCase().includes(q)
        )
      }

      return false
    })
  }, [items, primaryTab, typeFilter, search])

  // Reset selected index if list length changes
  useEffect(() => {
    if (selectedIndex >= filteredItems.length && filteredItems.length > 0) {
      setSelectedIndex(0)
    }
  }, [filteredItems.length, selectedIndex])

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
      if (e.key === "Escape") {
        if (previewImage) {
          setPreviewImage(null)
        } else {
          handleClose()
        }
        return
      }

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1 < filteredItems.length ? prev + 1 : 0))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filteredItems.length - 1))
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
  }, [filteredItems, selectedIndex, previewImage])

  const pinnedCount = useMemo(() => items.filter((i) => i.is_pinned).length, [items])
  const textCount = useMemo(() => items.filter((i) => i.content_type !== "image").length, [items])
  const imageCount = useMemo(() => items.filter((i) => i.content_type === "image").length, [items])

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-950/95 text-slate-100 shadow-2xl backdrop-blur-3xl select-none">
      {/* Row 1: Search Input + Clear History & Close Actions */}
      <div className="relative flex items-center justify-between border-b border-slate-800/80 px-3 py-2 bg-slate-900/40">
        <div className="flex flex-1 items-center mr-2">
          <Search className="h-3.5 w-3.5 text-slate-400 shrink-0 mr-2" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clipboard history..."
            className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
            autoFocus
          />
          {search && (
            <button
              onClick={() => {
                setSearch("")
                searchInputRef.current?.focus()
              }}
              className="text-slate-500 hover:text-slate-300 mr-1 text-xs"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 border-l border-slate-800/80 pl-2">
          <Button
            variant="ghost"
            size="iconSm"
            onClick={handleClearUnpinned}
            title="Clear unpinned history"
            className="text-slate-400 hover:text-red-400 hover:bg-red-500/10 h-6 w-6"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            onClick={handleClose}
            title="Close (Esc)"
            className="text-slate-400 hover:text-slate-200 h-6 w-6"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Row 2: Dual Segmented Tabs Side-by-Side */}
      <div className="flex items-center justify-between border-b border-slate-800/80 px-2.5 py-1.5 bg-slate-950/60 gap-2">
        {/* Left: Recent vs Pinned Tabs */}
        <div className="inline-flex h-6.5 items-center rounded-lg bg-slate-900/90 p-0.5 border border-slate-800/80">
          <button
            onClick={() => setPrimaryTab("recent")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${
              primaryTab === "recent"
                ? "bg-slate-800 text-sky-400 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
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
                ? "bg-slate-800 text-amber-400 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Pin className="h-3 w-3" />
            <span>Pinned</span>
            <span className="text-[9px] opacity-60">({pinnedCount})</span>
          </button>
        </div>

        {/* Right: All / Text / Images Filters */}
        <div className="inline-flex h-6.5 items-center rounded-lg bg-slate-900/90 p-0.5 border border-slate-800/80">
          <button
            onClick={() => setTypeFilter("all")}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all ${
              typeFilter === "all"
                ? "bg-slate-800 text-slate-100 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="All items"
          >
            <Layers className="h-3 w-3" />
            <span>All</span>
          </button>
          <button
            onClick={() => setTypeFilter("text")}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all ${
              typeFilter === "text"
                ? "bg-slate-800 text-sky-400 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Text & Code"
          >
            <FileText className="h-3 w-3" />
            <span>Text</span>
            <span className="text-[9px] opacity-60">({textCount})</span>
          </button>
          <button
            onClick={() => setTypeFilter("image")}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all ${
              typeFilter === "image"
                ? "bg-slate-800 text-amber-400 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Images & Screenshots"
          >
            <ImageIcon className="h-3 w-3" />
            <span>Images</span>
            <span className="text-[9px] opacity-60">({imageCount})</span>
          </button>
        </div>
      </div>

      {/* Clipboard Items Scroll Area */}
      <ScrollArea className="flex-1 px-3 py-1.5">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500">
            <Sparkles className="h-8 w-8 mb-2 stroke-1 text-slate-600" />
            <p className="text-xs font-medium text-slate-300">
              {primaryTab === "pinned"
                ? "No pinned items yet"
                : "Clipboard history is empty"}
            </p>
            <p className="text-[11px] text-slate-500 mt-1 max-w-[220px]">
              {primaryTab === "pinned"
                ? "Pin any copied text or screenshot to access it quickly anytime."
                : search
                ? "No items match your search filter."
                : "Copy text or take a screenshot to see it appear live."}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5 pb-2">
            {filteredItems.map((item, idx) => {
              const isSelected = selectedIndex === idx
              const isCopied = copiedId === item.id
              const isImage = item.content_type === "image"

              return (
                <ContextMenu key={item.id}>
                  <ContextMenuTrigger>
                    <div
                      onClick={() => {
                        setSelectedIndex(idx)
                        handlePaste(item)
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`group relative flex flex-col gap-1.5 rounded-xl border p-2.5 transition-all cursor-pointer ${
                        isSelected
                          ? "border-sky-500/50 bg-slate-900/90 shadow-md ring-1 ring-sky-500/20"
                          : "border-slate-800/60 bg-slate-900/30 hover:border-slate-700/60 hover:bg-slate-900/60"
                      }`}
                    >
                      {/* Top metadata row */}
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
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
                          ) : item.content_type === "code" ? (
                            <>
                              <Code2 className="h-3.5 w-3.5 text-sky-400" />
                              <span className="capitalize font-medium text-sky-300">Code</span>
                              {item.language && (
                                <Badge variant="accent" className="h-3.5 px-1 uppercase">
                                  {item.language}
                                </Badge>
                              )}
                            </>
                          ) : item.content_type === "link" ? (
                            <>
                              <Link2 className="h-3.5 w-3.5 text-emerald-400" />
                              <span className="capitalize font-medium text-emerald-300">
                                Link
                              </span>
                            </>
                          ) : (
                            <>
                              <FileText className="h-3.5 w-3.5 text-slate-400" />
                              <span className="capitalize font-medium text-slate-300">
                                Text
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-slate-500">
                          {item.char_count && (
                            <span className="text-[10px]">{item.char_count} chars</span>
                          )}
                          <span className="text-[10px]">{item.copied_at}</span>
                          {item.is_pinned && (
                            <Pin className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                          )}
                        </div>
                      </div>

                      {/* Content Preview */}
                      {isImage && item.image_data_url ? (
                        <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-950/60 max-h-24 flex items-center justify-center group/img">
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
                            className="absolute top-1.5 right-1.5 p-1 rounded-md bg-slate-900/80 hover:bg-slate-800 text-slate-300 opacity-0 group-hover/img:opacity-100 transition-opacity"
                            title="Expand preview"
                          >
                            <Maximize2 className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-200 font-normal line-clamp-2 break-all whitespace-pre-wrap font-sans select-text">
                          {item.text_content}
                        </div>
                      )}

                      {/* Quick action bar on hover */}
                      <div className="flex items-center justify-between pt-0.5">
                        <div className="flex items-center gap-1 text-[10px] text-slate-500">
                          <kbd className="rounded bg-slate-950 px-1 py-0.2 border border-slate-800 text-slate-400 font-mono">
                            ↵ Enter
                          </kbd>
                          <span>to paste</span>
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => handleTogglePin(item.id, e)}
                            className={`p-1 rounded hover:bg-slate-800 ${
                              item.is_pinned ? "text-amber-400" : "text-slate-400"
                            }`}
                            title={item.is_pinned ? "Unpin (Ctrl+P)" : "Pin (Ctrl+P)"}
                          >
                            <Pin className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => handleDelete(item.id, e)}
                            className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                            title="Delete (Del)"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      {/* Copied feedback overlay */}
                      {isCopied && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-sky-950/85 border border-sky-500/60 backdrop-blur-sm animate-in fade-in-50">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-200">
                            <Check className="h-4 w-4 text-sky-400" />
                            Copied to Clipboard!
                          </div>
                        </div>
                      )}
                    </div>
                  </ContextMenuTrigger>

                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => handlePaste(item)}>
                      <Check className="mr-2 h-3.5 w-3.5 text-sky-400" />
                      Paste into Input Field
                    </ContextMenuItem>
                    <ContextMenuItem onClick={(e) => handleCopyOnly(item, e)}>
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      Copy to Clipboard Only
                    </ContextMenuItem>
                    <ContextMenuItem onClick={(e) => handleTogglePin(item.id, e)}>
                      <Pin className="mr-2 h-3.5 w-3.5" />
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

      {/* Footer Navigation Bar */}
      <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-900/50 px-3.5 py-1.5 text-[11px] text-slate-400">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <CommandIcon className="h-3 w-3 text-slate-500" />
            <span>Navigate</span>
          </span>
          <div className="flex items-center gap-1 font-mono text-[10px]">
            <kbd className="rounded bg-slate-950 px-1 border border-slate-800 text-slate-400">↑</kbd>
            <kbd className="rounded bg-slate-950 px-1 border border-slate-800 text-slate-400">↓</kbd>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-500">
            {filteredItems.length} {filteredItems.length === 1 ? "entry" : "entries"}
          </span>
        </div>
      </div>

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
              className="max-h-[440px] max-w-[420px] object-contain rounded-xl border border-slate-700 shadow-2xl"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-2 right-2 p-1 rounded-full bg-slate-900/80 hover:bg-slate-800 text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
