import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  MapPin, 
  Calendar, 
  Clock, 
  Ticket, 
  Loader2, 
  Zap, 
  Flame, 
  TrendingUp,
  CalendarDays,
  AlertCircle,
  ExternalLink,
  Sparkles,
  Search,
  Settings
} from "lucide-react";
import { SiX } from "react-icons/si";
import { Link } from "wouter";

interface LocalEvent {
  name: string;
  venue: string;
  date: string;
  time?: string;
  description: string;
  category: string;
  ticketInfo?: string;
  sourceUrl?: string;
  engagementLevel: 'viral' | 'trending' | 'rising' | 'upcoming';
}

interface LocalEventResponse {
  events: LocalEvent[];
  city: string;
  lastUpdated: string;
  available: boolean;
  disclaimer?: string;
  error?: string;
  needsLocationSetup?: boolean;
  message?: string;
}

type DateRange = 'today' | 'this_week' | 'this_month';

const EVENT_TYPES = [
  { value: 'all', label: 'All Events' },
  { value: 'concert', label: 'Concerts' },
  { value: 'live-music', label: 'Live Music' },
  { value: 'comedy', label: 'Comedy' },
  { value: 'festival', label: 'Festivals' },
  { value: 'sports', label: 'Sports' },
  { value: 'theater', label: 'Theater' },
  { value: 'exhibition', label: 'Exhibitions' },
];

interface LocalEventDiscoveryProps {
  onEventSelect: (events: LocalEvent[], dateRange?: string, eventType?: string) => void;
  locationEnabled?: boolean;
  locationCity?: string | null;
}

