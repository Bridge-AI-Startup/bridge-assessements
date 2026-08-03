import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

/*
 * Bridge buttons are full pills, matching the landing page's CTAs.
 *
 * The CTA-shaped variants (default / destructive / outline / secondary) carry
 * the landing's Geist Mono uppercase label. `ghost` and `link` deliberately
 * keep Inter sentence case: they back inline table actions, dropdown triggers
 * and icon buttons, where uppercase mono would wreck density and readability.
 *
 * Weight lives on the variants, not the base: the landing sets its mono labels
 * at 400, and Tailwind emits `font-medium` after `font-normal`, so a base
 * `font-medium` would always win over a variant-level override.
 */
const ctaLabel = "font-mono font-normal uppercase tracking-[0.03em]";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: `bg-primary text-primary-foreground hover:bg-ink-soft ${ctaLabel}`,
        destructive: `bg-destructive text-destructive-foreground hover:bg-destructive/90 ${ctaLabel}`,
        outline: `border border-input bg-transparent hover:bg-accent hover:text-accent-foreground ${ctaLabel}`,
        secondary: `bg-secondary text-secondary-foreground hover:bg-secondary/70 ${ctaLabel}`,
        ghost: "font-medium hover:bg-accent hover:text-accent-foreground",
        link: "font-medium text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2 text-[13px]",
        sm: "h-8 px-4 text-[12px]",
        lg: "h-11 px-7 text-[13px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    (<Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props} />)
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
