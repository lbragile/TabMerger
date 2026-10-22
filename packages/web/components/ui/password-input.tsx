'use client'

import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Input, type InputProps } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useDirection } from '@/components/DirectionProvider'

interface PasswordInputProps extends InputProps {
  /** Controlled visibility — pass alongside `showToggle={false}` on a sibling field to mirror
   * this field's toggle (e.g. a "Confirm password" field that reveals when "Password" does),
   * instead of each field showing its own independent eye icon. Uncontrolled by default. */
  visible?: boolean
  /** Notified when the (controlled) visibility toggles — required alongside `visible` so the
   * parent can drive a sibling field's `visible` prop too. Ignored when `visible` isn't passed. */
  onVisibleChange?: (visible: boolean) => void
  /** Hides this field's own toggle button — use when visibility is driven by another field. */
  showToggle?: boolean
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, visible: visibleProp, onVisibleChange, showToggle = true, dir, ...props }, ref) => {
    const [visibleState, setVisibleState] = React.useState(false)
    // The page's direction, shown or hidden: the reveal button sits at the page's end side, so
    // the room kept for it (`pe-9`) must be on that side too. Revealed it is a text input, which
    // would otherwise get `dir="auto"` and could move the padding to the other side.
    const pageDir = useDirection()
    const t = useTranslations('common')
    const visible = visibleProp ?? visibleState
    const toggle = () => {
      if (visibleProp === undefined) setVisibleState((v) => !v)
      else onVisibleChange?.(!visible)
    }
    return (
      <div className="relative w-full">
        <Input
          type={visible ? 'text' : 'password'}
          dir={dir ?? pageDir}
          className={cn(showToggle ? 'pe-9' : '', className)}
          ref={ref}
          {...props}
        />
        {showToggle && (
          <button
            type="button"
            onClick={toggle}
            aria-label={visible ? t('hidePassphrase') : t('showPassphrase')}
            className="absolute inset-e-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    )
  }
)
PasswordInput.displayName = 'PasswordInput'

export { PasswordInput }
