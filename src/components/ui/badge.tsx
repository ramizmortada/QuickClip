import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-slate-800 text-slate-100 hover:bg-slate-700",
        secondary:
          "border-transparent bg-slate-800/60 text-slate-300 hover:bg-slate-800",
        destructive:
          "border-transparent bg-red-900/50 text-red-300 hover:bg-red-900/70",
        outline: "text-slate-300 border-slate-700/60",
        accent: "border-sky-500/30 bg-sky-500/10 text-sky-400 font-mono text-[10px]",
        success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-mono text-[10px]",
        warning: "border-amber-500/30 bg-amber-500/10 text-amber-400 font-mono text-[10px]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
