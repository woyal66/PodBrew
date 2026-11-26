import { useState, useRef, useEffect } from "react";
import { Check, CreditCard, AlertCircle, ChevronDown, X, Sparkles, Globe, Loader2, User, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SUBSCRIPTION_PLANS } from "@shared/schema";
import { useCurrency } from "@/contexts/currency-context";
import { useAuth } from "@/contexts/auth-context";
import { useLocation } from "wouter";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showUpgradeBanner?: boolean;
}

const pricingTiers = [
  {
    name: "Free",
    price: 0,
    credits: 3,
    hours: "15 min",
    hoursNumeric: 0.25,
    description: "Try PodBrew risk-free",
    features: SUBSCRIPTION_PLANS.free.features,
    plan: "free",
    badge: null,
  },
  {
    name: "Creator",
    price: 3.50,
    credits: 30,
    hours: "2.5 hours",
    hoursNumeric: 2.5,
    description: "Perfect for casual podcasters",
    features: SUBSCRIPTION_PLANS.creator.features,
    plan: "creator",
    badge: "Starter",
  },
  {
    name: "Studio",
    price: 10.95,
    credits: 100,
    hours: "8 hours",
    hoursNumeric: 8,
    description: "For regular content creation",
    features: SUBSCRIPTION_PLANS.studio.features,
    highlighted: true,
    plan: "studio",
    badge: "Most Popular",
  },
  {
    name: "Pro",
    price: 19.95,
    credits: 180,
    hours: "15 hours",
    hoursNumeric: 15,
    description: "For serious podcasters",
    features: SUBSCRIPTION_PLANS.pro.features,
    plan: "pro",
    badge: "Best for Teams",
  },
  {
    name: "Professional",
    price: 29.95,
    credits: 300,
    hours: "25 hours",
    hoursNumeric: 25,
    description: "For professional studios",
    features: SUBSCRIPTION_PLANS.professional.features,
    plan: "professional",
    badge: "Power User",
  },
];

