import { Link } from "wouter";
import { Sparkles, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";

export function StarterPromoBar() {
  const { user, isAuthenticated } = useAuth();
  const [isDismissed, setIsDismissed] = useState(false);
  
  useEffect(() => {
    const dismissed = sessionStorage.getItem('starterPromoDismissed');
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, []);
  
  const handleDismiss = () => {
    setIsDismissed(true);
    sessionStorage.setItem('starterPromoDismissed', 'true');
  };
  
  if (isDismissed) return null;
  
  const isFreeUser = !isAuthenticated || user?.subscriptionPlan === 'free';
  if (!isFreeUser) return null;
  
  return (
    <div className="relative bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/20">
      <div className="container mx-auto px-4 py-2">
        <div className="flex items-center justify-center gap-3 text-sm">
          <Sparkles className="h-4 w-4 text-primary animate-pulse" />
          <span className="text-foreground/90">
            <span className="font-semibold text-primary">Limited Special:</span>
            {" "}1 hour of podcasts for just $1.50
          </span>
          <Link href="/pricing">
            <Button 
              size="sm" 
              variant="default"
              className="h-7 px-3 text-xs gap-1 bg-primary hover:bg-primary/90"
              data-testid="button-promo-starter"
            >
              Get Started
              <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 absolute right-2 text-muted-foreground hover:text-foreground"
            onClick={handleDismiss}
            data-testid="button-promo-dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
