import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { 
  Sparkles, 
  Play, 
  ArrowRight, 
  Youtube, 
  FileText, 
  Newspaper, 
  Rss,
  Mic,
  Headphones,
  Brain,
  Zap,
  TrendingUp,
  Volume2,
  ChevronDown
} from "lucide-react";
import type { GeneratedPodcast } from "@shared/schema";

interface HeroSectionProps {
  onGetStarted: () => void;
}

export function HeroSection({ onGetStarted }: HeroSectionProps) {
  const [, setLocation] = useLocation();
  
  // Fetch trending podcasts for the preview section
  const { data: trendingPodcasts } = useQuery<GeneratedPodcast[]>({
    queryKey: ['/api/podcasts/trending'],
  });

  const handleExploreTrending = () => {
    setLocation('/listen');
  };

  return (
    <div className="relative mb-6 overflow-hidden">
      {/* Condensed Hero - Single View */}
      <div className="animated-gradient-hero rounded-2xl p-5 md:p-8 lg:p-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center">
          
          {/* Left Column: Headline, Subtext, CTAs - Takes 7 columns on desktop */}
          <div className="lg:col-span-7 text-center lg:text-left">
            {/* AI Platform Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30 mb-3 hero-badge-glow" data-testid="badge-ai-platform">
              <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
              <span className="text-xs font-semibold text-primary tracking-wide">AI Podcast Studio</span>
            </div>
            
            {/* Main Headline with Staggered Animation */}
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-[3.5rem] font-bold mb-3 font-display leading-[1.1] tracking-tight" data-testid="heading-hero">
              <span className="text-foreground hero-text-reveal" style={{ animationDelay: '0ms' }}>Turn </span>
              <span className="text-primary hero-text-reveal" style={{ animationDelay: '100ms' }}>Anything</span>
              <br className="hidden sm:block" />
              <span className="sm:hidden"> </span>
              <span className="text-foreground hero-text-reveal" style={{ animationDelay: '200ms' }}>Into </span>
              <span className="bg-gradient-to-r from-primary via-emerald-400 to-primary bg-clip-text text-transparent hero-text-reveal" style={{ animationDelay: '300ms' }}>Audio</span>
            </h1>
            
            {/* Subtext */}
            <p className="text-base md:text-lg text-muted-foreground max-w-lg mx-auto lg:mx-0 mb-5 hero-fade-in" style={{ animationDelay: '400ms' }} data-testid="text-hero-description">
              Ideas, documents, videos—transformed into studio-quality podcasts in minutes with AI voices that sound human.
            </p>

            {/* CTA Buttons - Large and Inviting */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start mb-6 hero-fade-in" style={{ animationDelay: '500ms' }}>
              <Button 
                onClick={onGetStarted}
                className="bg-primary text-primary-foreground gap-3 hero-cta-glow font-bold text-lg px-8 py-6 h-auto rounded-xl shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all"
                data-testid="button-start-free"
              >
                <Sparkles className="w-5 h-5" />
                Create a FREE Podcast
                <ArrowRight className="w-5 h-5" />
              </Button>
              <Button 
                onClick={handleExploreTrending}
                className="bg-primary text-primary-foreground gap-3 hero-cta-glow font-bold text-lg px-8 py-6 h-auto rounded-xl shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all"
                data-testid="button-explore-trending"
              >
                <Play className="w-5 h-5" />
                Explore Library
              </Button>
            </div>

            {/* Compact Feature Chips */}
            <div className="flex flex-wrap gap-2 justify-center lg:justify-start hero-fade-in" style={{ animationDelay: '600ms' }}>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card/60 border border-border/50 text-xs text-muted-foreground backdrop-blur-sm" data-testid="chip-feature-voices">
                <Mic className="w-3.5 h-3.5 text-primary" />
                <span>30+ Premium Voices</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card/60 border border-border/50 text-xs text-muted-foreground backdrop-blur-sm" data-testid="chip-feature-ai">
                <Brain className="w-3.5 h-3.5 text-primary" />
                <span>AI Research Assistant</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card/60 border border-border/50 text-xs text-muted-foreground backdrop-blur-sm" data-testid="chip-feature-speed">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <span>Minutes, Not Hours</span>
              </div>
            </div>

            {/* Quick Navigation Links */}
            <nav className="flex flex-wrap gap-2 justify-center lg:justify-start mt-5 hero-fade-in" style={{ animationDelay: '700ms' }} aria-label="Jump to sections" data-testid="nav-quick-links">
              {[
                { label: "Use Cases", href: "#use-cases" },
                { label: "Why PodBrew?", href: "#why-podbrew" },
                { label: "How It Works", href: "#how-it-works" },
                { label: "FAQ", href: "#faq" },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={(e) => {
                    e.preventDefault();
                    document.querySelector(link.href)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-xs font-medium text-primary backdrop-blur-sm hover-elevate transition-colors"
                  data-testid={`link-quick-${link.href.slice(1)}`}
                >
                  {link.label}
                  <ChevronDown className="w-3 h-3" />
                </a>
              ))}
            </nav>
          </div>

          {/* Right Column: Animated Pipeline - Takes 5 columns on desktop, hidden on mobile/tablet */}
          <div className="lg:col-span-5 hidden lg:block">
            <div className="relative h-[200px] lg:h-[240px]">
              {/* Pipeline Container with soft vignette */}
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary/5 via-transparent to-primary/10 border border-primary/10">
                
                {/* Input Sources - Left side */}
                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-2">
                  <div className="pipeline-source-compact">
                    <Youtube className="w-4 h-4 text-red-400" />
                  </div>
                  <div className="pipeline-source-compact" style={{ animationDelay: '0.2s' }}>
                    <FileText className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="pipeline-source-compact" style={{ animationDelay: '0.4s' }}>
                    <Newspaper className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="pipeline-source-compact" style={{ animationDelay: '0.6s' }}>
                    <Rss className="w-4 h-4 text-orange-400" />
                  </div>
                </div>

                {/* Flow Lines SVG */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid meet">
                  <defs>
                    <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
                      <stop offset="50%" stopColor="hsl(var(--primary))" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
                    </linearGradient>
                  </defs>
                  <path className="flow-path flow-path-1" d="M 50 55 Q 100 55 150 100" stroke="url(#flowGradient)" strokeWidth="1.5" fill="none" />
                  <path className="flow-path flow-path-2" d="M 50 80 Q 95 80 150 100" stroke="url(#flowGradient)" strokeWidth="1.5" fill="none" />
                  <path className="flow-path flow-path-3" d="M 50 120 Q 95 120 150 100" stroke="url(#flowGradient)" strokeWidth="1.5" fill="none" />
                  <path className="flow-path flow-path-4" d="M 50 145 Q 100 145 150 100" stroke="url(#flowGradient)" strokeWidth="1.5" fill="none" />
                  <path className="flow-path flow-path-out" d="M 150 100 Q 200 100 250 100" stroke="url(#flowGradient)" strokeWidth="1.5" fill="none" />
                </svg>

                {/* AI Processing Center */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 flex items-center justify-center ai-processor-glow">
                    <Brain className="w-7 h-7 text-primary ai-brain-pulse" />
                  </div>
                </div>

                {/* Output - Right side */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-primary/10 to-primary/20 border border-primary/30">
                    <Headphones className="w-5 h-5 text-primary" />
                    <div className="flex items-end gap-0.5 h-5">
                      <span className="w-1 bg-primary rounded-full wave-bar-compact" style={{ height: '40%', animationDelay: '0s' }}></span>
                      <span className="w-1 bg-primary rounded-full wave-bar-compact" style={{ height: '70%', animationDelay: '0.1s' }}></span>
                      <span className="w-1 bg-primary rounded-full wave-bar-compact" style={{ height: '50%', animationDelay: '0.2s' }}></span>
                      <span className="w-1 bg-primary rounded-full wave-bar-compact" style={{ height: '80%', animationDelay: '0.3s' }}></span>
                      <span className="w-1 bg-primary rounded-full wave-bar-compact" style={{ height: '60%', animationDelay: '0.4s' }}></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trending Teaser - Compact 2-tile carousel */}
      <div className="mt-4 rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Trending Now</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">• Free to listen</span>
          </div>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={handleExploreTrending}
            className="text-xs text-primary hover:text-primary gap-1 h-7 px-2"
            data-testid="button-see-all-trending"
          >
            See All
            <ArrowRight className="w-3 h-3" />
          </Button>
        </div>

        {/* Horizontal Scroll Tiles */}
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
          {(trendingPodcasts?.slice(0, 4) || []).map((podcast, index) => (
            <div 
              key={podcast.id}
              className="group flex-shrink-0 w-[140px] sm:w-[160px] rounded-lg overflow-hidden bg-card border border-border/50 hover-elevate active:scale-[0.98] cursor-pointer transition-transform"
              onClick={() => setLocation(`/podcasts/${podcast.id}`)}
              data-testid={`card-trending-teaser-${index}`}
            >
              <div className="aspect-square relative">
                {podcast.coverImageUrl ? (
                  <img 
                    src={podcast.coverImageUrl} 
                    alt={podcast.title ? `AI-generated podcast: ${podcast.title}` : 'AI podcast cover art'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                    <Volume2 className="w-8 h-8 text-primary/40" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <div className="w-10 h-10 rounded-full bg-primary/90 flex items-center justify-center">
                    <Play className="w-5 h-5 text-primary-foreground ml-0.5" />
                  </div>
                </div>
              </div>
              <div className="p-2">
                <p className="text-xs font-medium truncate">{podcast.title}</p>
                <p className="text-[10px] text-muted-foreground truncate">{podcast.templateCategory || 'Podcast'}</p>
              </div>
            </div>
          ))}
          
          {/* Placeholder if loading */}
          {(!trendingPodcasts || trendingPodcasts.length === 0) && 
            Array.from({ length: 4 }).map((_, i) => (
              <div 
                key={`placeholder-${i}`}
                className="flex-shrink-0 w-[140px] sm:w-[160px] rounded-lg overflow-hidden bg-card/50 border border-dashed border-border/30 animate-pulse"
              >
                <div className="aspect-square bg-muted/10"></div>
                <div className="p-2 space-y-1">
                  <div className="h-3 bg-muted/20 rounded w-3/4"></div>
                  <div className="h-2 bg-muted/10 rounded w-1/2"></div>
                </div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}
