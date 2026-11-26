import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Gift, Eye, EyeOff } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Capacitor } from "@capacitor/core";
import { nativeGoogleSignIn } from "@/lib/native-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  emphasizeFreeTrial?: boolean;
}

type AuthMode = 'signin' | 'signup';

export function AuthModal({
  open,
  onOpenChange,
  title,
  description,
  emphasizeFreeTrial = false,
}: AuthModalProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  const handleGoogleLogin = async () => {
    const isNative = Capacitor.isNativePlatform();
    
    if (isNative) {
      setIsLoading(true);
      try {
        const result = await nativeGoogleSignIn();
        if (result.success) {
          toast({
            title: "Success",
            description: "Signed in with Google!",
          });
          window.location.reload();
        } else {
          toast({
            title: "Sign-in failed",
            description: result.error || "Could not sign in with Google",
            variant: "destructive",
          });
        }
      } catch (error: any) {
        toast({
          title: "Sign-in failed",
          description: error.message || "Could not sign in with Google",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
      return;
    }
    
    window.location.href = `/api/auth/google?source=web`;
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const body = authMode === 'signup' 
        ? { email, password, firstName, lastName }
        : { email, password };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        credentials: 'include',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Authentication failed');
      }

      try {
        // Use the shared apiRequest helper so we go through the same
        // credentials/guest-header pipeline as every other call (instead
        // of hand-rolling fetch with credentials: include).
        const tokenRes = await apiRequest("GET", "/api/auth/session-token");
        const tokenData = await tokenRes.json();
        if (tokenData?.token) {
          localStorage.setItem("podbrew_auth_token", tokenData.token);
        }
      } catch {}

      // Drop the cached null/unauth user so the next mount picks up the
      // freshly signed-in identity instead of the stale pre-login value.
      // (We're about to reload anyway, but this also covers the case where
      // a future change removes the reload.)
      queryClient.removeQueries({ queryKey: ["/api/auth/user"] });

      toast({
        title: "Success",
        description: authMode === 'signup' ? "Account created successfully!" : "Signed in successfully!",
      });

      window.location.reload();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || `Failed to ${authMode === 'signup' ? 'sign up' : 'sign in'}`,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setFirstName('');
    setLastName('');
  };

  const toggleAuthMode = () => {
    setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-w-[95vw] mx-auto p-4 sm:p-6">
        <DialogHeader>
          {emphasizeFreeTrial && (
            <div className="flex justify-center mb-2 sm:mb-3">
              <Badge 
                variant="outline" 
                className="bg-primary/10 border-primary text-primary px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-bold"
              >
                <Gift className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-1.5" />
                FREE TRIAL - No Card Required
              </Badge>
            </div>
          )}
          <DialogTitle className="text-xl sm:text-2xl font-bold flex items-center gap-2 justify-center">
            <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            {emphasizeFreeTrial 
              ? "Start Your Free Trial" 
              : (title || (authMode === 'signup' ? "Create Account" : "Sign In to PodBrew"))}
          </DialogTitle>
          <DialogDescription className="text-center text-xs sm:text-sm">
            {emphasizeFreeTrial
              ? "Get 3 FREE credits instantly. Create professional podcasts with AI voices, scripts, and cover art. Unlimited free listening. No credit card required!"
              : (description || `${authMode === 'signup' ? 'Create an account' : 'Sign in'} to create podcasts and enjoy unlimited free listening`)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
          {/* Google Sign-In Button */}
          <Button
            onClick={handleGoogleLogin}
            className="w-full bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 gap-2 font-semibold text-sm sm:text-base h-10 sm:h-12"
            data-testid="button-google-signin"
            disabled={isLoading}
          >
            <FcGoogle className="h-4 w-4 sm:h-5 sm:w-5" />
            Sign in with Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or {authMode === 'signup' ? 'sign up' : 'sign in'} with email
              </span>
            </div>
          </div>

          {/* Email/Password Form */}
          <form onSubmit={handleEmailAuth} className="space-y-3 sm:space-y-4">
            {authMode === 'signup' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="John"
                    data-testid="input-firstname"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                    data-testid="input-lastname"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                data-testid="input-email"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  data-testid="input-password"
                  disabled={isLoading}
                  minLength={6}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-toggle-password"
                  disabled={isLoading}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-[#1DB954] hover:bg-[#1DB954]/90 text-black gap-2 font-semibold text-sm sm:text-base h-10 sm:h-12"
              data-testid="button-email-submit"
              disabled={isLoading}
            >
              <Sparkles className="h-4 w-4 sm:h-5 sm:w-5" />
              {isLoading 
                ? `${authMode === 'signup' ? 'Creating Account' : 'Signing In'}...` 
                : (emphasizeFreeTrial ? "Start FREE Trial Now" : (authMode === 'signup' ? 'Create Account' : 'Sign In'))}
            </Button>
          </form>

          {/* Toggle Sign In/Sign Up */}
          <div className="text-center">
            <button
              type="button"
              onClick={toggleAuthMode}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-toggle-auth-mode"
            >
              {authMode === 'signup' 
                ? "Already have an account? Sign in" 
                : "Don't have an account? Sign up"}
            </button>
          </div>

          <div className="rounded-lg bg-gradient-to-br from-primary/5 to-green-500/5 border border-primary/20 p-3 sm:p-4 text-xs sm:text-sm">
            <p className="font-bold mb-1.5 sm:mb-2 text-foreground flex items-center gap-2">
              <Gift className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary" />
              {emphasizeFreeTrial ? "Your Free Trial Includes:" : "Free Plan Includes:"}
            </p>
            <ul className="space-y-1 sm:space-y-1.5 text-foreground/90">
              <li className="flex items-start gap-1.5 sm:gap-2">
                <span className="text-primary font-bold">✓</span>
                <span><strong>Unlimited Free Listening</strong> to all podcasts</span>
              </li>
              <li className="flex items-start gap-1.5 sm:gap-2">
                <span className="text-primary font-bold">✓</span>
                <span><strong>3 Free credits</strong> (up to 15 min podcast)</span>
              </li>
              <li className="flex items-start gap-1.5 sm:gap-2">
                <span className="text-primary font-bold">✓</span>
                <span><strong>All Voice Qualities</strong> & 8 Podcast Modes</span>
              </li>
              <li className="flex items-start gap-1.5 sm:gap-2">
                <span className="text-primary font-bold">✓</span>
                <span><strong>AI Scripts & Cover Art</strong> - No card required</span>
              </li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
