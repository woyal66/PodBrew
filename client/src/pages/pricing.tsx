import { Check, Globe, Zap, Clock, Star, Shield, Sparkles, ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { Helmet } from "react-helmet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SUBSCRIPTION_PLANS } from "@shared/schema";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { useCurrency } from "@/contexts/currency-context";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const pricingTiers = [
  {
    name: "Free",
    price: 0,
    credits: 3,
    hours: "15 min",
    hoursNumeric: 0.25,
    description: "Try PodBrew risk-free",
    features: SUBSCRIPTION_PLANS.free.features,
    highlighted: false,
    plan: "free",
    ctaText: "Current Plan",
    badge: null,
  },
  {
    name: "Starter",
    price: 1.50,
    credits: 60,
    hours: "1 hour",
    hoursNumeric: 1,
    description: "Limited time special offer",
    features: SUBSCRIPTION_PLANS.starter.features,
    highlighted: true,
    plan: "starter",
    ctaText: "Grab This Deal",
    badge: "Limited Special",
    isPromo: true,
  },
  {
    name: "Creator",
    price: 3.50,
    credits: 30,
    hours: "2.5 hours",
    hoursNumeric: 2.5,
    description: "Perfect for casual podcasters",
    features: SUBSCRIPTION_PLANS.creator.features,
    highlighted: false,
    plan: "creator",
    ctaText: "Get Started",
    badge: null,
  },
  {
    name: "Studio",
    price: 10.95,
    credits: 100,
    hours: "8 hours",
    hoursNumeric: 8,
    description: "Best value for regular creators",
    features: SUBSCRIPTION_PLANS.studio.features,
    highlighted: false,
    plan: "studio",
    ctaText: "Start Creating",
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
    highlighted: false,
    plan: "pro",
    ctaText: "Go Pro",
    badge: "Best for Teams",
  },
  {
    name: "Professional",
    price: 29.95,
    credits: 300,
    hours: "25 hours",
    hoursNumeric: 25,
    description: "Unlimited creativity",
    features: SUBSCRIPTION_PLANS.professional.features,
    highlighted: false,
    plan: "professional",
    ctaText: "Unlock All",
    badge: "Power User",
  },
];

