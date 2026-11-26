import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Helmet } from "react-helmet";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { PodcastGenerator } from "@/components/podcast-generator";
import { PodcastGallery } from "@/components/podcast-gallery";
import { PodcastLibraryDock } from "@/components/podcast-library-dock";
import { TemplatePicker } from "@/components/template-picker";
import { MorningBriefWidget } from "@/components/MorningBriefWidget";
import { SEOLandingSections } from "@/components/seo-landing-sections";
import { DeepDiveForm } from "@/components/forms/DeepDiveForm";
import { useToast } from "@/hooks/use-toast";
import type { TemplateCategory } from "@shared/schema";

const TAGLINES = [
  "Do you create the podcast, or does the podcast create you?",
  "The stories you imagine — imagining you back.",
  "You think it. The voice begins to speak.",
  "Between silence and thought, your story takes form.",
  "A voice born from your imagination.",
  "You start the story. It finishes you.",
  "Podcasts that dream of their creators.",
  "Every voice is a reflection of your mind.",
  "You whisper the idea — it becomes a world.",
  "Not just a podcast. A mirror of thought.",
  "Where ideas learn to speak.",
  "Dreams that talk back.",
  "Voices shaped by imagination.",
  "From thought to sound — instantly.",
  "The echo of your imagination.",
];

const ALL_VALID_TEMPLATES: TemplateCategory[] = ['custom', 'news', 'documents', 'sports', 'teachme', 'events', 'stories', 'medical', 'deepdive'];

