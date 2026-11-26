import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Capacitor } from "@capacitor/core";
import { 
  Gift, 
  Clock, 
  Sparkles, 
  CheckCircle2,
  Headphones,
  Mic,
  Library
} from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { useState } from "react";
import { nativeGoogleSignIn } from "@/lib/native-auth";
import { useToast } from "@/hooks/use-toast";

interface TrialSignupPromptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  podcastTitle?: string;
  hoursRemaining?: number;
  onListenNow?: () => void;
}

export function TrialSignupPromptModal({
  open,
  onOpenChange,
  podcastTitle,
  hoursRemaining = 24,
  onListenNow,
}: TrialSignupPromptModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleGoogleSignup = async () => {
    if (Capacitor.isNativePlatform()) {
      setIsLoading(true);
      try {
        const result = await nativeGoogleSignIn();
        if (result.success) {
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

  const handleEmailSignup = () => {
    window.location.href = `/api/auth/google?source=web`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-w-[95vw] mx-auto p-4 sm:p-6">
        <DialogHeader>
          <div className="flex justify-center mb-3">
            <Badge 
              variant="outline" 
              className="bg-primary/10 border-primary text-primary px-3 py-1.5 text-sm font-bold"
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              Podcast Created!
            </Badge>
          </div>
          <DialogTitle className="text-xl sm:text-2xl font-bold flex items-center gap-2 justify-center">
            <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Your Podcast is Ready
          </DialogTitle>
          <DialogDescription className="text-center text-sm">
            {podcastTitle ? (
              <>"{podcastTitle}" is ready to play!</>
            ) : (
              <>Your trial podcast is ready to play!</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 flex items-center gap-3">
            <Clock className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <div className="text-sm">
              <span className="font-semibold text-amber-500">Expires in {hoursRemaining} hours</span>
              <p className="text-muted-foreground text-xs mt-0.5">
                Sign up free to save your podcast forever
              </p>
            </div>
          </div>

          {onListenNow && (
            <Button
              onClick={onListenNow}
              className="w-full bg-primary text-primary-foreground gap-2 font-semibold h-11"
              data-testid="button-listen-trial"
            >
              <Headphones className="h-4 w-4" />
              Listen Now
            </Button>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Save & Unlock More
              </span>
            </div>
          </div>

          <Button
            onClick={handleGoogleSignup}
            className="w-full bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 gap-2 font-semibold h-11"
            data-testid="button-google-signup-trial"
          >
            <FcGoogle className="h-5 w-5" />
            Sign up with Google
          </Button>

          <Button
            onClick={handleEmailSignup}
            variant="outline"
            className="w-full gap-2 h-11"
            data-testid="button-email-signup-trial"
          >
            Sign up with Email
          </Button>

          <div className="rounded-lg bg-gradient-to-br from-primary/5 to-green-500/5 border border-primary/20 p-4 text-sm">
            <p className="font-bold mb-2 text-foreground flex items-center gap-2">
              <Gift className="h-4 w-4 text-primary" />
              Free Plan Includes:
            </p>
            <ul className="space-y-1.5 text-foreground/90">
              <li className="flex items-start gap-2">
                <span className="text-primary font-bold">+</span>
                <span><strong>Save your trial podcast</strong> permanently</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary font-bold">+</span>
                <span><strong>3 free credits</strong> for more podcasts (up to 15 min)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary font-bold">+</span>
                <span><strong>Unlimited listening</strong> to all public podcasts</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary font-bold">+</span>
                <span><strong>Library & playlists</strong> to organize favorites</span>
              </li>
            </ul>
          </div>

          <button
            onClick={() => onOpenChange(false)}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
            data-testid="button-skip-signup"
          >
            Maybe later (podcast expires in {hoursRemaining}h)
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