export function LocalEventDiscovery({ onEventSelect, locationEnabled, locationCity }: LocalEventDiscoveryProps) {
  const [dateRange, setDateRange] = useState<DateRange>('this_week');
  const [eventType, setEventType] = useState<string>('all');
  const [manualCity, setManualCity] = useState<string>('');
  const [searchCity, setSearchCity] = useState<string>('');
  const [selectedEventIndices, setSelectedEventIndices] = useState<Set<number>>(new Set());

  const hasLocation = locationEnabled && locationCity;
  const effectiveCity = hasLocation ? locationCity : searchCity;
  const useMyLocation = hasLocation;

  const { data: statusData } = useQuery<{ available: boolean }>({
    queryKey: ['/api/events/discover/status'],
  });

  // Query for authenticated users with saved location
  const { data: myEventsData, isLoading: myEventsLoading, error: myEventsError } = useQuery<LocalEventResponse>({
    queryKey: ['/api/events/discover/me', eventType, dateRange],
    queryFn: async (): Promise<LocalEventResponse> => {
      const params = new URLSearchParams({
        dateRange,
        ...(eventType !== 'all' && { eventType })
      });
      const response = await fetch(`/api/events/discover/me?${params}`);
      const data = await response.json();
      
      // Handle needsLocationSetup response
      if (data.needsLocationSetup) {
        return { 
          events: [], 
          city: '', 
          lastUpdated: '', 
          available: true, 
          needsLocationSetup: true,
          message: data.message 
        };
      }
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch events');
      }
      return data as LocalEventResponse;
    },
    enabled: Boolean(useMyLocation && statusData?.available !== false),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  // Query for manual city search
  const { data: manualEventsData, isLoading: manualEventsLoading, error: manualEventsError } = useQuery<LocalEventResponse>({
    queryKey: ['/api/events/discover', searchCity, eventType, dateRange],
    queryFn: async (): Promise<LocalEventResponse> => {
      if (!searchCity) {
        return { events: [], city: '', lastUpdated: '', available: false };
      }
      const params = new URLSearchParams({
        city: searchCity,
        dateRange,
        ...(eventType !== 'all' && { eventType })
      });
      const response = await fetch(`/api/events/discover?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch events');
      }
      return response.json() as Promise<LocalEventResponse>;
    },
    enabled: Boolean(!useMyLocation && searchCity && statusData?.available !== false),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  // Use appropriate data based on auth state
  const eventsData: LocalEventResponse | undefined = useMyLocation ? myEventsData : manualEventsData;
  const isLoading = useMyLocation ? myEventsLoading : manualEventsLoading;
  const error = useMyLocation ? myEventsError : manualEventsError;

  const isAvailable = statusData?.available !== false;
  const events = eventsData?.events || [];

  const getEngagementBadge = (level: LocalEvent['engagementLevel']) => {
    switch (level) {
      case 'viral':
        return (
          <Badge variant="destructive" className="shrink-0">
            <Zap className="h-3 w-3 mr-1" />
            Viral
          </Badge>
        );
      case 'trending':
        return (
          <Badge variant="default" className="shrink-0">
            <Flame className="h-3 w-3 mr-1" />
            Trending
          </Badge>
        );
      case 'rising':
        return (
          <Badge variant="secondary" className="shrink-0">
            <TrendingUp className="h-3 w-3 mr-1" />
            Rising
          </Badge>
        );
      case 'upcoming':
        return (
          <Badge variant="outline" className="shrink-0">
            <CalendarDays className="h-3 w-3 mr-1" />
            Upcoming
          </Badge>
        );
    }
  };

  const handleSearch = () => {
    if (manualCity.trim()) {
      setSearchCity(manualCity.trim());
    }
  };

  const toggleEventSelection = (index: number) => {
    const newIndices = new Set(selectedEventIndices);
    if (newIndices.has(index)) {
      newIndices.delete(index);
    } else {
      newIndices.add(index);
    }
    setSelectedEventIndices(newIndices);
  };

  const handleCreatePodcastFromSelected = () => {
    const selectedEvents = Array.from(selectedEventIndices).map(i => events[i]);
    if (selectedEvents.length > 0) {
      // Pass dateRange and eventType (use null for 'all' to let form auto-detect)
      onEventSelect(selectedEvents, dateRange, eventType !== 'all' ? eventType : undefined);
      setSelectedEventIndices(new Set());
    }
  };

  if (!isAvailable) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-8">
          <SiX className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-center text-sm">
            Local event discovery is not available.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Requires xAI API configuration.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">Discover Local Events</h3>
          </div>
        </div>

        {!hasLocation && (
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder="Enter city name (e.g., Brisbane, Australia)"
                value={manualCity}
                onChange={(e) => setManualCity(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                data-testid="input-city-search"
              />
            </div>
            <Button onClick={handleSearch} disabled={!manualCity.trim()} data-testid="button-search-city">
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>
        )}

        {hasLocation && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            <span>Showing events in <strong className="text-foreground">{locationCity}</strong></span>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="date-range" className="text-sm whitespace-nowrap">When:</Label>
            <Tabs value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
              <TabsList className="h-8">
                <TabsTrigger value="today" className="text-xs px-2" data-testid="tab-today">Today</TabsTrigger>
                <TabsTrigger value="this_week" className="text-xs px-2" data-testid="tab-this-week">This Week</TabsTrigger>
                <TabsTrigger value="this_month" className="text-xs px-2" data-testid="tab-this-month">This Month</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="event-type-filter" className="text-sm whitespace-nowrap">Type:</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="w-[140px] h-8" id="event-type-filter" data-testid="select-event-type-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map(({ value, label }) => (
                  <SelectItem key={value} value={value} data-testid={`select-item-${value}`}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {eventsData?.disclaimer && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {eventsData.disclaimer}
          </AlertDescription>
        </Alert>
      )}

      {/* Show setup prompt for authenticated users without location configured */}
      {eventsData?.needsLocationSetup ? (
        <Card className="border-dashed border-primary/30">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Settings className="h-8 w-8 text-primary mb-3" />
            <p className="text-foreground text-center font-medium">
              {eventsData.message || "Location not configured"}
            </p>
            <p className="text-sm text-muted-foreground mt-2 text-center max-w-sm">
              Enable location in Settings &gt; Preferences to automatically discover events near you.
            </p>
            <Link href="/settings" asChild>
              <Button 
                variant="default" 
                className="mt-4"
                data-testid="button-setup-location"
              >
                <Settings className="h-4 w-4 mr-2" />
                Open Settings
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : !effectiveCity && !useMyLocation ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <MapPin className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-center text-sm">
              Enter a city name above to discover local events.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Or enable location in Settings for automatic discovery.
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex items-center justify-center gap-3 py-8">
          <Loader2 className="h-5 w-5 text-primary animate-spin" data-testid="icon-loading-spinner" />
          <span className="text-sm text-muted-foreground">
            Searching for events in {effectiveCity}...
          </span>
        </div>
      ) : events.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <CalendarDays className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-center text-sm">
              No events found for {effectiveCity}.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Try a different date range or event type.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1">
            {events.map((event, index) => (
              <Card 
                key={index} 
                className={`hover-elevate cursor-pointer transition-all ${
                  selectedEventIndices.has(index) ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => toggleEventSelection(index)}
                data-testid={`card-event-${index}`}
              >
                <CardHeader className="pb-2 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1">
                      <Checkbox
                        checked={selectedEventIndices.has(index)}
                        onCheckedChange={() => toggleEventSelection(index)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 shrink-0"
                        data-testid={`checkbox-event-${index}`}
                      />
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-sm line-clamp-2">{event.name}</CardTitle>
                      </div>
                    </div>
                    {getEngagementBadge(event.engagementLevel)}
                  </div>
                  <CardDescription className="text-xs line-clamp-2">
                    {event.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      <span>{event.date}</span>
                    </div>
                    {event.time && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>{event.time}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="line-clamp-1">{event.venue}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex gap-1">
                      <Badge variant="secondary" className="text-xs">
                        {event.category}
                      </Badge>
                      {event.ticketInfo && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Ticket className="h-2.5 w-2.5" />
                          {event.ticketInfo.length > 20 ? 'Tickets' : event.ticketInfo}
                        </Badge>
                      )}
                    </div>
                    {event.sourceUrl && (
                      <a 
                        href={event.sourceUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {selectedEventIndices.size > 0 && (
            <Button 
              onClick={handleCreatePodcastFromSelected}
              className="w-full"
              size="lg"
              data-testid="button-create-podcast-selected"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Create Podcast from {selectedEventIndices.size} Selected Event{selectedEventIndices.size !== 1 ? 's' : ''}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