function CurrencySelector() {
  const { currency, setCurrency } = useCurrency();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          data-testid="button-currency-selector"
        >
          <Globe className="h-4 w-4" />
          <span>{currency}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => setCurrency("USD")}
          data-testid="button-currency-usd"
          className={currency === "USD" ? "font-bold" : ""}
        >
          USD $ {currency === "USD" && "✓"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setCurrency("AUD")}
          data-testid="button-currency-aud"
          className={currency === "AUD" ? "font-bold" : ""}
        >
          AUD A$ {currency === "AUD" && "✓"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setCurrency("EUR")}
          data-testid="button-currency-eur"
          className={currency === "EUR" ? "font-bold" : ""}
        >
          EUR € {currency === "EUR" && "✓"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Pricing() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { formatPrice } = useCurrency();
  const [expandedTiers, setExpandedTiers] = useState<Set<string>>(new Set());

  const toggleTierExpanded = (tierName: string) => {
    const newExpanded = new Set(expandedTiers);
    if (newExpanded.has(tierName)) {
      newExpanded.delete(tierName);
    } else {
      newExpanded.add(tierName);
    }
    setExpandedTiers(newExpanded);
  };

  // Mutation to create Stripe checkout session
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
      // Redirect to Stripe checkout
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

  return (
    <>
      <Helmet>
        <title>Pricing - AI Podcast Plans from $3.50/mo | PodBrew</title>
        <meta name="description" content="Choose the perfect PodBrew plan for your needs. Start free with 3 credits, or upgrade to Creator, Studio, Pro, or Professional for more podcast generation power." />
        <meta property="og:title" content="Pricing - AI Podcast Plans from $3.50/mo | PodBrew" />
        <meta property="og:description" content="Choose the perfect PodBrew plan. Start free or upgrade to Creator, Studio, Pro, or Professional for more podcast generation power." />
        <meta property="og:url" content="https://podbrew.pro/pricing" />
        <meta name="twitter:title" content="Pricing - AI Podcast Plans from $3.50/mo | PodBrew" />
        <meta name="twitter:description" content="Choose the perfect PodBrew plan. Start free or upgrade for more podcast generation power." />
        <link rel="canonical" href="https://podbrew.pro/pricing" />
      </Helmet>
      <div className="min-h-screen bg-background pb-24 md:pb-16">
        {/* Header */}
        <div className="border-b bg-gradient-to-b from-[#181818] to-background">
          <div className="container mx-auto px-4 py-6 md:py-12">
            <div className="flex items-center justify-between mb-4 md:mb-8">
              <div className="flex-1" />
              <CurrencySelector />
            </div>
            <div className="text-center max-w-3xl mx-auto">
              <Badge variant="secondary" className="mb-3 md:mb-4 bg-[#1DB954]/10 text-[#1DB954] border-[#1DB954]/30">
                <Zap className="w-3 h-3 mr-1" />
                Credit-Based Pricing
              </Badge>
              <h1 className="text-2xl sm:text-3xl md:text-5xl font-bold mb-3 md:mb-4">
                Simple, Transparent Pricing
            </h1>
            <p className="text-sm sm:text-base md:text-lg text-muted-foreground px-2">
              Create custom AI-powered podcasts — less than $1 per hour
            </p>
            
            {/* Trust Signals */}
            <div className="flex flex-wrap items-center justify-center gap-3 md:gap-6 mt-4 md:mt-6">
              <div className="flex items-center gap-1.5 text-xs md:text-sm text-muted-foreground">
                <Shield className="h-4 w-4 text-[#1DB954]" />
                <span>Cancel anytime</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs md:text-sm text-muted-foreground">
                <Star className="h-4 w-4 text-[#1DB954]" />
                <span>No hidden fees</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs md:text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-[#1DB954]" />
                <span>Instant access</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="container mx-auto px-3 sm:px-4 py-8 md:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 md:gap-6 max-w-7xl mx-auto">
          {pricingTiers.map((tier) => (
            <Card
              key={tier.name}
              className={`relative flex flex-col transition-all duration-300 ${
                tier.highlighted
                  ? "border-[#1DB954] border-2 shadow-2xl shadow-[#1DB954]/50 md:scale-105 bg-gradient-to-br from-[#1DB954]/15 via-[#1DB954]/5 to-transparent ring-1 ring-[#1DB954]/30"
                  : "border-[#1DB954]/30 bg-gradient-to-br from-[#1DB954]/8 to-transparent shadow-lg shadow-[#1DB954]/20 hover:border-[#1DB954]/50 hover:shadow-xl hover:shadow-[#1DB954]/30 hover:from-[#1DB954]/12"
              }`}
              data-testid={`card-pricing-${tier.name.toLowerCase()}`}
            >
              {/* Badge - Positioned above card */}
              {tier.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                  <Badge 
                    className={`font-bold px-3 py-1.5 text-xs whitespace-nowrap shadow-lg ${
                      tier.highlighted 
                        ? "bg-[#1DB954] text-black border-0" 
                        : "bg-[#1DB954] text-black border-0 font-semibold"
                    }`}
                  >
                    {tier.highlighted && <Sparkles className="w-3 h-3 mr-1" />}
                    {!tier.highlighted && <Zap className="w-3 h-3 mr-1" />}
                    {tier.badge}
                  </Badge>
                </div>
              )}

              <CardHeader className="pb-2 pt-5 md:pt-6">
                <CardTitle className="text-xl md:text-2xl">{tier.name}</CardTitle>
                <CardDescription className="text-xs md:text-sm">{tier.description}</CardDescription>
                
                {/* Price Display */}
                <div className="mt-3 md:mt-4">
                  {tier.price === 0 ? (
                    <span className="text-3xl md:text-4xl font-bold">Free</span>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl md:text-4xl font-bold">{formatPrice(tier.price)}</span>
                      <span className="text-muted-foreground text-sm">/mo</span>
                    </div>
                  )}
                </div>
                
                {/* Hours Badge - Prominent Display */}
                <div className="mt-4 md:mt-5">
                  <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg font-semibold ${
                    tier.highlighted 
                      ? "bg-[#1DB954]/20 border border-[#1DB954]/40" 
                      : "bg-[#1DB954]/10 border border-[#1DB954]/25"
                  }`}>
                    <Clock className="h-4 w-4 text-[#1DB954]" />
                    <span className="text-[#1DB954] text-sm md:text-base">
                      Up to {tier.hours}
                    </span>
                    <span className="text-xs text-[#1DB954]/70">creation</span>
                  </div>
                </div>
                
                {/* Credits Badge */}
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline" className="text-xs">
                    {tier.credits} credits/month
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="flex-1 py-3 md:py-4">
                <ul className="space-y-2 md:space-y-3">
                  {(expandedTiers.has(tier.name) ? tier.features : tier.features.slice(0, 4)).map((feature, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <Check className={`h-4 w-4 shrink-0 mt-0.5 ${tier.highlighted ? "text-[#1DB954]" : "text-[#1DB954]/70"}`} />
                      <span className="text-xs md:text-sm text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                  {tier.features.length > 4 && (
                    <button
                      onClick={() => toggleTierExpanded(tier.name)}
                      className="text-xs text-[#1DB954] hover:text-[#1DB954]/80 pl-6 font-medium flex items-center gap-1 mt-1 hover-elevate active-elevate-2"
                      data-testid={`button-toggle-features-${tier.name.toLowerCase()}`}
                    >
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expandedTiers.has(tier.name) ? 'rotate-180' : ''}`} />
                      {expandedTiers.has(tier.name) ? 'Show less' : `+${tier.features.length - 4} more features`}
                    </button>
                  )}
                </ul>
              </CardContent>

              <CardFooter className="pt-4 pb-5 md:pb-6 px-0 flex flex-col gap-2">
                {tier.price === 0 ? (
                  <Button
                    variant="outline"
                    className="w-full h-11 md:h-12 text-sm md:text-base font-semibold border-[#1DB954]/30"
                    disabled
                    data-testid={`button-subscribe-${tier.name.toLowerCase()}`}
                  >
                    Current Plan
                  </Button>
                ) : (
                  <>
                    <Button
                      className="w-full h-12 md:h-13 text-sm md:text-base font-bold transition-all duration-200 animate-pulsate bg-[#1DB954] hover:bg-[#20CC62] text-black shadow-lg shadow-[#1DB954]/60 hover:shadow-2xl hover:shadow-[#1DB954]/80 active:scale-95"
                      onClick={() => handleSubscribe(tier.plan)}
                      disabled={createCheckoutMutation.isPending}
                      data-testid={`button-subscribe-${tier.name.toLowerCase()}`}
                    >
                      {createCheckoutMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Zap className="h-5 w-5 mr-2" />
                          {tier.ctaText}
                        </>
                      )}
                    </Button>
                  </>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
        
        {/* Value Proposition Banner */}
        <div className="mt-8 md:mt-12 max-w-3xl mx-auto">
          <div className="bg-gradient-to-r from-[#1DB954]/10 via-[#1DB954]/5 to-[#1DB954]/10 border border-[#1DB954]/20 rounded-xl p-4 md:p-6 text-center">
            <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-6">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-[#1DB954]" />
                <span className="text-sm md:text-base font-medium">Less than $1/hour</span>
              </div>
              <div className="hidden md:block w-px h-6 bg-border" />
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-[#1DB954]" />
                <span className="text-sm md:text-base font-medium">Instant podcast creation</span>
              </div>
              <div className="hidden md:block w-px h-6 bg-border" />
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-[#1DB954]" />
                <span className="text-sm md:text-base font-medium">Premium AI voices</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl md:text-2xl font-bold mb-6 md:mb-8 text-center">Frequently Asked Questions</h2>
          <div className="space-y-4 md:space-y-6">
            <div className="bg-card rounded-lg p-4 border">
              <h3 className="font-semibold mb-2 text-sm md:text-base">Can I change plans anytime?</h3>
              <p className="text-muted-foreground text-xs md:text-sm">
                Yes! You can upgrade or downgrade your plan at any time. Changes take effect on your next billing cycle.
              </p>
            </div>
            <div className="bg-card rounded-lg p-4 border">
              <h3 className="font-semibold mb-2 text-sm md:text-base">Do credits roll over?</h3>
              <p className="text-muted-foreground text-xs md:text-sm">
                Credits do not roll over to the next month. Each month resets with your plan's credit allowance.
              </p>
            </div>
            <div className="bg-card rounded-lg p-4 border">
              <h3 className="font-semibold mb-2 text-sm md:text-base">What happens if I run out of credits?</h3>
              <p className="text-muted-foreground text-xs md:text-sm">
                You'll need to upgrade your plan or wait for your next billing cycle. Free plan users can always create up to 2-minute podcasts.
              </p>
            </div>
            <div className="bg-card rounded-lg p-4 border">
              <h3 className="font-semibold mb-2 text-sm md:text-base">Is there a contract?</h3>
              <p className="text-muted-foreground text-xs md:text-sm">
                No! Your subscription is month-to-month. Cancel anytime from your account settings.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
