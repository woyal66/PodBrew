import crypto from 'crypto';

interface PodcastIndexConfig {
  apiKey: string;
  apiSecret: string;
}

interface PodcastSearchResult {
  id: number;
  podcastGuid: string;
  title: string;
  url: string;
  description: string;
  author: string;
  image: string;
  language: string;
  categories: Record<string, string>;
}

interface EpisodeResult {
  id: number;
  guid: string;
  title: string;
  description: string;
  datePublished: number;
  datePublishedPretty: string;
  duration: number;
  enclosureUrl: string;
  enclosureType: string;
  enclosureLength: number;
  image: string;
  feedId: number;
  feedTitle: string;
  feedUrl: string;
  feedImage: string;
  transcriptUrl?: string;
  transcripts?: Array<{
    url: string;
    type: string;
  }>;
}

interface PodcastIndexResponse<T> {
  status: string;
  count: number;
  query: string;
  feeds?: T[];
  items?: T[];
  episode?: T;
  description?: string;
}

class PodcastIndexClient {
  private apiKey: string | null = null;
  private apiSecret: string | null = null;
  private baseUrl = 'https://api.podcastindex.org/api/1.0';

  constructor() {
    this.apiKey = process.env.PODCASTINDEX_API_KEY || null;
    this.apiSecret = process.env.PODCASTINDEX_API_SECRET || null;
  }

  isAvailable(): boolean {
    return !!(this.apiKey && this.apiSecret);
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('PodcastIndex API credentials not configured');
    }

    const authDate = Math.floor(Date.now() / 1000);
    const authHash = crypto
      .createHash('sha1')
      .update(this.apiKey + this.apiSecret + authDate)
      .digest('hex');

