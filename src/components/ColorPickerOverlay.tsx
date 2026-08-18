import { useEffect, useRef, useState, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

export interface PixelSample {
  hex: string
  r: number
  g: number
  b: number
  cursor_x: number
  cursor_y: number
  grid: string[][]
}

const LOUPE_SIZE = 110
const LOUPE_RADIUS = LOUPE_SIZE / 2
const GRID_CELLS = 11
const HALF_GRID = Math.floor(GRID_CELLS / 2)
const CELL_SIZE = LOUPE_SIZE / GRID_CELLS

export default function ColorPickerOverlay() {
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 200, y: 200 })
  const [currentHex, setCurrentHex] = useState<string>("#000000")
  const [gridColors, setGridColors] = useState<string[][]>([])
  const [isVisible, setIsVisible] = useState<boolean>(false)

  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const isSamplingRef = useRef<boolean>(false)
  const currentHexRef = useRef<string>("#000000")

  // Sample pixel directly from Windows desktop
  const samplePixel = useCallback(async (clientX?: number, clientY?: number) => {
    if (isSamplingRef.current) return
    isSamplingRef.current = true

    try {
      const sample = await invoke<PixelSample>("sample_pixel_at_cursor")
      if (sample) {
        setCurrentHex(sample.hex)
        currentHexRef.current = sample.hex
        setGridColors(sample.grid)

        const x = clientX !== undefined ? clientX : sample.cursor_x
        const y = clientY !== undefined ? clientY : sample.cursor_y
        setMousePos({ x, y })

        // Draw loupe on canvas
        drawLoupe(sample.grid, sample.hex)
      }
    } catch (err) {
      console.error("Pixel sample error:", err)
    } finally {
      isSamplingRef.current = false
    }
  }, [])

  // Draw the circular loupe with 11x11 pixel grid
  const drawLoupe = (grid: string[][], activeHex: string) => {
    const canvas = loupeCanvasRef.current
    if (!canvas || !grid || grid.length === 0) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE)

    // Clip to circle
    ctx.save()
    ctx.beginPath()
    ctx.arc(LOUPE_RADIUS, LOUPE_RADIUS, LOUPE_RADIUS - 1, 0, Math.PI * 2)
    ctx.clip()

    // Draw 11x11 grid of pixels
    const rows = grid.length
    for (let y = 0; y < rows; y++) {
      const cols = grid[y].length
      for (let x = 0; x < cols; x++) {
        const color = grid[y][x] || "#000000"
        const drawX = x * CELL_SIZE
        const drawY = y * CELL_SIZE

        ctx.fillStyle = color
        ctx.fillRect(drawX, drawY, CELL_SIZE, CELL_SIZE)

        // Subtle grid outline
        ctx.strokeStyle = "rgba(255, 255, 255, 0.12)"
        ctx.lineWidth = 0.5
        ctx.strokeRect(drawX, drawY, CELL_SIZE, CELL_SIZE)
      }
    }

    // Center targeting pixel highlight
    const targetX = HALF_GRID * CELL_SIZE
    const targetY = HALF_GRID * CELL_SIZE

    ctx.strokeStyle = "#FFFFFF"
    ctx.lineWidth = 1.5
    ctx.strokeRect(targetX + 0.5, targetY + 0.5, CELL_SIZE - 1, CELL_SIZE - 1)

    ctx.strokeStyle = "#000000"
    ctx.lineWidth = 0.75
    ctx.strokeRect(targetX + 1.5, targetY + 1.5, CELL_SIZE - 3, CELL_SIZE - 3)

    ctx.restore()

    // 1. Inner dark outline for contrast against pixel grid
    ctx.beginPath()
    ctx.arc(LOUPE_RADIUS, LOUPE_RADIUS, LOUPE_RADIUS - 4.5, 0, Math.PI * 2)
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)"
    ctx.lineWidth = 1
    ctx.stroke()

    // 2. Main Active Color Ring (4px thick, colored with hovered color)
    ctx.beginPath()
    ctx.arc(LOUPE_RADIUS, LOUPE_RADIUS, LOUPE_RADIUS - 2.5, 0, Math.PI * 2)
    ctx.strokeStyle = activeHex || "#FFFFFF"
    ctx.lineWidth = 4
    ctx.stroke()

    // 3. Outer crisp border for contrast on light/dark backgrounds
    ctx.beginPath()
    ctx.arc(LOUPE_RADIUS, LOUPE_RADIUS, LOUPE_RADIUS - 0.5, 0, Math.PI * 2)
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)"
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // Redraw when gridColors or currentHex update
  useEffect(() => {
    if (gridColors.length > 0) {
      drawLoupe(gridColors, currentHex)
    }
  }, [gridColors, currentHex])

  // Listen for open event with exact cursor position & periodic refresh
  useEffect(() => {
    let unlisten: (() => void) | undefined

    listen<{ cursor_x: number; cursor_y: number }>("color-picker-opened", (event) => {
      const { cursor_x, cursor_y } = event.payload
      setMousePos({ x: cursor_x, y: cursor_y })
      samplePixel(cursor_x, cursor_y).then(() => {
        setIsVisible(true)
      })
    }).then((fn) => {
      unlisten = fn
    })

    // Initial load
    samplePixel().then(() => setIsVisible(true))

    const interval = setInterval(() => {
      samplePixel()
    }, 35) // ~30fps polling for smooth tracking

    return () => {
      if (unlisten) unlisten()
      clearInterval(interval)
    }
  }, [samplePixel])

  // Mouse move handler
  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY })
    samplePixel(e.clientX, e.clientY)
    if (!isVisible) setIsVisible(true)
  }

  // Click -> copy hex and finish
  const handleTriggerFinish = (e?: React.MouseEvent) => {
    if (e) {
      if (e.button !== 0) return // Only on left-click
      e.preventDefault()
      e.stopPropagation()
    }
    setIsVisible(false)
    invoke("finish_color_picker", { hex: currentHexRef.current || null }).catch((err) => {
      console.error("Failed to finish color picker:", err)
    })
  }

  // Right click -> cancel
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsVisible(false)
    invoke("cancel_color_picker").catch(() => {})
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setIsVisible(false)
        invoke("cancel_color_picker").catch(() => {})
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        handleTriggerFinish()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Position pill directly 8px ABOVE or BELOW the 110px circle (top: 0 to 110)
  const isNearBottom = mousePos.y + 100 > window.innerHeight
  const pillOffsetY = isNearBottom ? -38 : 118

  // Horizontal clamping to keep pill inside screen boundaries when cursor is at extreme edges
  const pillHalfWidth = 48
  let pillOffsetX = 0
  if (mousePos.x - pillHalfWidth < 10) {
    pillOffsetX = 10 - (mousePos.x - pillHalfWidth)
  } else if (mousePos.x + pillHalfWidth > window.innerWidth - 10) {
    pillOffsetX = window.innerWidth - 10 - (mousePos.x + pillHalfWidth)
  }

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseDown={handleTriggerFinish}
      onClick={handleTriggerFinish}
      onContextMenu={handleContextMenu}
      className="fixed inset-0 h-screen w-screen cursor-crosshair overflow-hidden select-none"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.01)", // Transparent hit-test overlay
      }}
    >
      {/* Floating Loupe & Info Badge Container */}
      <div
        className={`pointer-events-none fixed transition-opacity duration-75 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        style={{
          left: mousePos.x,
          top: mousePos.y,
          transform: "translate(-50%, -50%)",
        }}
      >
        {/* Magnifying Circular Loupe (110px lens) */}
        <div className="relative flex items-center justify-center filter drop-shadow-2xl">
          <canvas
            ref={loupeCanvasRef}
            width={LOUPE_SIZE}
            height={LOUPE_SIZE}
            className="rounded-full"
          />
        </div>

        {/* Floating Minimal Info Pill (Hex + Swatch Only) */}
        <div
          className="absolute flex items-center gap-1.5 rounded-lg border border-emerald-700/80 bg-[#070f0a]/95 px-2.5 py-1 text-emerald-100 shadow-2xl backdrop-blur-md pointer-events-none whitespace-nowrap"
          style={{
            left: `calc(50% + ${pillOffsetX}px)`,
            top: pillOffsetY,
            transform: "translateX(-50%)",
          }}
        >
          {/* Color Swatch */}
          <span
            className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/60 shadow-sm"
            style={{ backgroundColor: currentHex }}
          />
          {/* HEX Code */}
          <span className="font-mono text-xs font-bold text-white tracking-wide">
            {currentHex}
          </span>
        </div>
      </div>
    </div>
  )
}
