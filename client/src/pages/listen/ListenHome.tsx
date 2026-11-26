import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import { Link } from "wouter";
import {
  ChevronRight,
  TrendingUp,
  Clock,
  Sparkles,
  Flame,
  Search,
  Filter,
  Users,
  Loader2,
  // Icons used by TEMPLATE_CATEGORIES below — names match the `icon`
  // strings in shared/schema.ts so the chip row can render the same
  // glyphs used in the brew template picker.
  Mic,
  GraduationCap,
  Newspaper,
  FileText,
  Trophy,
  Calendar,
  BookOpen,
  Stethoscope,
  BrainCircuit,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PodcastCard } from "@/components/podcast-card";
import { TrendingTopicsPanel } from "@/components/TrendingTopicsPanel";
import {
  TEMPLATE_CATEGORIES,
  type GeneratedPodcast,
  type EnrichedPodcast,
  type PodcastEngagement,
  type PodcastLike,
  type PodcastTopComment,
  type TemplateCategory,
} from "@shared/schema";

// Schema-derived icon union — adding a new template icon name forces
// a TS error here until the map is updated.
type TemplateIconName =
  (typeof TEMPLATE_CATEGORIES)[keyof typeof TEMPLATE_CATEGORIES]["icon"];

const TEMPLATE_ICON_MAP: Record<TemplateIconName, LucideIcon> = {
  Mic,
  GraduationCap,
  Newspaper,
  FileText,
  Trophy,
  Calendar,
  BookOpen,
  Stethoscope,
  BrainCircuit,
};

type CategoryChipValue = "all" | TemplateCategory;

interface CategoryChip {
  label: string;
  value: CategoryChipValue;
  Icon: LucideIcon | null;
}

/**
 * Discover filter chip row with scroll-state-aware edge fades. Fades
 * only appear when there's overflowed content in that direction, and
 * a ResizeObserver keeps the state accurate across viewport changes.
 */
function CategoryChipRow({
  categories,
  selectedCategory,
  onSelect,
}: {
  categories: ReadonlyArray<CategoryChip>;
  selectedCategory: string;
  onSelect: (value: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setShowLeftFade(!atStart);
    setShowRightFade(!atEnd);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    recompute();
    el.addEventListener("scroll", recompute, { passive: true });
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", recompute);
      ro.disconnect();
    };
  }, [recompute, categories.length]);

  return (
    <div className="relative w-full max-w-full">
      <div
        ref={scrollRef}
        className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4"
        data-testid="scroll-category-chips"
      >
        {categories.map((cat) => {
          const Icon = cat.Icon;
          const isActive = selectedCategory === cat.value;
          return (
            <Button
              key={cat.value}
              variant={isActive ? "default" : "outline"}
              size="sm"
              className={`shrink-0 gap-1.5 transition-all ${
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : ""
              }`}
              onClick={() => onSelect(cat.value)}
              data-testid={`chip-category-${cat.value}`}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              <span>{cat.label}</span>
            </Button>
          );
        })}
      </div>
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent transition-opacity duration-150 ${
          showLeftFade ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent transition-opacity duration-150 ${
          showRightFade ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}

function PodcastCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col md:flex-row md:gap-4 md:p-4">
        <Skeleton className="w-full md:w-44 aspect-[8/3] md:aspect-square flex-shrink-0 md:rounded-xl" />
        <div className="flex-1 flex flex-col justify-between min-w-0 p-3 md:p-0 space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex gap-1 mt-2">
            <Skeleton className="h-11 w-11 rounded-md" />
            <Skeleton className="h-11 w-11 rounded-md" />
            <Skeleton className="h-11 w-11 rounded-md" />
          </div>
        </div>
      </div>
    </Card>
  );
}

