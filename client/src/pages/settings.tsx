import { useState, useEffect, useRef } from "react";
import { Helmet } from "react-helmet";
import { 
  Settings as SettingsIcon, 
  CreditCard, 
  AlertCircle, 
  Loader2, 
  ExternalLink, 
  Volume2, 
  Bell, 
  MapPin,
  Check,
  Globe,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Crown,
  Zap,
  Clock,
  User,
  Rss,
  Upload,
  Shield,
  FileText,
  Pencil
} from "lucide-react";
import { Link } from "wouter";
import { getVersionString } from "@/lib/version";
import { DistributionSettings } from "@/components/distribution-settings";
import { TtsQuotaStatus } from "@/components/tts-quota-status";
import { LlmUsageStats } from "@/components/llm-usage-stats";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { useCurrency } from "@/contexts/currency-context";
import { useLocation } from "wouter";
import { SUBSCRIPTION_PLANS } from "@shared/schema";
import { getGuestIdentity, setGuestDisplayName, type GuestIdentity } from "@/lib/guestIdentity";
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
    hours: "Up to 1 hour",
    hoursNumeric: 1,
    description: "Perfect first step",
    features: SUBSCRIPTION_PLANS.starter.features,
    highlighted: true,
    plan: "starter",
    ctaText: "Get Started",
    badge: "Limited Special",
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