    return {
      'User-Agent': 'PodBrew/1.0',
      'X-Auth-Key': this.apiKey,
      'X-Auth-Date': authDate.toString(),
      'Authorization': authHash,
    };
  }

  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    const response = await fetch(url.toString(), {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[PodcastIndex] API error: ${response.status}`, errorText);
      throw new Error(`PodcastIndex API error: ${response.status}`);
    }

    return response.json();
  }

  async searchPodcasts(query: string, max: number = 10): Promise<PodcastSearchResult[]> {
    console.log(`[PodcastIndex] Searching podcasts: "${query}"`);
    
    const response = await this.request<PodcastIndexResponse<PodcastSearchResult>>(
      '/search/byterm',
      { q: query, max: max.toString() }
    );

    return response.feeds || [];
  }

  async searchEpisodes(query: string, max: number = 10): Promise<EpisodeResult[]> {
    console.log(`[PodcastIndex] Searching episodes: "${query}"`);
    
    const response = await this.request<PodcastIndexResponse<EpisodeResult>>(
      '/search/byterm',
      { q: query, max: max.toString() }
    );

    return response.items || [];
  }

  async getEpisodesByFeedId(feedId: number, max: number = 20): Promise<EpisodeResult[]> {
    console.log(`[PodcastIndex] Getting episodes for feed: ${feedId}`);
    
    const response = await this.request<PodcastIndexResponse<EpisodeResult>>(
      '/episodes/byfeedid',
      { id: feedId.toString(), max: max.toString() }
    );

    return response.items || [];
  }

  async getEpisodeById(episodeId: number): Promise<EpisodeResult | null> {
    console.log(`[PodcastIndex] Getting episode: ${episodeId}`);
    
    try {
      const response = await this.request<PodcastIndexResponse<EpisodeResult>>(
        '/episodes/byid',
        { id: episodeId.toString() }
      );
      return response.episode || null;
    } catch (error) {
      console.error('[PodcastIndex] Error getting episode:', error);
      return null;
    }
  }

  async getEpisodeByGuid(guid: string, feedUrl: string): Promise<EpisodeResult | null> {
    console.log(`[PodcastIndex] Getting episode by GUID: ${guid}`);
    
    try {
      const response = await this.request<PodcastIndexResponse<EpisodeResult>>(
        '/episodes/byguid',
        { guid, feedurl: feedUrl }
      );
      return response.episode || null;
    } catch (error) {
      console.error('[PodcastIndex] Error getting episode by GUID:', error);
      return null;
    }
  }

  async findSpotifyEpisode(spotifyUrl: string): Promise<EpisodeResult | null> {
    const episodeMatch = spotifyUrl.match(/episode\/([a-zA-Z0-9]+)/);
    if (!episodeMatch) {
      console.log('[PodcastIndex] Invalid Spotify URL format');
      return null;
    }

    console.log(`[PodcastIndex] Attempting to find Spotify episode in PodcastIndex...`);

    try {
      const response = await fetch(spotifyUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PodBrew/1.0)' }
      });
      
      if (!response.ok) {
        console.log('[PodcastIndex] Failed to fetch Spotify page');
        return null;
      }

      const html = await response.text();
      
      const titleMatch = html.match(/<title>([^<]+)<\/title>/) ||
                         html.match(/og:title[^>]+content="([^"]+)"/);
      const showMatch = html.match(/og:site_name[^>]+content="([^"]+)"/) ||
                        html.match(/"show":\s*\{[^}]*"name":\s*"([^"]+)"/);
      
      const episodeTitle = titleMatch ? 
        titleMatch[1].replace(' | Podcast on Spotify', '').replace(' - Spotify', '').trim() : '';
      const showName = showMatch ? showMatch[1].trim() : '';

      if (!episodeTitle) {
        console.log('[PodcastIndex] Could not extract episode title from Spotify');
        return null;
      }

      console.log(`[PodcastIndex] Extracted: "${episodeTitle}" from "${showName}"`);

      const searchQuery = showName ? `${showName} ${episodeTitle}` : episodeTitle;
      const episodes = await this.searchEpisodes(searchQuery.slice(0, 100), 5);

      if (episodes.length === 0) {
        console.log('[PodcastIndex] No matching episodes found');
        return null;
      }

      const titleLower = episodeTitle.toLowerCase();
      const bestMatch = episodes.find(ep => {
        const epTitleLower = ep.title.toLowerCase();
        return epTitleLower.includes(titleLower.slice(0, 30)) ||
               titleLower.includes(epTitleLower.slice(0, 30));
      });

      if (bestMatch) {
        console.log(`[PodcastIndex] Found matching episode: "${bestMatch.title}"`);
        console.log(`[PodcastIndex] Audio URL: ${bestMatch.enclosureUrl}`);
        console.log(`[PodcastIndex] Transcript URL: ${bestMatch.transcriptUrl || 'None'}`);
        return bestMatch;
      }

      console.log(`[PodcastIndex] Using first search result: "${episodes[0].title}"`);
      return episodes[0];

    } catch (error) {
      console.error('[PodcastIndex] Error finding Spotify episode:', error);
      return null;
    }
  }

  async getTranscriptFromUrl(transcriptUrl: string): Promise<string | null> {
    console.log(`[PodcastIndex] Fetching transcript from: ${transcriptUrl}`);
    
    try {
      const response = await fetch(transcriptUrl, {
        headers: { 'User-Agent': 'PodBrew/1.0' }
      });

      if (!response.ok) {
        console.log(`[PodcastIndex] Transcript fetch failed: ${response.status}`);
        return null;
      }

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();

      if (contentType.includes('application/json')) {
        try {
          const json = JSON.parse(text);
          if (json.segments) {
            return json.segments.map((s: any) => s.body || s.text || '').join(' ');
          }
          return JSON.stringify(json);
        } catch {
          return text;
        }
      }

      if (contentType.includes('text/vtt') || text.startsWith('WEBVTT')) {
        return this.parseVTT(text);
      }

      if (contentType.includes('application/x-subrip') || text.includes(' --> ')) {
        return this.parseSRT(text);
      }

      return text;
    } catch (error) {
      console.error('[PodcastIndex] Error fetching transcript:', error);
      return null;
    }
  }

  private parseVTT(vtt: string): string {
    const lines = vtt.split('\n');
    const textLines: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === 'WEBVTT') continue;
      if (trimmed.includes('-->')) continue;
      if (/^\d+$/.test(trimmed)) continue;
      if (trimmed.startsWith('NOTE')) continue;
      
      const cleanText = trimmed
        .replace(/<[^>]+>/g, '')
        .replace(/\{[^}]+\}/g, '')
        .trim();
      
      if (cleanText) {
        textLines.push(cleanText);
      }
    }
    
    return textLines.join(' ').replace(/\s+/g, ' ').trim();
  }

  private parseSRT(srt: string): string {
    const lines = srt.split('\n');
    const textLines: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^\d+$/.test(trimmed)) continue;
      if (trimmed.includes('-->')) continue;
      
      textLines.push(trimmed);
    }
    
    return textLines.join(' ').replace(/\s+/g, ' ').trim();
  }
}

export const podcastIndexClient = new PodcastIndexClient();
export type { PodcastSearchResult, EpisodeResult };
