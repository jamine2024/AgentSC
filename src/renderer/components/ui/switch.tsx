import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SwitchProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked, onCheckedChange, ...props }, ref) => {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={cn(
          'peer inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full border-2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40',
          checked
            ? 'border-primary/30 bg-gradient-to-r from-primary to-info shadow-[0_0_8px_-2px_hsl(var(--primary)/0.35)]'
            : 'border-border bg-muted',
          className,
        )}
        onClick={() => onCheckedChange?.(!checked)}
        ref={ref}
        {...props}
      >
        <span
          className={cn(
            'pointer-events-none block h-[14px] w-[14px] rounded-full shadow-sm ring-0 transition-transform duration-200',
            checked ? 'translate-x-[18px] bg-white' : 'translate-x-[3px] bg-muted-foreground/70'
          )}
        />
      </button>
    )
  }
)
Switch.displayName = 'Switch'

export { Switch }