function HorizontalSection({ 
  title, 
  subtitle,
  icon: Icon, 
  podcasts, 
  isLoading, 
  viewAllPath,
  emptyMessage,
  showCount = 4,
  enrichmentPending = false,
  enablePriority = false,
}: { 
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  podcasts: EnrichedPodcast[];
  isLoading: boolean;
  viewAllPath?: string;
  emptyMessage?: string;
  showCount?: number;
  enrichmentPending?: boolean;
  /**
   * When true, the very first card in this section gets the
   * `fetchpriority="high"` Priority Hint as the LCP candidate. Tiles
   * still keep `loading="lazy"` — Priority Hints layer on top of lazy
   * loading. Only one section on the page should set this to true.
   * (Task #102 polish.)
   */
  enablePriority?: boolean;
}) {
  if (!isLoading && podcasts.length === 0 && emptyMessage) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            <h2 className="text-lg md:text-xl font-semibold" data-testid={`section-title-${title.toLowerCase().replace(/\s/g, '-')}`}>
              {title}
            </h2>
          </div>
          {subtitle && (
            <p className="text-sm text-muted-foreground pl-7">{subtitle}</p>
          )}
        </div>
        {viewAllPath && podcasts.length > 0 && (
          <Button 
            variant="ghost" 
            size="sm" 
            asChild 
            className="text-muted-foreground min-h-[44px] min-w-[44px]"
          >
            <Link href={viewAllPath} data-testid={`link-view-all-${title.toLowerCase().replace(/\s/g, '-')}`}>
              View all
              <ChevronRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        )}
      </div>
      
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
          {Array.from({ length: Math.min(showCount, 4) }).map((_, i) => (
            <PodcastCardSkeleton key={i} />
          ))}
        </div>
      ) : podcasts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
          {podcasts.slice(0, showCount).map((podcast, index) => (
            <PodcastCard
              key={podcast.id}
              podcast={podcast}
              enrichmentPending={enrichmentPending}
              priority={enablePriority && index === 0}
            />
          ))}
        </div>
      ) : emptyMessage ? (
        <div className="py-8 text-center text-muted-foreground">
          <p>{emptyMessage}</p>
        </div>
      ) : null}
    </section>
  );
}

