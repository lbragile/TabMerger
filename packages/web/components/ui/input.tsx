import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/**
 * The `dir` an input gets unless the caller passes one. What people type keeps its own direction
 * rather than the page's: free text is `auto` (an English name typed on an Arabic page runs left
 * to right, and the other way round), and email addresses, URLs and phone numbers are always
 * `ltr`. Other types (password, checkbox, number, …) follow the page. See docs/I18N.md.
 */
export function inputDirection(type: string | undefined): 'auto' | 'ltr' | undefined {
  if (type === undefined || type === 'text' || type === 'search') return 'auto'
  if (type === 'email' || type === 'url' || type === 'tel') return 'ltr'
  return undefined
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, dir, ...props }, ref) => {
    return (
      <input
        type={type}
        dir={dir ?? inputDirection(type)}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