export function SettingsSheet({ open, onOpenChange, showUpgradeBanner = false }: SettingsSheetProps) {
  const { toast } = useToast();
  const { formatPrice } = useCurrency();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const subscriptionSectionRef = useRef<HTMLDivElement>(null);
  const { isAuthenticated, user } = useAuth();
  const [, setLocation] = useLocation();

  const { data: credits } = useQuery<{ credits: number; plan: string }>({
    queryKey: ["/api/user/credits"],
  });

  const createCheckoutMutation = useMutation({
    mutationFn: async (plan: string) => {
      const res = await apiRequest(
        'POST',
        `/api/stripe/create-checkout-session`,
        { plan }
      );
      const result = await res.json();
      return result as { url: string; sessionId: string };
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create checkout session",
        variant: "destructive",
      });
    },
  });

  const handleSubscribe = (plan: string) => {
    createCheckoutMutation.mutate(plan);
  };

  const cancelSubscriptionMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("/api/user/cancel-subscription", "POST", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/credits"] });
      toast({
        title: "Subscription Cancelled",
        description: "Your subscription has been cancelled. You've been moved to the Free plan.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Cancellation Failed",
        description: error.message || "Failed to cancel subscription. Please try again.",
        variant: "destructive",
      });
    },
  });

  const getPlanBadgeColor = (plan: string) => {
    switch (plan) {
      case 'free': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
      case 'creator': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'studio': return 'bg-[#1DB954]/20 text-[#1DB954] border-[#1DB954]/30';
      case 'pro': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'professional': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getPlanDisplayName = (plan: string) => {
    return plan.charAt(0).toUpperCase() + plan.slice(1);
  };

  const { currency, setCurrency } = useCurrency();

  // Reset banner dismissed state when showUpgradeBanner becomes true
  useEffect(() => {
    if (showUpgradeBanner) {
      setBannerDismissed(false);
    }
  }, [showUpgradeBanner]);

  // Auto-scroll to subscription plans when upgrade banner is shown
  useEffect(() => {
    if (showUpgradeBanner && open && subscriptionSectionRef.current) {
      setTimeout(() => {
        subscriptionSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    }
  }, [showUpgradeBanner, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-2xl">Settings & Subscription</SheetTitle>
          <SheetDescription>
            Manage your PodBrew account and subscription
          </SheetDescription>
        </SheetHeader>

        {/* Upgrade Banner */}
        {showUpgradeBanner && !bannerDismissed && (
          <div className="mt-6 p-4 rounded-lg bg-primary/10 border border-primary/30 relative">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 h-6 w-6"
              onClick={() => setBannerDismissed(true)}
              data-testid="button-dismiss-upgrade-banner"
            >
              <X className="h-4 w-4" />
            </Button>
            <div className="flex items-start gap-3 pr-8">
              <Sparkles className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-foreground mb-1">Unlock Longer Podcasts</p>
                <p className="text-sm text-foreground/80">
                  Free plan covers up to 2 minutes per brew. Upgrade to keep your longer episodes rolling.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 space-y-6">
          {/* Account Summary */}
          {credits && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Your Account
              </h3>
              <div className="p-4 rounded-lg bg-muted border space-y-4">
                {/* User Profile Info */}
                {user && (
                  <div className="flex items-center gap-3 pb-3 border-b border-border">
                    <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate" data-testid="text-user-email">
                        {user.email || 'No email'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Logged in
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Plan & Credits */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Current Plan</p>
                    <Badge className={getPlanBadgeColor(credits.plan)} data-testid="badge-current-plan">
                      {getPlanDisplayName(credits.plan)}
                    </Badge>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground mb-1">Credits</p>
                    <p className="text-2xl font-bold" data-testid="text-credits-balance">{credits.credits.toFixed(1)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Currency Selector */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Pricing Currency
            </h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 justify-between"
                  data-testid="button-currency-selector"
                >
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    <span>Current: {currency}</span>
                  </div>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => setCurrency("USD")}
                  data-testid="button-currency-usd"
                  className={currency === "USD" ? "font-bold" : ""}
                >
                  <span className="flex-1">USD - US Dollar</span>
                  {currency === "USD" && <Check className="h-4 w-4 ml-2" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setCurrency("AUD")}
                  data-testid="button-currency-aud"
                  className={currency === "AUD" ? "font-bold" : ""}
                >
                  <span className="flex-1">AUD - Australian Dollar</span>
                  {currency === "AUD" && <Check className="h-4 w-4 ml-2" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setCurrency("EUR")}
                  data-testid="button-currency-eur"
                  className={currency === "EUR" ? "font-bold" : ""}
                >
                  <span className="flex-1">EUR - Euro</span>
                  {currency === "EUR" && <Check className="h-4 w-4 ml-2" />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground">
              Select your preferred currency for displaying subscription prices throughout the app.
            </p>
          </div>

          {/* Pricing Tiers */}
          <div ref={subscriptionSectionRef} className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Subscription Plans
            </h3>
            <Accordion type="single" collapsible className="space-y-2">
              {pricingTiers.map((tier) => (
                <AccordionItem 
                  key={tier.plan} 
                  value={tier.plan}
                  className={`border rounded-lg px-4 data-[state=open]:bg-muted/50 ${
                    tier.highlighted
                      ? "border-[#1DB954] border-2 bg-gradient-to-br from-[#1DB954]/8 to-transparent"
                      : "border-[#1DB954]/20"
                  }`}
                >
                  <AccordionTrigger className="hover:no-underline py-4">
                    <div className="flex items-center justify-between w-full pr-4">
                      <div className="text-left flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{tier.name}</span>
                          {tier.badge && (
                            <Badge className="bg-[#1DB954] text-black text-xs px-2 py-1">
                              {tier.highlighted && <Sparkles className="w-3 h-3 mr-1" />}
                              {tier.badge}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {tier.description}
                        </p>
                      </div>
                      <div className="text-right">
                        {tier.price === 0 ? (
                          <span className="text-lg font-bold">Free</span>
                        ) : (
                          <>
                            <span className="text-lg font-bold">{formatPrice(tier.price)}</span>
                            <p className="text-xs text-muted-foreground">/mo</p>
                          </>
                        )}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-4 pt-2">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1DB954]/10 border border-[#1DB954]/25 inline-flex">
                        <span className="text-[#1DB954] text-sm font-semibold">
                          Up to {tier.hours}
                        </span>
                        <span className="text-xs text-[#1DB954]/70">creation</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {tier.credits} credits/month
                        </Badge>
                      </div>
                      <ul className="space-y-2">
                        {tier.features.slice(0, 4).map((feature, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <Check className="h-4 w-4 text-[#1DB954] shrink-0 mt-0.5" />
                            <span className="text-xs">{feature}</span>
                          </li>
                        ))}
                        {tier.features.length > 4 && (
                          <li className="text-xs text-muted-foreground pl-6">
                            +{tier.features.length - 4} more features
                          </li>
                        )}
                      </ul>
                      {tier.price === 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          disabled
                          data-testid={`button-subscribe-${tier.name.toLowerCase()}`}
                        >
                          Current Plan
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="w-full bg-[#1DB954] hover:bg-[#20CC62] text-black font-semibold animate-pulsate shadow-lg shadow-[#1DB954]/40"
                          onClick={() => handleSubscribe(tier.plan)}
                          disabled={createCheckoutMutation.isPending}
                          data-testid={`button-subscribe-${tier.name.toLowerCase()}`}
                        >
                          {createCheckoutMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <Zap className="h-4 w-4 mr-1" />
                              Subscribe Now
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          {/* How Credits Work */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              How Credits Work
            </h3>
            <div className="p-4 rounded-lg border space-y-3">
              <p className="text-sm text-muted-foreground">
                Credits are used based on podcast duration and voice quality tier. Higher quality voices use more credits per minute.
              </p>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Standard Quality</span>
                  <span className="font-medium">0.2 credits/min</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Premium Quality</span>
                  <span className="font-medium">0.2 credits/min</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Ultra Quality</span>
                  <span className="font-medium">0.4 credits/min</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Cinematic Quality</span>
                  <span className="font-medium">0.9 credits/min</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground pt-2 border-t">
                No hidden fees • Credits never expire • Cancel anytime
              </p>
            </div>
          </div>

          {/* Manage Subscription */}
          {credits && credits.plan !== 'free' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Manage Subscription
              </h3>
              <div className="p-4 rounded-lg border space-y-3">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <p className="text-sm text-muted-foreground">
                    Cancel your subscription at any time. You'll keep your current credits until they're used up.
                  </p>
                </div>
                
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button 
                      variant="outline" 
                      className="w-full"
                      data-testid="button-cancel-subscription"
                    >
                      Cancel Subscription
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Cancel Subscription?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to cancel your subscription? You'll keep your remaining {credits.credits.toFixed(1)} credits, but won't receive new credits next month.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep Subscription</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => cancelSubscriptionMutation.mutate()}
                        className="bg-destructive hover:bg-destructive/90"
                      >
                        Cancel Subscription
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