export default function Settings() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { currency, setCurrency, formatPrice } = useCurrency();
  const [, setLocation] = useLocation();
  const pricingScrollRef = useRef<HTMLDivElement>(null);
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());
  
  const togglePlanExpanded = (plan: string) => {
    const newExpanded = new Set(expandedPlans);
    if (newExpanded.has(plan)) {
      newExpanded.delete(plan);
    } else {
      newExpanded.add(plan);
    }
    setExpandedPlans(newExpanded);
  };
  
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(() => {
    const saved = localStorage.getItem('podbrew_autoplay');
    return saved !== 'false';
  });
  
  const [navigateOnComplete, setNavigateOnComplete] = useState(() => {
    const saved = localStorage.getItem('podbrew_navigate_on_complete');
    return saved !== 'false';
  });
  
  const [completionChime, setCompletionChime] = useState(() => {
    const saved = localStorage.getItem('podbrew_completion_chime');
    return saved !== 'false'; // Default to true
  });
  
  useEffect(() => {
    localStorage.setItem('podbrew_autoplay', String(autoPlayEnabled));
  }, [autoPlayEnabled]);
  
  useEffect(() => {
    localStorage.setItem('podbrew_navigate_on_complete', String(navigateOnComplete));
  }, [navigateOnComplete]);
  
  useEffect(() => {
    localStorage.setItem('podbrew_completion_chime', String(completionChime));
  }, [completionChime]);

  const [locationCity, setLocationCity] = useState<string>("");
  const [locationCityDraft, setLocationCityDraft] = useState<string>("");
  
  const [aliasDraft, setAliasDraft] = useState<string>("");
  const [avatarUrlDraft, setAvatarUrlDraft] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [guestIdentity, setGuestIdentityState] = useState<GuestIdentity>(() => getGuestIdentity());
  const [guestNameDraft, setGuestNameDraft] = useState<string>('');
  const [editingGuestName, setEditingGuestName] = useState(false);

  const { data: credits } = useQuery<{ credits: number; plan: string }>({
    queryKey: ["/api/user/credits"],
  });

  const { data: locationSettings } = useQuery<{ locationEnabled: boolean; locationCity: string | null }>({
    queryKey: ["/api/user/location"],
  });

  const { data: profileSettings } = useQuery<{ 
    alias: string | null; 
    avatarUrl: string | null;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
  }>({
    queryKey: ["/api/user/profile"],
  });

  useEffect(() => {
    if (locationSettings) {
      setLocationCity(locationSettings.locationCity || "");
      setLocationCityDraft(locationSettings.locationCity || "");
    }
  }, [locationSettings]);

  useEffect(() => {
    if (profileSettings) {
      setAliasDraft(profileSettings.alias || "");
      setAvatarUrlDraft(profileSettings.avatarUrl || "");
    }
  }, [profileSettings]);

  const updateLocationMutation = useMutation({
    mutationFn: async (data: { locationEnabled?: boolean; locationCity?: string }) => {
      const res = await apiRequest('PATCH', '/api/user/location', data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/location"] });
      toast({
        title: "Location updated",
        description: "Your location settings have been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update location settings",
        variant: "destructive",
      });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { alias?: string; avatarUrl?: string }) => {
      const res = await apiRequest('PATCH', '/api/user/profile', data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      toast({
        title: "Profile updated",
        description: "Your profile settings have been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile settings",
        variant: "destructive",
      });
    },
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('avatar', file);
      const res = await fetch('/api/user/avatar', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to upload avatar');
      }
      return await res.json() as { avatarUrl: string };
    },
    onSuccess: (data) => {
      setAvatarUrlDraft(data.avatarUrl);
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      toast({
        title: "Avatar uploaded",
        description: "Your profile picture has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload avatar image",
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select an image under 5MB",
          variant: "destructive",
        });
        return;
      }
      uploadAvatarMutation.mutate(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const { data: subscriptionStatus } = useQuery<{
    hasSubscription: boolean;
    status?: string;
    currentPeriodEnd?: number;
    cancelAtPeriodEnd?: boolean;
    plan?: string;
  }>({
    queryKey: ["/api/stripe/subscription-status"],
  });

  const createPortalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/stripe/create-portal-session', {});
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to create billing portal session');
      }
      const result = await res.json();
      if (!result.url) {
        throw new Error('No portal URL returned from server');
      }
      return result as { url: string };
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      console.error('Billing portal error:', error);
      toast({
        title: "Cannot access billing portal",
        description: error.message || "Failed to open billing portal. Please try again or contact support.",
        variant: "destructive",
      });
    },
  });

  const createCheckoutMutation = useMutation({
    mutationFn: async (plan: string) => {
      const res = await apiRequest('POST', `/api/stripe/create-checkout-session`, { plan });
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

  const cancelSubscriptionMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', "/api/user/cancel-subscription", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/credits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/subscription-status"] });
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

  const handleSubscribe = (plan: string) => {
    if (createCheckoutMutation.isPending) return;
    createCheckoutMutation.mutate(plan);
  };

  const scrollPricing = (direction: 'left' | 'right') => {
    if (pricingScrollRef.current) {
      const scrollAmount = 280;
      pricingScrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

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

  const currentPlan = credits?.plan || 'free';
  const currentTier = pricingTiers.find(t => t.plan === currentPlan);

  return (
    <>
      <Helmet>
        <title>Account Settings | PodBrew</title>
        <meta name="description" content="Manage your PodBrew account settings. Update your profile, subscription plan, playback preferences, and location settings." />
        <meta property="og:title" content="Account Settings | PodBrew" />
        <meta property="og:description" content="Manage your PodBrew account settings, subscription plan, and preferences." />
        <meta property="og:url" content="https://podbrew.pro/settings" />
        <meta name="twitter:title" content="Account Settings | PodBrew" />
        <meta name="twitter:description" content="Manage your PodBrew account settings, subscription plan, and preferences." />
        <link rel="canonical" href="https://podbrew.pro/settings" />
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background pb-24 md:pb-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(29,185,84,0.08),transparent_50%)] pointer-events-none" />
        
        <div className="relative z-10 mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-10 max-w-5xl min-w-0">
          {/* Compact Header */}
          <div className="mb-6">
            <div className="flex items-center gap-2.5 mb-1">
              <SettingsIcon className="h-6 w-6 text-primary" />
              <h1 className="text-2xl md:text-3xl font-bold font-display">Settings</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Manage your account and preferences
            </p>
          </div>


          {/* Tabs with visible text on mobile */}
          <Tabs defaultValue="preferences" className="space-y-5">
            <div className="overflow-x-auto scrollbar-hide -mx-4 px-4">
              <TabsList className="inline-flex w-auto min-w-full sm:w-full sm:grid sm:grid-cols-3 gap-1 bg-muted/50 p-1">
                <TabsTrigger 
                  value="profile" 
                  className="flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  data-testid="tab-profile"
                >
                  <User className="w-4 h-4" />
                  Profile
                </TabsTrigger>
                <TabsTrigger 
                  value="preferences" 
                  className="flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  data-testid="tab-preferences"
                >
                  <SettingsIcon className="w-4 h-4" />
                  Preferences
                </TabsTrigger>
                <TabsTrigger 
                  value="distribution" 
                  className="flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  data-testid="tab-distribution"
                >
                  <Rss className="w-4 h-4" />
                  Distribution
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Profile Tab - Cleaner Layout */}
            <TabsContent value="profile" className="space-y-4 min-w-0">
              {/* Guest Profile Section - shown when not signed in */}
              {!user && (
                <Card className="p-4 md:p-5" data-testid="card-guest-profile">
                  <div className="space-y-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 shrink-0">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold">Guest Profile</h3>
                        <p className="text-xs text-muted-foreground">
                          Your device identity for comments &amp; reactions
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 p-4 rounded-lg border border-border/50">
                      <Avatar className="h-14 w-14 border-2 border-primary/20 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                          {guestIdentity.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0 space-y-2">
                        <div>
                          <Label className="text-sm font-medium mb-1 block">Display Name</Label>
                          {editingGuestName ? (
                            <div className="flex gap-2">
                              <Input
                                value={guestNameDraft}
                                onChange={(e) => setGuestNameDraft(e.target.value)}
                                className="flex-1"
                                maxLength={50}
                                autoFocus
                                data-testid="input-settings-guest-name"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && guestNameDraft.trim()) {
                                    setGuestDisplayName(guestNameDraft.trim());
                                    setGuestIdentityState(getGuestIdentity());
                                    setEditingGuestName(false);
                                    toast({ title: "Name updated", description: "Your guest name has been saved." });
                                  } else if (e.key === 'Escape') {
                                    setEditingGuestName(false);
                                  }
                                }}
                              />
                              <Button
                                size="sm"
                                onClick={() => {
                                  if (guestNameDraft.trim()) {
                                    setGuestDisplayName(guestNameDraft.trim());
                                    setGuestIdentityState(getGuestIdentity());
                                    toast({ title: "Name updated", description: "Your guest name has been saved." });
                                  }
                                  setEditingGuestName(false);
                                }}
                                data-testid="button-save-guest-name"
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingGuestName(false)}
                                data-testid="button-cancel-guest-name-settings"
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium" data-testid="text-guest-display-name">
                                {guestIdentity.displayName}
                              </span>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => {
                                  setGuestNameDraft(guestIdentity.displayName);
                                  setEditingGuestName(true);
                                }}
                                data-testid="button-edit-guest-name-settings"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          This name is stored on your device and used for comments. Sign in to get a permanent account.
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {/* Authenticated Profile Section */}
              {user && <Card className="p-4 md:p-5" data-testid="card-profile-settings">
                <div className="space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 shrink-0">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold">Community Profile</h3>
                      <p className="text-xs text-muted-foreground">
                        How you appear to others
                      </p>
                    </div>
                  </div>
                  
                  {/* Avatar + Name in one row on larger screens */}
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Avatar Section */}
                    <div className="flex items-center gap-4 p-4 rounded-lg border border-border/50">
                      <div className="relative shrink-0">
                        <Avatar className="h-14 w-14 border-2 border-primary/20">
                          <AvatarImage 
                            src={avatarUrlDraft || profileSettings?.profileImageUrl || undefined} 
                            alt="Profile" 
                          />
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {profileSettings?.firstName?.[0] || profileSettings?.alias?.[0] || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        {uploadAvatarMutation.isPending && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full">
                            <Loader2 className="h-5 w-5 animate-spin text-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleFileSelect}
                          className="hidden"
                          data-testid="input-avatar-file"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadAvatarMutation.isPending}
                          className="gap-1.5"
                          data-testid="button-upload-avatar"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          Upload
                        </Button>
                        <p className="text-xs text-muted-foreground mt-1.5">
                          Max 5MB, auto-resized
                        </p>
                      </div>
                    </div>

                    {/* Alias Section */}
                    <div className="p-4 rounded-lg border border-border/50">
                      <Label htmlFor="alias" className="text-sm font-medium mb-2 block">
                        Display Name
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="alias"
                          placeholder="Your name..."
                          value={aliasDraft}
                          onChange={(e) => setAliasDraft(e.target.value)}
                          className="flex-1"
                          data-testid="input-alias"
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            updateProfileMutation.mutate({
                              alias: aliasDraft || undefined,
                            });
                          }}
                          disabled={updateProfileMutation.isPending || aliasDraft === (profileSettings?.alias || '')}
                          data-testid="button-save-profile"
                        >
                          {updateProfileMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Save"
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Appears on comments and public content
                      </p>
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="p-3 rounded-lg border border-dashed border-border/50 flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage 
                        src={avatarUrlDraft || profileSettings?.profileImageUrl || undefined} 
                        alt="Preview" 
                      />
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {aliasDraft?.[0] || profileSettings?.firstName?.[0] || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {aliasDraft || profileSettings?.firstName || 'Your Name'}
                      </p>
                      <p className="text-xs text-muted-foreground">Preview</p>
                    </div>
                  </div>
                </div>
              </Card>}
            </TabsContent>



            {/* Preferences Tab - Clean List Design */}
            <TabsContent value="preferences" className="space-y-4 min-w-0">
              <Card className="divide-y divide-border/50" data-testid="card-playback-preferences">
                {/* Header */}
                <div className="p-4 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0">
                    <Volume2 className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold">Playback</h3>
                    <p className="text-xs text-muted-foreground">Audio behavior settings</p>
                  </div>
                </div>
                
                {/* Settings List */}
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Bell className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Open player on complete</p>
                      <p className="text-xs text-muted-foreground truncate">Show player when done generating</p>
                    </div>
                  </div>
                  <Switch
                    checked={navigateOnComplete}
                    onCheckedChange={setNavigateOnComplete}
                    data-testid="switch-navigate-complete"
                  />
                </div>
                
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Volume2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Auto-play</p>
                      <p className="text-xs text-muted-foreground truncate">Play automatically when ready</p>
                    </div>
                  </div>
                  <Switch
                    checked={autoPlayEnabled}
                    onCheckedChange={setAutoPlayEnabled}
                    data-testid="switch-autoplay"
                  />
                </div>
                
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Bell className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Completion chime</p>
                      <p className="text-xs text-muted-foreground truncate">Play sound when brew finishes</p>
                    </div>
                  </div>
                  <Switch
                    checked={completionChime}
                    onCheckedChange={setCompletionChime}
                    data-testid="switch-completion-chime"
                  />
                </div>
              </Card>

              {/* Location Settings */}
              <Card className="divide-y divide-border/50" data-testid="card-location-settings">
                  {/* Header */}
                  <div className="p-4 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0">
                      <MapPin className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold">Location</h3>
                      <p className="text-xs text-muted-foreground">Local news, weather & events</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Enable location</p>
                        <p className="text-xs text-muted-foreground truncate">Include city in topics</p>
                      </div>
                    </div>
                    <Switch
                      checked={locationSettings?.locationEnabled ?? false}
                      onCheckedChange={(enabled) => updateLocationMutation.mutate({ locationEnabled: enabled })}
                      disabled={updateLocationMutation.isPending}
                      data-testid="switch-location-enabled"
                    />
                  </div>
                  
                  {locationSettings?.locationEnabled && (
                    <div className="p-4">
                      <Label htmlFor="location-city" className="text-sm font-medium mb-2 block">
                        Your City
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="location-city"
                          placeholder="San Francisco, CA"
                          value={locationCityDraft}
                          onChange={(e) => setLocationCityDraft(e.target.value)}
                          className="flex-1"
                          data-testid="input-location-city"
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            setLocationCity(locationCityDraft);
                            updateLocationMutation.mutate({ locationCity: locationCityDraft });
                          }}
                          disabled={updateLocationMutation.isPending || locationCityDraft === locationCity}
                          data-testid="button-save-location"
                        >
                          {updateLocationMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Save"
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
              </Card>

              {/* Legal Links Card */}
              <Card className="divide-y divide-border/50" data-testid="card-legal">
                {/* Header */}
                <div className="p-4 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0">
                    <Shield className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold">Legal</h3>
                    <p className="text-xs text-muted-foreground">Privacy & Terms</p>
                  </div>
                </div>
                
                <Link href="/privacy" data-testid="link-privacy-policy">
                  <div className="flex items-center justify-between p-4 hover-elevate cursor-pointer">
                    <div className="flex items-center gap-3 min-w-0">
                      <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Privacy Policy</p>
                        <p className="text-xs text-muted-foreground truncate">How we handle your data</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
                
                <Link href="/terms" data-testid="link-terms-of-service">
                  <div className="flex items-center justify-between p-4 hover-elevate cursor-pointer">
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Terms of Service</p>
                        <p className="text-xs text-muted-foreground truncate">Usage rules and policies</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              </Card>
            </TabsContent>

            {/* Distribution Tab */}
            <TabsContent value="distribution" className="space-y-4 min-w-0">
              <DistributionSettings />
            </TabsContent>
          </Tabs>

          <div className="text-center py-4" data-testid="text-app-version">
            <p className="text-xs text-muted-foreground">{getVersionString()}</p>
          </div>
        </div>
      </div>
    </>
  );
}