export default function Home() {
  const [tagline, setTagline] = useState("");
  const [location, setLocation] = useLocation();
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateCategory>('custom');
  const [regenerateParams, setRegenerateParams] = useState<any>(null);
  const [searchParams, setSearchParams] = useState(window.location.search);
  const generatorRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data: features } = useQuery<{ deepDiveAvailable: boolean }>({
    queryKey: ['/api/features'],
    staleTime: 60_000,
  });

  // Hide the Deep Dive chip entirely until the feature is confirmed available.
  // While loading (features undefined) we also hide it to avoid a flash.
  const hiddenTemplates: TemplateCategory[] = features?.deepDiveAvailable ? [] : ['deepdive'];

  // Handle Stripe checkout success/cancel
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get('checkout');
    
    if (checkoutStatus === 'success') {
      // Force refresh user data from database to show updated subscription
      queryClient.invalidateQueries({ queryKey: ['/api/user/credits'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      
      toast({
        title: "Subscription Activated!",
        description: "Your subscription has been activated. Thank you for subscribing to PodBrew!",
      });
      // Clean up URL
      params.delete('checkout');
      const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
      window.history.replaceState({}, '', newUrl);
    } else if (checkoutStatus === 'canceled') {
      toast({
        title: "Checkout Canceled",
        description: "Your subscription checkout was canceled. You can try again anytime.",
        variant: "destructive",
      });
      // Clean up URL
      params.delete('checkout');
      const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
      window.history.replaceState({}, '', newUrl);
    }
  }, [toast]);

  // Watch for URL search parameter changes
  useEffect(() => {
    const handleUrlChange = () => {
      setSearchParams(window.location.search);
    };
    
    // Listen for popstate (browser back/forward)
    window.addEventListener('popstate', handleUrlChange);
    
    // Also check on location changes
    handleUrlChange();
    
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
    };
  }, [location]);

  // Listen for in-app regeneration events (when already on home page)
  useEffect(() => {
    const handleRegenerate = () => {
      const regenerateData = localStorage.getItem('podbrewRegenerateParams');
      if (regenerateData) {
        try {
          const params = JSON.parse(regenerateData);
          const templateCategory = params.templateCategory || 'custom';
          
          if (ALL_VALID_TEMPLATES.includes(templateCategory)) {
            setSelectedTemplate(templateCategory);
            setRegenerateParams(params);
            localStorage.setItem('selectedTemplate', templateCategory);
            localStorage.removeItem('podbrewRegenerateParams');
            // Scroll to the creator section
            setTimeout(() => {
              document.getElementById("creator")?.scrollIntoView({ behavior: "smooth" });
            }, 100);
          }
        } catch (e) {
          console.error('Failed to parse regenerate params:', e);
          localStorage.removeItem('podbrewRegenerateParams');
        }
      }
    };

    window.addEventListener('podbrew-regenerate', handleRegenerate);
    return () => {
      window.removeEventListener('podbrew-regenerate', handleRegenerate);
    };
  }, []);


  // Initialize template from URL query or localStorage
  useEffect(() => {
    const randomTagline = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
    setTagline(randomTagline);

    // Check for regenerate params first
    const regenerateData = localStorage.getItem('podbrewRegenerateParams');
    if (regenerateData) {
      try {
        const params = JSON.parse(regenerateData);
        const templateCategory = params.templateCategory || 'custom';
        
        if (ALL_VALID_TEMPLATES.includes(templateCategory)) {
          setSelectedTemplate(templateCategory);
          setRegenerateParams(params);
          localStorage.setItem('selectedTemplate', templateCategory);
          // Clear regenerate params after loading
          localStorage.removeItem('podbrewRegenerateParams');
          // Scroll to the creator section after a brief delay for DOM update
          setTimeout(() => {
            document.getElementById("creator")?.scrollIntoView({ behavior: "smooth" });
          }, 100);
          return; // Skip other initialization if we're regenerating
        }
      } catch (e) {
        console.error('Failed to parse regenerate params:', e);
        localStorage.removeItem('podbrewRegenerateParams');
      }
    }

    // Check URL query
    const params = new URLSearchParams(window.location.search);
    const templateFromQuery = params.get('template') as TemplateCategory | null;
    const topicFromQuery = params.get('topic');

    if (templateFromQuery && ALL_VALID_TEMPLATES.includes(templateFromQuery as TemplateCategory)) {
      setSelectedTemplate(templateFromQuery as TemplateCategory);
      localStorage.setItem('selectedTemplate', templateFromQuery);
    } else {
      // Fallback to localStorage
      const savedTemplate = localStorage.getItem('selectedTemplate') as TemplateCategory | null;
      if (savedTemplate && ALL_VALID_TEMPLATES.includes(savedTemplate)) {
        setSelectedTemplate(savedTemplate);
      }
    }

    // Handle topic from URL (from Discover page trending topics and regeneration)
    if (topicFromQuery) {
      // Use regenerateParams format (same as regeneration flow)
      const durationMinutes = params.get('durationMinutes');
      const numPeople = params.get('numPeople');
      const podcastStyle = params.get('podcastStyle');
      const coHostPersonality = params.get('coHostPersonality');
      const podcastMood = params.get('podcastMood');
      const languageComplexity = params.get('languageComplexity');
      const timeFrame = params.get('timeFrame');
      const language = params.get('language');
      
      // Create regenerateParams object (works for all template forms)
      // Scroll will be handled automatically by the regenerateParams useEffect
      setRegenerateParams({
        topic: topicFromQuery,
        templateCategory: templateFromQuery || 'news',
        durationMinutes: durationMinutes ? parseInt(durationMinutes) : 2,
        numPeople: numPeople ? parseInt(numPeople) : 1,
        podcastStyle: podcastStyle || 'news',
        coHostPersonality: coHostPersonality || 'executive',
        podcastMood: podcastMood || 'serious',
        languageComplexity: languageComplexity ? parseInt(languageComplexity) : 5,
        timeFrame: timeFrame || 'past24h',
        language: language || 'en',
      });
    }
  }, [searchParams]);

  const handleTemplateSelect = (template: TemplateCategory) => {
    setSelectedTemplate(template);
    localStorage.setItem('selectedTemplate', template);
    
    // Update URL query
    const params = new URLSearchParams(window.location.search);
    params.set('template', template);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  };

  const scrollToCreator = () => {
    document.getElementById("creator")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 via-background to-background pb-32 md:pb-8">
      <Helmet>
        <title>PodBrew – AI Custom Podcast Generator | Free to Start</title>
        <meta name="description" content="Create AI custom podcasts on any topic in minutes. Blogs, PDFs, YouTube links — studio-quality audio with 30+ AI voices and 80+ languages. Free to start." />
        <link rel="canonical" href="https://podbrew.pro/" />
        <meta property="og:title" content="PodBrew – Create AI Custom Podcasts in Minutes" />
        <meta property="og:description" content="Create AI custom podcasts on any topic in minutes. Blogs, PDFs, YouTube links, or just a topic — PodBrew turns it into studio-quality audio. 30+ voices, 80+ languages. Free to start." />
        <meta property="og:url" content="https://podbrew.pro/" />
        <meta name="twitter:title" content="PodBrew – Create AI Custom Podcasts in Minutes" />
        <meta name="twitter:description" content="Create AI custom podcasts on any topic. Blogs, PDFs, YouTube, or just a subject — studio-quality audio in minutes. 30+ voices. Free to start." />
      </Helmet>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(29,185,84,0.15),transparent_50%)] pointer-events-none" />
      {/* Main Content */}
      <main className="relative z-10 mx-auto px-4 sm:px-6 lg:px-8 pt-4 md:pt-8 w-full min-w-0">
        {/* Template Picker */}
        <div className="mb-4">
          <TemplatePicker
            selectedTemplate={selectedTemplate}
            onSelectTemplate={handleTemplateSelect}
            hiddenTemplates={hiddenTemplates}
          />
        </div>

        {/* Split-View Layout: Creator (left) + Daily Brief & Library Dock (right) on xl+ desktop */}
        <div className="xl:flex xl:gap-6 xl:items-start">
          {/* Left Column: Creation Section - auto-fills available space */}
          <div className="mb-8 xl:mb-0 xl:flex-1 min-w-0" id="creator" ref={generatorRef}>
            <div className="w-full min-w-0">
              <div className="mb-4">
                <h1 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-1.5" data-testid="heading-ai-custom-podcast">
                  AI Custom Podcast Generator
                </h1>
                <p 
                  key={tagline}
                  className="text-lg sm:text-2xl font-bold neon-write-reveal neon-cursive tracking-tight text-[#1cd65e]" 
                  data-testid="text-tagline-description"
                >
                  {tagline}
                </p>
              </div>

              {/* Mobile Daily Brief Widget - desktop card only, edge tab is global in AppShell */}
              <div className="xl:hidden mb-4">
                <MorningBriefWidget 
                  hideEdgeTab
                  onNavigateToNews={() => {
                    setSelectedTemplate('news');
                    scrollToCreator();
                  }} 
                />
              </div>

              {selectedTemplate === 'deepdive' ? (
                <DeepDiveForm />
              ) : (
                <PodcastGenerator 
                  selectedTemplate={selectedTemplate}
                  regenerateParams={regenerateParams}
                  onRegenerateUsed={() => setRegenerateParams(null)}
                />
              )}
            </div>
          </div>

          {/* Right Column: Daily Brief (top-locked) + Library Dock (scrollable) - xl+ desktop only (1280px+) */}
          <div className="hidden xl:flex xl:flex-col xl:sticky xl:top-4 xl:flex-shrink-0 w-80 gap-4 h-[calc(100vh-100px)]">
            <div className="flex-shrink-0">
              <MorningBriefWidget 
                hideEdgeTab
                onNavigateToNews={() => {
                  setSelectedTemplate('news');
                  scrollToCreator();
                }} 
              />
            </div>
            {/* Library Dock - Scrolls independently */}
            <div className="flex-1 min-h-0 flex flex-col">
              <PodcastLibraryDock />
            </div>
          </div>
        </div>

        {/* Gallery Section - Shown on sm/md/lg screens (hidden on mobile and xl+ desktop with dock) */}
        <div className="hidden sm:block xl:hidden mt-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold font-display">Your Library</h2>
          </div>
          <PodcastGallery />
        </div>

        {/* SEO Landing Sections — keyword-rich content for search engines and users */}
        <SEOLandingSections onCreateClick={scrollToCreator} />
      </main>
    </div>
  );
}
