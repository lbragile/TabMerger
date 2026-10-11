import { Avatar, AvatarFallback } from '@/components/ui/avatar'

/**
 * The account menu's trigger button, as one class string for the marketing navbar and the
 * dashboard header. The two menus are different components (the navbar's is lazy-loaded for
 * signed-in visitors), so the look is what they share, in one place: a slightly rounded square,
 * not a circle.
 */
export const ACCOUNT_AVATAR_BUTTON_CLASS = 'relative h-8 w-8 rounded-md'

/** The initials inside the trigger button. */
export function AccountAvatar({ initials }: { initials?: string }) {
  return (
    <Avatar className="h-8 w-8 rounded-md">
      <AvatarFallback className="text-xs rounded-md">{initials}</AvatarFallback>
    </Avatar>
  )
}
