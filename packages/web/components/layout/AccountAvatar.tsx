import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { NO_CAPTURE_CLASS } from '@/lib/analyticsPrivacy'

/**
 * The account menu's trigger button, as one class string for the marketing navbar and the
 * dashboard header. The two menus are different components (the navbar's is lazy-loaded for
 * signed-in visitors), so the look is what they share, in one place: a slightly rounded square,
 * not a circle, 36px (h-9) like the theme toggle, the GitHub badge and the size="sm" buttons beside it.
 */
export const ACCOUNT_AVATAR_BUTTON_CLASS = 'relative h-9 w-9 rounded-md'

/** The initials inside the trigger button (from the email, so kept out of analytics). */
export function AccountAvatar({ initials }: { initials?: string }) {
  return (
    <Avatar className={`h-9 w-9 rounded-md ${NO_CAPTURE_CLASS}`}>
      <AvatarFallback className="text-xs rounded-md">{initials}</AvatarFallback>
    </Avatar>
  )
}
