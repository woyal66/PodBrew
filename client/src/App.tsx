import { Switch, Route, Redirect, useLocation } from "wouter";
import { useEffect, useState, lazy, Suspense } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AudioPlayerProvider, useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { AuthProvider } from "@/contexts/auth-context";
import { CurrencyProvider } from "@/contexts/currency-context";
import { GlobalBrewingProvider } from "@/contexts/GlobalBrewingContext";
import { BottomPlayer } from "@/components/bottom-player";
import { AppShell } from "@/layouts/AppShell";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Headphones } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { GeneratedPodcast } from "@shared/schema";

const Home = lazy(() => import("@/pages/home"));
const Admin = lazy(() => import("@/pages/admin"));
const Analytics = lazy(() => import("@/pages/analytics"));
const PodcastDetail = lazy(() => import("@/pages/podcast-detail"));
const PlaylistDetail = lazy(() => import("@/pages/playlist-detail"));
const Embed = lazy(() => import("@/pages/embed"));
const Pricing = lazy(() => import("@/pages/pricing"));
const Settings = lazy(() => import("@/pages/settings"));
const Voices = lazy(() => import("@/pages/voices"));
const NotFound = lazy(() => import("@/pages/not-found"));

const ListenHome = lazy(() => import("@/pages/listen/ListenHome"));
const LibraryPage = lazy(() => import("@/pages/listen/LibraryPage"));
const PrivacyPolicy = lazy(() => import("@/pages/privacy-policy"));
const TermsOfService = lazy(() => import("@/pages/terms-of-service"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function AuthCallback() {
  const [, navigate] = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      navigate(`/?auth_code=${encodeURIComponent(code)}`, { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  }, [navigate]);
  return <PageLoader />;
}

function MainAppRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/auth/callback" component={AuthCallback} />
        <Route path="/create/voices" component={Voices} />
        
        <Route path="/listen" component={ListenHome} />
        <Route path="/listen/explore">
          <Redirect to="/listen" />
        </Route>
        <Route path="/listen/library" component={LibraryPage} />
        <Route path="/listen/playlists" component={LibraryPage} />
        <Route path="/listen/voices" component={Voices} />
        
        <Route path="/admin" component={Admin} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/settings" component={Settings} />
        <Route path="/privacy" component={PrivacyPolicy} />
        <Route path="/terms" component={TermsOfService} />
        <Route path="/podcasts/:id" component={PodcastDetail} />
        <Route path="/podcast/:id" component={SharedPodcastRoute} />
        <Route path="/playlist/:id" component={PlaylistDetail} />
        
        <Route path="/library">
          <Redirect to="/listen/library" />
        </Route>
        <Route path="/voices">
          <Redirect to="/create/voices" />
        </Route>
        
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function SharedPodcastRoute({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  const { play } = useAudioPlayer();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const podcastId = params.id;
    if (!podcastId) {
      setLocation('/listen');
      return;
    }

    const fetchAndPlayPodcast = async () => {
      try {
        console.log('[SharedPodcastRoute] Fetching podcast:', podcastId);
        const response = await apiRequest("GET", `/api/podcasts/${podcastId}`);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Failed to fetch podcast`);
        }
        
        const podcast: GeneratedPodcast = await response.json();
        console.log('[SharedPodcastRoute] Playing:', podcast.title);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        play(podcast, true, true);
        
        setLocation('/listen');
        
        toast({
          title: "Now Playing",
          description: podcast.title || "Shared podcast",
        });
      } catch (error) {
        console.error('[SharedPodcastRoute] Failed to load:', error);
        toast({
          title: "Couldn't load podcast",
          description: "The shared podcast may have been deleted or is unavailable.",
          variant: "destructive",
        });
        setLocation('/listen');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAndPlayPodcast();
  }, [params.id, play, setLocation, toast]);

  if (isLoading) {
    return (
      <div 
        className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm"
        data-testid="shared-podcast-route-loading"
      >
        <div className="flex flex-col items-center gap-4 text-center p-6">
          <div className="relative">
            <div className="absolute inset-0 animate-ping">
              <Headphones className="h-12 w-12 text-primary/30" />
            </div>
            <Headphones className="h-12 w-12 text-primary" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Loading Shared Podcast</h3>
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" />
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function SharedPodcastHandler() {
  const [, setLocation] = useLocation();
  const { play } = useAudioPlayer();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingTitle, setLoadingTitle] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useState(window.location.search);

  // Listen for URL changes (popstate events and manual updates)
  useEffect(() => {
    const handleUrlChange = () => {
      setSearchParams(window.location.search);
    };
    
    window.addEventListener('popstate', handleUrlChange);
    
    // Check for changes periodically to catch programmatic updates
    const interval = setInterval(() => {
      if (window.location.search !== searchParams) {
        setSearchParams(window.location.search);
      }
    }, 100);
    
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      clearInterval(interval);
    };
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const podcastId = params.get('podcast');

    if (!podcastId || isLoading) return;

    setIsLoading(true);
    const requestedPodcastId = podcastId;

    const fetchAndPlayPodcast = async () => {
      try {
        console.log('[SharedPodcast] Fetching shared podcast:', requestedPodcastId);
        const response = await apiRequest("GET", `/api/podcasts/${requestedPodcastId}`);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Failed to fetch podcast`);
        }
        
        const podcast: GeneratedPodcast = await response.json();
        
        setLoadingTitle(podcast.title || 'Shared Podcast');
        console.log('[SharedPodcast] Playing:', podcast.title);
        
        // Small delay to ensure AudioPlayer is ready
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Play the podcast with autoplay enabled
        play(podcast, true, true);
        
        // Navigate to Discover tab so user sees the player in context
        setLocation('/listen');
        
        // Check if URL still has the same podcast ID before cleaning up
        // This prevents race conditions if a new shared link arrived during fetch
        const currentParams = new URLSearchParams(window.location.search);
        const currentPodcastId = currentParams.get('podcast');
        
        if (!currentPodcastId || currentPodcastId === requestedPodcastId) {
          currentParams.delete('podcast');
          const newUrl = `${window.location.pathname}${currentParams.toString() ? '?' + currentParams.toString() : ''}`;
          window.history.replaceState({}, '', newUrl);
          setSearchParams(window.location.search);
        } else {
          // A new podcast ID arrived, trigger re-process by updating state
          setSearchParams(window.location.search);
        }
        
        toast({
          title: "Now Playing",
          description: podcast.title || "Shared podcast",
        });
      } catch (error) {
        console.error('[SharedPodcast] Failed to load:', error);
        toast({
          title: "Couldn't load podcast",
          description: "The shared podcast may have been deleted or is unavailable.",
          variant: "destructive",
        });
        
        // Check if URL still has the same podcast ID before cleaning up
        const currentParams = new URLSearchParams(window.location.search);
        const currentPodcastId = currentParams.get('podcast');
        
        if (!currentPodcastId || currentPodcastId === requestedPodcastId) {
          currentParams.delete('podcast');
          const newUrl = `${window.location.pathname}${currentParams.toString() ? '?' + currentParams.toString() : ''}`;
          window.history.replaceState({}, '', newUrl);
          setSearchParams(window.location.search);
          setLocation('/listen');
        } else {
          // A new podcast ID arrived, trigger re-process by updating state
          setSearchParams(window.location.search);
        }
      } finally {
        setIsLoading(false);
        setLoadingTitle(null);
      }
    };

    fetchAndPlayPodcast();
  }, [searchParams, play, setLocation, toast, isLoading]);

  // Show loading overlay when fetching shared podcast
  if (isLoading) {
    return (
      <div 
        className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm"
        data-testid="shared-podcast-loading"
      >
        <div className="flex flex-col items-center gap-4 text-center p-6">
          <div className="relative">
            <div className="absolute inset-0 animate-ping">
              <Headphones className="h-12 w-12 text-primary/30" />
            </div>
            <Headphones className="h-12 w-12 text-primary" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Loading Shared Podcast</h3>
            {loadingTitle && (
              <p className="text-sm text-muted-foreground max-w-xs truncate">{loadingTitle}</p>
            )}
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" />
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function AppContent() {
  const [location] = useLocation();
  const isEmbedRoute = location.startsWith('/embed/');

  if (isEmbedRoute) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/embed/:id" component={Embed} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <ErrorBoundary>
      <GlobalBrewingProvider>
        <AudioPlayerProvider>
          <Toaster />
          <SharedPodcastHandler />
          <AppShell>
            <ErrorBoundary>
              <MainAppRouter />
            </ErrorBoundary>
          </AppShell>
          <BottomPlayer />
        </AudioPlayerProvider>
      </GlobalBrewingProvider>
    </ErrorBoundary>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CurrencyProvider>
          <TooltipProvider>
            <AppContent />
          </TooltipProvider>
        </CurrencyProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
