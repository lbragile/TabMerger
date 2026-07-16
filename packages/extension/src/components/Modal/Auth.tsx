import { useState } from 'react';
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const { signIn, signUp, resetPassword, signOut, user } = useAuth();

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
        <div className="mt-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            You are signed in as <strong>{user.email}</strong>.
          </p>
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
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Sending...' : 'Send reset email'}
          </Button>
          <Button type="button" variant="ghost" className="w-full text-xs" onClick={() => setForgotPassword(false)}>
            Back to sign in
          </Button>
        </form>
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

      <div className="mt-4">
        <Tabs defaultValue="signin">
          <TabsList className="w-full">
            <TabsTrigger value="signin" className="flex-1 text-xs">
              Sign In
            </TabsTrigger>
            <TabsTrigger value="signup" className="flex-1 text-xs">
              Sign Up
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
                <Input
                  id="signin-password"
                  type="password"
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
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
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
                <Input
                  id="signup-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <PasswordStrength password={password} />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !passwordValid}>
                {loading ? 'Creating account...' : 'Create Account'}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
