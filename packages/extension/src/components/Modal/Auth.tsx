import { useState } from 'react';
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AuthModalProps {
  onClose: () => void;
}

function PasswordStrength({ password }: { password: string }) {
  const rules = [
    { label: 'At least 8 characters', ok: password.length >= 8 },
    { label: 'One uppercase letter', ok: /[A-Z]/.test(password) },
    { label: 'One number', ok: /[0-9]/.test(password) },
  ];
  if (!password) return null;
  return (
    <ul className="mt-1.5 space-y-0.5">
      {rules.map((r) => (
        <li key={r.label} className={cn('flex items-center gap-1.5 text-[11px]', r.ok ? 'text-green-500' : 'text-muted-foreground')}>
          <Check className={cn('h-3 w-3 shrink-0', r.ok ? 'opacity-100' : 'opacity-0')} />
          {r.label}
        </li>
      ))}
    </ul>
  );
}

export function AuthModal({ onClose }: AuthModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [signedUp, setSignedUp] = useState(false);
  const [magicLinkEmail, setMagicLinkEmail] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const { signIn, signUp, resetPassword, signInWithMagicLink, signInWithGoogle, updatePassword, signOut, user } = useAuth();

  const hasPasswordIdentity = user?.identities?.some((i) => i.provider === 'email') ?? false

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordSaving(true);
    try {
      await updatePassword(newPassword);
      setNewPassword('');
      toast.success(hasPasswordIdentity ? 'Password updated' : 'Password set — you can now sign in with email + password too');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPasswordSaving(false);
    }
  };

  const passwordValid = password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email, password);
      toast.success('Signed in');
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordValid) return;
    setLoading(true);
    try {
      await signUp(email, password);
      setSignedUp(true);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await resetPassword(forgotEmail);
      toast.success('Check your email for a reset link');
      setForgotPassword(false);
      setForgotEmail('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signInWithMagicLink(magicLinkEmail);
      setMagicLinkSent(true);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      toast.success('Signed in');
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    toast.success('Signed out');
    onClose();
  };

  if (user) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            You are signed in as <strong>{user.email}</strong>.
          </p>

          <form onSubmit={handleSetPassword} className="space-y-1">
            <Label htmlFor="account-password" className="text-xs">
              {hasPasswordIdentity ? 'Change password' : 'Set a password'}
            </Label>
            {!hasPasswordIdentity && (
              <p className="text-[11px] text-muted-foreground">
                This account was created via Google/magic link and has no password yet.
              </p>
            )}
            <div className="flex items-center gap-2">
              <PasswordInput
                id="account-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" size="sm" disabled={passwordSaving || newPassword.length < 8} loading={passwordSaving}>
                Save
              </Button>
            </div>
            <PasswordStrength password={newPassword} />
          </form>

          <Button variant="outline" onClick={handleSignOut} className="w-full">
            Sign out
          </Button>
        </div>
      </>
    );
  }

  if (forgotPassword) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>Enter your email to receive a reset link.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleResetPassword} className="mt-4 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="reset-email">Email</Label>
            <Input
              id="reset-email"
              type="email"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading} loading={loading}>
            Send reset email
          </Button>
          <Button type="button" variant="ghost" className="w-full text-xs" onClick={() => setForgotPassword(false)}>
            Back to sign in
          </Button>
        </form>
      </>
    );
  }

  if (magicLinkSent) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Check your email</DialogTitle>
          <DialogDescription>
            We sent a magic link to <strong>{magicLinkEmail}</strong>. Click it to finish signing in, then
            reopen this popup.
          </DialogDescription>
        </DialogHeader>
        <Button className="mt-4 w-full" variant="outline" onClick={() => setMagicLinkSent(false)}>
          Back to sign in
        </Button>
      </>
    );
  }

  if (signedUp) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Check your email</DialogTitle>
          <DialogDescription>Account created! Check your email to confirm, then sign in.</DialogDescription>
        </DialogHeader>
        <Button className="mt-4 w-full" variant="outline" onClick={() => setSignedUp(false)}>
          Back to sign in
        </Button>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Sign In to TabMerger</DialogTitle>
        <DialogDescription>Sync your groups across devices with a free account.</DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-3">
        <Button
          variant="outline"
          className="w-full"
          onClick={handleGoogle}
          disabled={googleLoading}
          loading={googleLoading}
          type="button"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 mr-2" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </Button>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[11px] text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <Tabs defaultValue="signin">
          <TabsList className="w-full">
            <TabsTrigger value="signin" className="flex-1 text-xs">
              Sign In
            </TabsTrigger>
            <TabsTrigger value="signup" className="flex-1 text-xs">
              Sign Up
            </TabsTrigger>
            <TabsTrigger value="magiclink" className="flex-1 text-xs">
              Magic Link
            </TabsTrigger>
          </TabsList>

          <TabsContent value="signin">
            <form onSubmit={handleSignIn} className="space-y-3 mt-3">
              <div className="space-y-1">
                <Label htmlFor="signin-email">Email</Label>
                <Input
                  id="signin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="signin-password">Password</Label>
                <PasswordInput
                  id="signin-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  onClick={() => { setForgotPassword(true); setForgotEmail(email); }}
                >
                  Forgot password?
                </button>
              </div>
              <Button type="submit" className="w-full" disabled={loading} loading={loading}>
                Sign In
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignUp} className="space-y-3 mt-3">
              <div className="space-y-1">
                <Label htmlFor="signup-email">Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="signup-password">Password</Label>
                <PasswordInput
                  id="signup-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <PasswordStrength password={password} />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !passwordValid} loading={loading}>
                Create Account
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="magiclink">
            <form onSubmit={handleMagicLink} className="space-y-3 mt-3">
              <div className="space-y-1">
                <Label htmlFor="magiclink-email">Email</Label>
                <Input
                  id="magiclink-email"
                  type="email"
                  value={magicLinkEmail}
                  onChange={(e) => setMagicLinkEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading} loading={loading}>
                Send magic link
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
