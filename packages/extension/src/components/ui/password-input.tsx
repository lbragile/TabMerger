import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface PasswordInputProps extends InputProps {
  /** Controlled visibility — pass alongside `showToggle={false}` on a sibling field to mirror
   * this field's toggle (e.g. a "Confirm passphrase" field that reveals when "Passphrase" does),
   * instead of each field showing its own independent eye icon. Uncontrolled by default. */
  visible?: boolean;
  /** Notified when the (controlled) visibility toggles — required alongside `visible` so the
   * parent can drive a sibling field's `visible` prop too. Ignored when `visible` isn't passed. */
  onVisibleChange?: (visible: boolean) => void;
  /** Hides this field's own toggle button — use when visibility is driven by another field. */
  showToggle?: boolean;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, visible: visibleProp, onVisibleChange, showToggle = true, ...props }, ref) => {
    const [visibleState, setVisibleState] = React.useState(false);
    const visible = visibleProp ?? visibleState;
    const toggle = () => {
      if (visibleProp === undefined) setVisibleState((v) => !v);
      else onVisibleChange?.(!visible);
    };
    return (
      <div className="relative w-full">
        <Input
          type={visible ? 'text' : 'password'}
          className={cn(showToggle ? 'pr-8' : '', className)}
          ref={ref}
          {...props}
        />
        {showToggle && (
          <button
            type="button"
            onClick={toggle}
            aria-label={visible ? 'Hide passphrase' : 'Show passphrase'}
            className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    );
  }
);
PasswordInput.displayName = 'PasswordInput';

export { PasswordInput };
