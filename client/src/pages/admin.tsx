import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Database, Lock, CheckCircle2, XCircle, Loader2, LogOut, Users, Search, AlertCircle, Trash2, BarChart2, Mic, Play, MessageSquare, ThumbsUp, UserCircle, TrendingUp, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Subscriber {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  subscriptionPlan: string;
  subscriptionStatus: string | null;
  credits: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

interface SubscriberStats {
  total: number;
  byPlan: {
    free: number;
    creator: number;
    studio: number;
    pro: number;
    professional: number;
    enterprise: number;
  };
  activeSubscriptions: number;
  totalCredits: number;
}

interface UsageStats {
  overview: {
    totalPodcasts: number;
    podcastsToday: number;
    podcastsThisWeek: number;
    podcastsThisMonth: number;
    uniqueGuestSessions: number;
    totalRegisteredUsers: number;
    totalUniqueCreators: number;
    totalPlays: number;
    totalComments: number;
    totalReactions: number;
    avgPodcastsPerCreator: number;
  };
  dailyCreation: { date: string; total: number; guests: number; registered: number }[];
  topCreators: { identifier: string; shortId: string; type: 'guest' | 'registered'; count: number; plays: number; lastCreated: string }[];
  byTemplate: { template: string; count: number }[];
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [subscriberStats, setSubscriberStats] = useState<SubscriberStats | null>(null);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);
  const [isLoadingSubscribers, setIsLoadingSubscribers] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [fixEmail, setFixEmail] = useState("");
  const [fixPlan, setFixPlan] = useState("creator");
  const [isFixing, setIsFixing] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [deleteUserEmail, setDeleteUserEmail] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password.trim()) {
      toast({
        title: "Password Required",
        description: "Please enter your admin password",
        variant: "destructive",
      });
      return;
    }

    setIsLoggingIn(true);

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (response.ok) {
        setSessionToken(data.sessionToken);
        setPassword("");
        toast({
          title: "Logged In",
          description: "Admin access granted",
        });
      } else {
        toast({
          title: "Login Failed",
          description: data.error || "Invalid password",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setSessionToken(null);
    setResult(null);
    setSubscribers([]);
    setSubscriberStats(null);
    toast({
      title: "Logged Out",
      description: "Admin session ended",
    });
  };

  const fetchSubscribers = async () => {
    if (!sessionToken) return;

    setIsLoadingSubscribers(true);
    try {
      const response = await fetch('/api/admin/subscribers', {
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
        },
      });

      const data = await response.json();

      if (response.ok) {
        setSubscribers(data.subscribers);
        setSubscriberStats(data.stats);
      } else {
        if (response.status === 401) {
          setSessionToken(null);
          toast({
            title: "Session Expired",
            description: "Please log in again",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Error",
            description: data.error || "Failed to fetch subscribers",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsLoadingSubscribers(false);
    }
  };

  const fetchUsageStats = async () => {
    if (!sessionToken) return;
    setIsLoadingUsage(true);
    try {
      const response = await fetch('/api/admin/usage-stats', {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
      });
      const data = await response.json();
      if (response.ok) {
        setUsageStats(data);
      } else if (response.status === 401) {
        setSessionToken(null);
      }
    } catch (error) {
      console.error('Failed to fetch usage stats:', error);
    } finally {
      setIsLoadingUsage(false);
    }
  };

  useEffect(() => {
    if (sessionToken) {
      fetchSubscribers();
      fetchUsageStats();
    }
  }, [sessionToken]);

  const seedDatabase = async (endpoint: string, title: string) => {
    if (!sessionToken) {
      toast({
        title: "Not Authenticated",
        description: "Please log in first",
        variant: "destructive",
      });
      return;
    }

    setIsSeeding(true);
    setResult(null);

    try {
      const response = await fetch(`/api/admin/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
      });

      const data = await response.json();

      if (response.ok) {
        setResult(data);
        toast({
          title: "Success!",
          description: data.message || `${title} completed successfully`,
        });
      } else {
        if (response.status === 401) {
          setSessionToken(null);
          toast({
            title: "Session Expired",
            description: "Please log in again",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Error",
            description: data.message || data.error || `Failed to ${title.toLowerCase()}`,
            variant: "destructive",
          });
        }
        setResult(data);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsSeeding(false);
    }
  };

  const fixSubscription = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fixEmail.trim()) {
      toast({
        title: "Email Required",
        description: "Please enter a user email",
        variant: "destructive",
      });
      return;
    }

    setIsFixing(true);
    setResult(null);

    try {
      const response = await fetch('/api/admin/fix-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ email: fixEmail.trim(), plan: fixPlan }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult(data);
        toast({
          title: "Success!",
          description: `Subscription updated for ${fixEmail}`,
        });
        setFixEmail("");
        fetchSubscribers(); // Refresh subscriber list
      } else {
        if (response.status === 401) {
          setSessionToken(null);
          toast({
            title: "Session Expired",
            description: "Please log in again",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Error",
            description: data.error || "Failed to fix subscription",
            variant: "destructive",
          });
        }
        setResult(data);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsFixing(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteUserId || !sessionToken) return;

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/admin/delete-user/${deleteUserId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
        },
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Account Deleted",
          description: `User account ${deleteUserEmail} has been permanently deleted.`,
        });
        fetchSubscribers(); // Refresh subscriber list
        setDeleteUserId(null);
        setDeleteUserEmail(null);
      } else {
        if (response.status === 401) {
          setSessionToken(null);
          toast({
            title: "Session Expired",
            description: "Please log in again",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Error",
            description: data.error || "Failed to delete user account",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // Show login form if not authenticated
  if (!sessionToken) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Admin Login
            </CardTitle>
            <CardDescription>
              Enter your admin password to access database seeding tools
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter ADMIN_PASSWORD"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="input-admin-password"
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isLoggingIn}
                data-testid="button-login"
              >
                {isLoggingIn ? (
                  <>
                    <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                    Logging in...
                  </>
                ) : (
                  'Login'
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Set ADMIN_PASSWORD in your Replit Secrets
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show admin dashboard if authenticated
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Database className="w-8 h-8" />
              Admin Dashboard
            </h1>
            <p className="text-muted-foreground">
              Manage your platform and monitor growth
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="mr-2 w-4 h-4" />
            Logout
          </Button>
        </div>

        <Tabs defaultValue="analytics">
          <TabsList className="w-full">
            <TabsTrigger value="analytics" className="flex-1 gap-2">
              <BarChart2 className="h-4 w-4" /> Usage Analytics
            </TabsTrigger>
            <TabsTrigger value="users" className="flex-1 gap-2">
              <Users className="h-4 w-4" /> Users
            </TabsTrigger>
            <TabsTrigger value="tools" className="flex-1 gap-2">
              <Database className="h-4 w-4" /> Tools
            </TabsTrigger>
          </TabsList>

          {/* ============ ANALYTICS TAB ============ */}
          <TabsContent value="analytics" className="space-y-6 pt-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Real-time usage data for all visitors and creators</p>
              <Button size="sm" variant="outline" onClick={fetchUsageStats} disabled={isLoadingUsage}>
                {isLoadingUsage ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
              </Button>
            </div>

            {isLoadingUsage && !usageStats ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : usageStats ? (
              <>
                {/* Overview KPIs */}
                <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                  <Card>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Mic className="h-3 w-3" /> Total Podcasts</div>
                      <p className="text-2xl font-bold">{usageStats.overview.totalPodcasts.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">+{usageStats.overview.podcastsToday} today</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><UserCircle className="h-3 w-3" /> Unique Creators</div>
                      <p className="text-2xl font-bold">{usageStats.overview.totalUniqueCreators.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{usageStats.overview.uniqueGuestSessions} guests · {usageStats.overview.totalRegisteredUsers} accounts</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Play className="h-3 w-3" /> Total Plays</div>
                      <p className="text-2xl font-bold">{usageStats.overview.totalPlays.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">avg {usageStats.overview.avgPodcastsPerCreator} per creator</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><MessageSquare className="h-3 w-3" /> Engagement</div>
                      <p className="text-2xl font-bold">{(usageStats.overview.totalComments + usageStats.overview.totalReactions).toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{usageStats.overview.totalComments} comments · {usageStats.overview.totalReactions} reactions</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Second row: this week / this month */}
                <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                  <Card>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Calendar className="h-3 w-3" /> This Week</div>
                      <p className="text-2xl font-bold text-primary">{usageStats.overview.podcastsThisWeek}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">podcasts created</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingUp className="h-3 w-3" /> This Month</div>
                      <p className="text-2xl font-bold text-primary">{usageStats.overview.podcastsThisMonth}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">podcasts created</p>
                    </CardContent>
                  </Card>
                  <Card className="col-span-2">
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><BarChart2 className="h-3 w-3" /> By Template</div>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {usageStats.byTemplate.slice(0, 6).map(t => (
                          <Badge key={t.template} variant="secondary" className="text-xs">
                            {t.template}: {t.count}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Daily creation chart */}
                {usageStats.dailyCreation.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Daily Podcast Creations (Last 30 Days)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={usageStats.dailyCreation} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip
                            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                            labelFormatter={(l) => `Date: ${l}`}
                          />
                          <Bar dataKey="guests" name="Guests" stackId="a" fill="hsl(var(--muted-foreground))" radius={[0, 0, 0, 0]} />
                          <Bar dataKey="registered" name="Registered" stackId="a" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="flex gap-4 justify-center mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-primary inline-block" /> Registered users</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-muted-foreground inline-block" /> Guest visitors</span>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Top creators */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Top Creators (by podcasts made)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b">
                          <tr>
                            <th className="text-left py-2 font-medium text-muted-foreground">#</th>
                            <th className="text-left py-2 font-medium text-muted-foreground">Creator</th>
                            <th className="text-left py-2 font-medium text-muted-foreground">Type</th>
                            <th className="text-right py-2 font-medium text-muted-foreground">Podcasts</th>
                            <th className="text-right py-2 font-medium text-muted-foreground">Plays</th>
                            <th className="text-right py-2 font-medium text-muted-foreground">Last Active</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usageStats.topCreators.map((c, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2 text-muted-foreground">{i + 1}</td>
                              <td className="py-2">
                                <span className="font-medium">{c.identifier}</span>
                                <span className="text-xs text-muted-foreground ml-1 font-mono">{c.shortId && `…${c.shortId}`}</span>
                              </td>
                              <td className="py-2">
                                <Badge variant={c.type === 'registered' ? 'default' : 'secondary'} className="text-xs">
                                  {c.type}
                                </Badge>
                              </td>
                              <td className="py-2 text-right font-bold">{c.count}</td>
                              <td className="py-2 text-right text-muted-foreground">{c.plays}</td>
                              <td className="py-2 text-right text-xs text-muted-foreground">
                                {c.lastCreated ? new Date(c.lastCreated).toLocaleDateString() : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : null}
          </TabsContent>

          {/* ============ USERS TAB ============ */}
          <TabsContent value="users" className="space-y-6 pt-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-xl flex items-center gap-2">
                      <Users className="w-5 h-5" /> Registered Users
                    </CardTitle>
                    <CardDescription>View all accounts and their subscription details</CardDescription>
                  </div>
                  <Button onClick={fetchSubscribers} disabled={isLoadingSubscribers} size="sm" data-testid="button-refresh-subscribers">
                    {isLoadingSubscribers ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Loading...</> : 'Refresh'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {subscriberStats && (
                  <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
                    <div className="p-3 rounded-lg bg-muted">
                      <p className="text-xs text-muted-foreground mb-1">Total Users</p>
                      <p className="text-2xl font-bold" data-testid="stat-total-users">{subscriberStats.total}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <p className="text-xs text-muted-foreground mb-1">Active Subs</p>
                      <p className="text-2xl font-bold text-green-500" data-testid="stat-active-subs">{subscriberStats.activeSubscriptions}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <p className="text-xs text-muted-foreground mb-1">Free Users</p>
                      <p className="text-2xl font-bold">{subscriberStats.byPlan.free}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <p className="text-xs text-muted-foreground mb-1">Paid Users</p>
                      <p className="text-2xl font-bold text-primary">
                        {subscriberStats.byPlan.creator + subscriberStats.byPlan.studio + subscriberStats.byPlan.pro + subscriberStats.byPlan.professional}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <p className="text-xs text-muted-foreground mb-1">Total Credits</p>
                      <p className="text-2xl font-bold">{subscriberStats.totalCredits.toLocaleString()}</p>
                    </div>
                  </div>
                )}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search by email or ID..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" data-testid="input-search-subscribers" />
                </div>
              </CardContent>
            </Card>

            {/* User table */}
            {isLoadingSubscribers ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : subscribers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No users found</div>
            ) : (
              <div className="rounded-lg border">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium">Email</th>
                        <th className="text-left p-3 font-medium">Plan</th>
                        <th className="text-left p-3 font-medium">Credits</th>
                        <th className="text-left p-3 font-medium">Status</th>
                        <th className="text-left p-3 font-medium">Joined</th>
                        <th className="text-left p-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subscribers
                        .filter(sub =>
                          !searchQuery ||
                          sub.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          sub.id.toLowerCase().includes(searchQuery.toLowerCase())
                        )
                        .map((sub, idx) => (
                          <tr key={sub.id} className="border-b last:border-0 hover-elevate" data-testid={`row-subscriber-${idx}`}>
                            <td className="p-3">
                              <div>
                                <p className="font-medium">{sub.email || 'No email'}</p>
                                <p className="text-xs text-muted-foreground">{sub.id}</p>
                              </div>
                            </td>
                            <td className="p-3">
                              <Badge variant={sub.subscriptionPlan === 'free' ? 'secondary' : 'default'} className="capitalize">
                                {sub.subscriptionPlan}
                              </Badge>
                            </td>
                            <td className="p-3 font-medium">{sub.credits?.toLocaleString() || 0}</td>
                            <td className="p-3">
                              {sub.subscriptionStatus === 'active' ? (
                                <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/30">Active</Badge>
                              ) : (
                                <Badge variant="secondary">Inactive</Badge>
                              )}
                            </td>
                            <td className="p-3 text-muted-foreground">{format(new Date(sub.createdAt), 'MMM d, yyyy')}</td>
                            <td className="p-3">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => { setDeleteUserId(sub.id); setDeleteUserEmail(sub.email || sub.id); }}
                                className="text-destructive"
                                data-testid={`button-delete-${idx}`}
                              >
                                <Trash2 className="w-4 h-4 mr-1" /> Remove
                              </Button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ============ TOOLS TAB ============ */}
          <TabsContent value="tools" className="space-y-6 pt-2">
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="hover-elevate">
                <CardHeader>
                  <CardTitle className="text-lg">Seed Voices</CardTitle>
                  <CardDescription>Populate database with 30 Gemini premium voices</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => seedDatabase('seed-voices', 'Voice Seeding')} disabled={isSeeding} className="w-full" data-testid="button-seed-voices">
                    {isSeeding ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Seeding...</> : 'Seed Voices'}
                  </Button>
                </CardContent>
              </Card>

              <Card className="hover-elevate">
                <CardHeader>
                  <CardTitle className="text-lg">Seed Prosody</CardTitle>
                  <CardDescription>Populate database with emotion-driven prosody presets</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => seedDatabase('seed-prosody', 'Prosody Seeding')} disabled={isSeeding} className="w-full" data-testid="button-seed-prosody">
                    {isSeeding ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Seeding...</> : 'Seed Prosody'}
                  </Button>
                </CardContent>
              </Card>

              <Card className="hover-elevate">
                <CardHeader>
                  <CardTitle className="text-lg">Seed All</CardTitle>
                  <CardDescription>Populate both voices and prosody presets</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => seedDatabase('seed-all', 'Full Database Seeding')} disabled={isSeeding} variant="default" className="w-full" data-testid="button-seed-all">
                    {isSeeding ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Seeding...</> : 'Seed All'}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Fix Subscription */}
            <Card className="border-yellow-500/30 bg-yellow-500/5">
              <CardHeader>
                <CardTitle className="text-xl flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-yellow-500" /> Fix User Subscription
                </CardTitle>
                <CardDescription>Manually update a user's subscription plan</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={fixSubscription} className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="fix-email">User Email</Label>
                      <Input id="fix-email" type="email" placeholder="user@example.com" value={fixEmail} onChange={(e) => setFixEmail(e.target.value)} data-testid="input-fix-email" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="fix-plan">Subscription Plan</Label>
                      <select id="fix-plan" value={fixPlan} onChange={(e) => setFixPlan(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" data-testid="select-fix-plan">
                        <option value="creator">Creator ($3.50/mo)</option>
                        <option value="studio">Studio ($10.95/mo)</option>
                        <option value="pro">Pro ($19.95/mo)</option>
                        <option value="professional">Professional ($29.95/mo)</option>
                      </select>
                    </div>
                  </div>
                  <Button type="submit" disabled={isFixing} className="w-full" data-testid="button-fix-subscription">
                    {isFixing ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Updating...</> : 'Fix Subscription'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {result && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {result.success ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <XCircle className="w-5 h-5 text-destructive" />}
                    Result
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Alert variant={result.success ? "default" : "destructive"}>
                    <AlertDescription>
                      <pre className="text-sm whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle>Instructions</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <ol className="list-decimal list-inside space-y-2">
                  <li>Set <code className="bg-muted px-1 py-0.5 rounded">ADMIN_PASSWORD</code> in Replit Secrets</li>
                  <li>Click "Seed All" to populate the production database with voices and prosody presets</li>
                  <li>Seeding is idempotent — it skips voices that already exist</li>
                  <li>Your session expires after 1 hour of inactivity</li>
                </ol>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete User Confirmation Dialog */}
      <AlertDialog open={!!deleteUserId} onOpenChange={(open) => !open && setDeleteUserId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              Delete User Account
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p className="font-semibold">
                Are you absolutely sure you want to delete this account?
              </p>
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                <p className="text-sm font-medium mb-1">Account to be deleted:</p>
                <p className="text-sm text-foreground font-mono">{deleteUserEmail}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-destructive">⚠️ This action cannot be undone.</p>
                <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                  <li>All user data will be permanently deleted</li>
                  <li>User podcasts and content will be removed</li>
                  <li>Subscription and billing data will be lost</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              disabled={isDeleting}
              data-testid="button-cancel-delete"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 w-4 h-4" />
                  Delete Account
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
