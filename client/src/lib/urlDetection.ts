export interface DetectedSource {
  type: 'youtube' | 'podcast' | 'spotify' | 'rss' | 'url' | 'generic';
  url: string;
  videoId?: string;
  episodeId?: string;
  showId?: string;
}

const URL_PATTERNS = {
  youtube: /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/gi,
  spotify: /https?:\/\/(?:www\.)?open\.spotify\.com\/(episode|show)\/([a-zA-Z0-9]+)/gi,
  podcast: /https?:\/\/(?:www\.)?(?:podcasts?\.apple\.com|overcast\.fm|pocketcasts\.com|castbox\.fm|stitcher\.com|anchor\.fm|podcasts\.google\.com|podbean\.com|buzzsprout\.com|spreaker\.com|libsyn\.com|simplecast\.com|transistor\.fm|megaphone\.fm|omny\.fm|acast\.com|podchaser\.com|listen\.com|iheart\.com\/podcast|tunein\.com\/podcasts?|podtail\.com|player\.fm|podcastaddict\.com)[^\s]*/gi,
  rss: /https?:\/\/[^\s]+(?:\.rss|\/feed\/?|\/rss\/?|atom\.xml|feed\.xml|rss\.xml|podcast\.xml)/gi,
};

export function detectUrlsInText(text: string): DetectedSource[] {
  const sources: DetectedSource[] = [];
  const seenUrls = new Set<string>();
  
  const ytRegex = new RegExp(URL_PATTERNS.youtube.source, 'gi');
  let match;
  while ((match = ytRegex.exec(text)) !== null) {
    const url = match[0];
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      sources.push({ 
        type: 'youtube', 
        url,
        videoId: match[1]
      });
    }
  }
  
  const spotifyRegex = new RegExp(URL_PATTERNS.spotify.source, 'gi');
  while ((match = spotifyRegex.exec(text)) !== null) {
    const url = match[0];
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      const isEpisode = match[1] === 'episode';
      sources.push({ 
        type: 'spotify', 
        url,
        episodeId: isEpisode ? match[2] : undefined,
        showId: !isEpisode ? match[2] : undefined
      });
    }
  }
  
  const podcastRegex = new RegExp(URL_PATTERNS.podcast.source, 'gi');
  while ((match = podcastRegex.exec(text)) !== null) {
    const url = match[0];
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      sources.push({ type: 'podcast', url });
    }
  }
  
  const rssRegex = new RegExp(URL_PATTERNS.rss.source, 'gi');
  while ((match = rssRegex.exec(text)) !== null) {
    const url = match[0];
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      sources.push({ type: 'rss', url });
    }
  }
  
  return sources;
}

export function getCleanTopic(text: string): string {
  let cleanText = text;
  
  for (const [, pattern] of Object.entries(URL_PATTERNS)) {
    cleanText = cleanText.replace(new RegExp(pattern.source, 'gi'), '');
  }
  
  return cleanText.replace(/\s+/g, ' ').trim();
}

export function getSourceIcon(type: DetectedSource['type']): string {
  switch (type) {
    case 'youtube': return '📺';
    case 'spotify': return '🎧';
    case 'podcast': return '🎙️';
    case 'rss': return '📡';
    default: return '🔗';
  }
}

export function getSourceLabel(type: DetectedSource['type']): string {
  switch (type) {
    case 'youtube': return 'YouTube Video';
    case 'spotify': return 'Spotify Episode';
    case 'podcast': return 'Podcast Episode';
    case 'rss': return 'RSS Feed';
    default: return 'Web Link';
  }
}

export function getYouTubeThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}