export default function ListenHome() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  // Enrichment phase-2 state
  const [enrichmentMap, setEnrichmentMap] = useState<Map<string, { engagement: PodcastEngagement | null; topComment: PodcastTopComment; userLike: PodcastLike | null }>>(new Map());
  const [enrichmentPending, setEnrichmentPending] = useState(false);
  const enrichedIdsRef = useRef<string>("");
  
  const { data: trendingPodcasts = [], isLoading: isLoadingTrending } = useQuery<GeneratedPodcast[]>({
    queryKey: ["/api/podcasts/trending"],
    queryFn: async () => {
      const res = await fetch("/api/podcasts/trending?limit=20&slim=1", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch trending podcasts");
      return res.json();
    },
    staleTime: 60000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
  
  const [publicPages, setPublicPages] = useState<GeneratedPodcast[][]>([]);
  const [publicTotal, setPublicTotal] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const PUBLIC_PAGE_SIZE = 30;

  // Reset paginated pages whenever sort changes so stale off-page results don't mix in
  const prevSortByRef = useRef(sortBy);
  useEffect(() => {
    if (prevSortByRef.current !== sortBy) {
      prevSortByRef.current = sortBy;
      setPublicPages([]);
    }
  }, [sortBy]);

  // Above-fold query: fetches just 3 items in parallel with the full 30-item page.
  // Wins the network race (less DB work, smaller payload) so Fresh Releases section
  // can show real cards almost immediately while the larger request is still in flight.
  const { data: aboveFoldPage } = useQuery<{ podcasts: GeneratedPodcast[]; total: number }>({
    queryKey: ["/api/podcasts/public", sortBy, "above-fold"],
    queryFn: async () => {
      const res = await fetch(`/api/podcasts/public?limit=3&offset=0&slim=1&sortBy=${sortBy}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch above-fold podcasts");
      return res.json();
    },
    // Task #102: 5-minute stale window for tile lists so re-entering
    // Discover from another tab doesn't re-pull the same payload. New
    // brews are surfaced via explicit cache invalidation in the brew
    // pipeline, not by treating list queries as always-fresh.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  const { data: publicFirstPage, isLoading: isLoadingPublic } = useQuery<{ podcasts: GeneratedPodcast[]; total: number }>({
    queryKey: ["/api/podcasts/public", sortBy],
    queryFn: async () => {
      const res = await fetch(`/api/podcasts/public?limit=${PUBLIC_PAGE_SIZE}&offset=0&slim=1&sortBy=${sortBy}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch public podcasts");
      return res.json();
    },
    // Task #102: same 5-minute stale window as the above-fold query so
    // both pieces of the Discover grid honor the same contract.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  // Fresh Releases: always-newest top-4, independent of the user's sort
  // selection. This guarantees the rail shows the literal latest 4 brewed
  // even when the page is sorted by Trending or Popular, and survives the
  // dedupe pipeline (it's pinned first).
  const { data: freshReleasesData, isLoading: isLoadingFreshReleases } = useQuery<{ podcasts: GeneratedPodcast[]; total: number }>({
    queryKey: ["/api/podcasts/public", "fresh-releases", "newest", 4],
    queryFn: async () => {
      const res = await fetch(`/api/podcasts/public?limit=4&offset=0&slim=1&sortBy=newest`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch fresh releases");
      return res.json();
    },
    // Task #102: bring Fresh Releases under the same 5-minute stale
    // contract. Newly-brewed podcasts still appear immediately because
    // the brew pipeline invalidates the public-list query keys on
    // success — we just don't pay for blind refetches on tab switches.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });
  const freshReleasesPodcasts = useMemo(
    () => freshReleasesData?.podcasts ?? [],
    [freshReleasesData]
  );

  // Note: extra loaded pages are intentionally kept across first-page refreshes
  // (including the 60s newest auto-refresh) so users don't lose their scroll position.
  // Pages are only cleared when the sort mode actually changes (handled by prevSortByRef above).

  const publicPodcasts = useMemo(() => {
    // Prefer the full first page when available; fall back to the 3-item above-fold
    // preview so sections can render real cards while the larger request is in flight.
    const firstPage = publicFirstPage?.podcasts ?? aboveFoldPage?.podcasts ?? [];
    return [...firstPage, ...publicPages.flat()];
  }, [publicFirstPage, aboveFoldPage, publicPages]);

  // Show skeletons only when neither the full page nor the fast above-fold preview
  // has arrived yet — as soon as either resolves, swap skeletons for real cards.
  const isLoadingPublicDisplay = isLoadingPublic && !aboveFoldPage;

  const totalPublic = publicFirstPage?.total ?? publicTotal;
  const hasMorePublicPodcasts = publicPodcasts.length < totalPublic;

  // Phase-2: batch-enrich all slim podcast IDs once core data is available
  const guestId = useMemo(() => {
    try { return localStorage.getItem('podbrew_guest_session_token') || undefined; } catch { return undefined; }
  }, []);

  useEffect(() => {
    const allPodcasts = [...trendingPodcasts, ...publicPodcasts, ...freshReleasesPodcasts];
    const allIds = allPodcasts.map(p => p.id);
    // Deduplicate
    const seenSet: Record<string, boolean> = {};
    const uniqueIds = allIds.filter(id => { if (seenSet[id]) return false; seenSet[id] = true; return true; });
    if (uniqueIds.length === 0) return;

    // Key to avoid duplicate fetches for the same ID set
    const idsKey = uniqueIds.slice().sort().join(',');
    if (idsKey === enrichedIdsRef.current) return;
    enrichedIdsRef.current = idsKey;

    // Pre-seed enrichmentMap from inline _engagement already included in slim responses.
    // IDs that already have engagement counts skip waiting for the batch POST result for
    // that field — the map entry is available immediately so counts render right away.
    setEnrichmentMap(prev => {
      const next = new Map(prev);
      let added = false;
      for (const podcast of allPodcasts) {
        const ep = podcast as EnrichedPodcast;
        if (ep._engagement && !next.has(podcast.id)) {
          next.set(podcast.id, { engagement: ep._engagement, topComment: null, userLike: null });
          added = true;
        }
      }
      return added ? next : prev;
    });

    // Determine which IDs still need engagement from DB vs. already have it inline.
    // IDs with inline _engagement are excluded from engagementIds so the server
    // skips getBatchEngagement for them. topComment/userLike are still fetched for all.
    const podcastById = new Map(allPodcasts.map(p => [p.id, p as EnrichedPodcast]));
    const needsEngagement = new Set(
      uniqueIds.filter(id => !podcastById.get(id)?._engagement)
    );

    // Batch in chunks of 100 — still POST all IDs to fetch topComment + userLike
    const chunks: string[][] = [];
    for (let i = 0; i < uniqueIds.length; i += 100) {
      chunks.push(uniqueIds.slice(i, i + 100));
    }

    setEnrichmentPending(true);
    Promise.all(
      chunks.map(chunk => {
        const chunkEngagementIds = chunk.filter(id => needsEngagement.has(id));
        return fetch('/api/podcasts/batch-enrichment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ podcastIds: chunk, engagementIds: chunkEngagementIds, guestId }),
        }).then(r => r.ok ? r.json() : { enrichments: {} });
      })
    ).then(results => {
      type BatchEnrichmentResponse = { enrichments: Record<string, { engagement: PodcastEngagement | null; topComment: PodcastTopComment; userLike: PodcastLike | null }> };
      // Use functional updater to merge onto the latest map (which may include pre-seeds).
      // Preserve pre-seeded engagement if the batch response returns null for a given ID.
      setEnrichmentMap(prev => {
        const next = new Map(prev);
        for (const result of results as BatchEnrichmentResponse[]) {
          for (const [id, data] of Object.entries(result.enrichments)) {
            const existing = next.get(id);
            next.set(id, {
              engagement: data.engagement ?? existing?.engagement ?? null,
              topComment: data.topComment,
              userLike: data.userLike,
            });
          }
        }
        return next;
      });
    }).finally(() => {
      setEnrichmentPending(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendingPodcasts, publicPodcasts, freshReleasesPodcasts, guestId]);

  const loadMorePublicPodcasts = useCallback(async () => {
    const nextOffset = publicPodcasts.length;
    setIsLoadingMore(true);
    try {
      // Load-more: no slim — enrichment already inline; pass current sort so results are consistent
      const res = await fetch(`/api/podcasts/public?limit=${PUBLIC_PAGE_SIZE}&offset=${nextOffset}&sortBy=${sortBy}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch more podcasts");
      const data: { podcasts: GeneratedPodcast[]; total: number } = await res.json();
      setPublicPages(prev => [...prev, data.podcasts]);
      setPublicTotal(data.total);
    } finally {
      setIsLoadingMore(false);
    }
  }, [publicPodcasts.length, sortBy]);
  
  const { data: mineResponse } = useQuery<{ podcasts: GeneratedPodcast[], total: number }>({
    // Bumped staleTime from 30s → 5min (Task #102). Slim payload is
    // mostly immutable; mutations invalidate this key explicitly.
    queryKey: ["/api/podcasts/mine", "preview"],
    queryFn: async () => {
      const res = await fetch('/api/podcasts/mine?limit=50&offset=0', { credentials: 'include' });
      // (Task #102: payload now omits `generationParams` per row.)
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
  const myPodcasts = mineResponse?.podcasts ?? [];
  
  const mostRecentPodcastId = myPodcasts.length > 0 ? myPodcasts[0]?.id : null;
  
  const { data: recommendationsData, isLoading: isLoadingRecommendations } = useQuery<{ recommendations: GeneratedPodcast[] }>({
    queryKey: ["/api/recommendations", mostRecentPodcastId],
    enabled: !!mostRecentPodcastId,
    staleTime: 300000,
  });
  
  const recommendations = recommendationsData?.recommendations || [];
  
  // Chip set derived from the brew template catalog so every brew
  // style is reachable. "All" is pinned first and stays text-only.
  const categories = [
    { label: "All", value: "all" as const, Icon: null },
    ...(Object.entries(TEMPLATE_CATEGORIES) as Array<
      [TemplateCategory, (typeof TEMPLATE_CATEGORIES)[TemplateCategory]]
    >).map(([id, t]) => ({
      label: t.name,
      value: id,
      Icon: TEMPLATE_ICON_MAP[t.icon],
    })),
  ] satisfies ReadonlyArray<{
    label: string;
    value: CategoryChipValue;
    Icon: LucideIcon | null;
  }>;

  const sortOptions = [
    { label: "Trending", value: "trending", icon: TrendingUp },
    { label: "Newest", value: "newest", icon: Clock },
    { label: "Popular", value: "popular", icon: Users },
  ];

  const filterByCategory = (podcasts: GeneratedPodcast[]) => {
    if (selectedCategory === "all") return podcasts;
    // Chip values are now the template ids verbatim (e.g. "teachme",
    // "stories", "medical"), so we can compare directly without the
    // legacy "teachme → education" remap.
    return podcasts.filter(
      (podcast) =>
        podcast.templateCategory?.toLowerCase() === selectedCategory,
    );
  };

  const filterBySearch = (podcasts: GeneratedPodcast[]) => {
    if (!searchQuery.trim()) return podcasts;
    const query = searchQuery.toLowerCase();
    return podcasts.filter((podcast) =>
      podcast.topic.toLowerCase().includes(query) ||
      podcast.templateCategory?.toLowerCase().includes(query) ||
      podcast.title?.toLowerCase().includes(query)
    );
  };

  // Client-side sort mirrors the server-side ordering so results feel consistent
  // while a fresh server fetch is in flight after a sort change.
  const hotScore = (p: GeneratedPodcast) => {
    const plays = p.plays || 0;
    const ageHours = p.timestamp
      ? (Date.now() - new Date(p.timestamp).getTime()) / 3_600_000
      : 0;
    return (plays + 1) / Math.pow(ageHours + 2, 1.2);
  };

  const sortPodcasts = (podcasts: GeneratedPodcast[]) => {
    return [...podcasts].sort((a, b) => {
      switch (sortBy) {
        case "trending":
          return hotScore(b) - hotScore(a);
        case "newest":
          return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
        case "popular":
          return (b.plays || 0) - (a.plays || 0);
        default:
          return 0;
      }
    });
  };

  const applyFilters = (podcasts: GeneratedPodcast[]) => {
    return sortPodcasts(filterBySearch(filterByCategory(podcasts)));
  };

  // Merge enrichment data into podcast objects
  const enrich = useCallback((podcast: GeneratedPodcast): EnrichedPodcast => {
    const e = enrichmentMap.get(podcast.id);
    if (!e) return podcast as EnrichedPodcast;
    return {
      ...podcast,
      _engagement: e.engagement,
      _topComment: e.topComment,
      _userLike: e.userLike,
    };
  }, [enrichmentMap]);

  // Deduplicated sections - each podcast appears only once across all sections.
  // Priority: Fresh Releases > You Might Like > Trending Now > All Podcasts.
  // Fresh Releases is pinned first (and uses its own always-newest data
  // source) so the rail is guaranteed to show the literal latest 4 brewed
  // even when those same podcasts also qualify as trending or recommended.
  const deduplicatedSections = useMemo(() => {
    const seenIds = new Set<string>();

    const dedupe = (podcasts: GeneratedPodcast[], limit?: number): EnrichedPodcast[] => {
      const result: EnrichedPodcast[] = [];
      for (const podcast of podcasts) {
        if (!seenIds.has(podcast.id)) {
          seenIds.add(podcast.id);
          result.push(enrich(podcast));
          if (limit && result.length >= limit) break;
        }
      }
      return result;
    };

    // 1. Fresh Releases (always-newest, pinned). Apply category + search but
    // skip sortPodcasts so the server's newest-first ordering is preserved
    // regardless of the user's sort selection.
    const freshFiltered = filterBySearch(filterByCategory(freshReleasesPodcasts));
    const freshReleases = dedupe(freshFiltered, 4);

    // 2. You Might Like (recommendations). Apply category + search so a
    // selected template chip actually narrows this rail too — otherwise
    // picking "News Briefing" still showed Custom Topic recommendations.
    const youMightLikeFiltered = filterBySearch(filterByCategory(recommendations));
    const youMightLike = dedupe(youMightLikeFiltered, 4);

    // 3. Trending Now
    const trendingFiltered = applyFilters(trendingPodcasts);
    const trendingNow = dedupe(trendingFiltered, 4);

    // 4. All Podcasts - remaining podcasts not shown above
    const allFiltered = applyFilters(publicPodcasts);
    const allPodcasts = allFiltered
      .filter(p => !seenIds.has(p.id))
      .map(enrich);

    return {
      youMightLike,
      trendingNow,
      freshReleases,
      allPodcasts,
    };
  }, [freshReleasesPodcasts, recommendations, trendingPodcasts, publicPodcasts, selectedCategory, searchQuery, sortBy, enrich]);

  const hasActiveFilters = searchQuery.trim() !== "" || selectedCategory !== "all";

  // enrichmentPending only applies to slim-loaded sections (trending + public), not myPodcasts
  const slimEnrichmentPending = enrichmentPending && (trendingPodcasts.length > 0 || publicPodcasts.length > 0);

  return (
    <div className="container max-w-7xl mx-auto px-4 py-2 space-y-4 overflow-hidden">
      <Helmet>
        <title>Discover AI Podcasts - Trending &amp; New | PodBrew</title>
        <meta name="description" content="Explore AI-generated podcasts on trending topics. Listen to studio-quality podcasts created with 30+ premium AI voices. New episodes added daily." />
        <link rel="canonical" href="https://podbrew.pro/listen" />
        <meta property="og:title" content="Discover AI Podcasts - Trending & New | PodBrew" />
        <meta property="og:description" content="Explore AI-generated podcasts on trending topics. Listen to studio-quality podcasts created with premium AI voices." />
        <meta property="og:url" content="https://podbrew.pro/listen" />
        <meta name="twitter:title" content="Discover AI Podcasts - Trending & New | PodBrew" />
        <meta name="twitter:description" content="Explore AI-generated podcasts on trending topics. Studio-quality audio with 30+ AI voices." />
      </Helmet>
      <h1 className="sr-only">Discover AI-Generated Podcasts</h1>
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search podcasts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 min-h-[44px]"
              data-testid="input-search"
            />
          </div>
          
          <div className="flex gap-2 w-full sm:w-auto">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="flex-1 sm:w-36 sm:flex-none min-w-0 min-h-[44px]" data-testid="select-sort">
                <Filter className="h-4 w-4 mr-2 shrink-0" />
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <div className="flex items-center gap-2">
                      <option.icon className="h-4 w-4" />
                      {option.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <TrendingTopicsPanel 
              trigger={
                <Button 
                  variant="outline" 
                  size="default"
                  className="hidden sm:flex gap-2 shrink-0 border-orange-500/50 min-h-[44px]"
                  data-testid="button-trending-topics"
                >
                  <Flame className="h-4 w-4 text-orange-500" />
                  <span>Topics</span>
                </Button>
              }
            />
          </div>
        </div>

        <CategoryChipRow
          categories={categories}
          selectedCategory={selectedCategory}
          onSelect={setSelectedCategory}
        />
      </div>

      {/* Fresh Releases is the topmost rail and the most likely LCP
          candidate, so it's the only section that opts into the
          `fetchpriority="high"` hint for its first card. */}
      <HorizontalSection
        title="Fresh Releases"
        icon={Sparkles}
        podcasts={deduplicatedSections.freshReleases}
        isLoading={isLoadingFreshReleases}
        showCount={4}
        enrichmentPending={slimEnrichmentPending}
        enablePriority
      />

      
      {mostRecentPodcastId && (deduplicatedSections.youMightLike.length > 0 || isLoadingRecommendations) && (
        <HorizontalSection
          title="You Might Like"
          subtitle="Based on your recent listens"
          icon={Sparkles}
          podcasts={deduplicatedSections.youMightLike}
          isLoading={isLoadingRecommendations}
          showCount={4}
          enrichmentPending={slimEnrichmentPending}
        />
      )}
      
      <HorizontalSection
        title="Trending Now"
        icon={TrendingUp}
        podcasts={deduplicatedSections.trendingNow}
        isLoading={isLoadingTrending}
        showCount={4}
        enrichmentPending={slimEnrichmentPending}
      />

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-primary" />
            <h2 className="text-lg md:text-xl font-semibold" data-testid="section-title-all-podcasts">
              All Podcasts
            </h2>
            {hasActiveFilters && (
              <span className="text-sm text-muted-foreground">
                ({deduplicatedSections.allPodcasts.length} results)
              </span>
            )}
          </div>
        </div>

        {isLoadingPublicDisplay ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <PodcastCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <>
            {deduplicatedSections.allPodcasts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6" data-testid="grid-all-podcasts">
                {/* The "All Podcasts" grid sits below several rails, so
                    it never sets `priority` — the Fresh Releases rail
                    above already claims the LCP hint. */}
                {deduplicatedSections.allPodcasts.map((podcast) => (
                  <PodcastCard
                    key={podcast.id}
                    podcast={podcast}
                    enrichmentPending={slimEnrichmentPending}
                  />
                ))}
              </div>
            ) : (
              <div className="py-16 text-center">
                <p className="text-muted-foreground" data-testid="text-empty-state">
                  {searchQuery 
                    ? `No podcasts found for "${searchQuery}"`
                    : "No podcasts available in this category"
                  }
                </p>
              </div>
            )}
            {hasMorePublicPodcasts && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  onClick={loadMorePublicPodcasts}
                  disabled={isLoadingMore}
                  data-testid="button-load-more"
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    `Load more (${publicPodcasts.length} of ${totalPublic})`
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
      
    </div>
  );
}
