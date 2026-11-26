/**
 * Analytics tracking hook for PodBrew onboarding and engagement
 * 
 * This provides a centralized place to track user interactions and conversions.
 * Replace console.log calls with your analytics service (e.g., Plausible, PostHog, GA4)
 */

export function useAnalytics() {
  const trackEvent = (eventName: string, properties?: Record<string, any>) => {
    // TODO: Replace with your analytics service
    console.log('[Analytics]', eventName, properties);
    
    // Example integrations:
    // Plausible: window.plausible?.(eventName, { props: properties });
    // PostHog: window.posthog?.capture(eventName, properties);
    // GA4: window.gtag?.('event', eventName, properties);
  };

  // Onboarding Events
  const trackTourStarted = () => {
    trackEvent('Onboarding Tour Started');
  };

  const trackTourCompleted = (stepReached: number) => {
    trackEvent('Onboarding Tour Completed', { stepReached });
  };

  const trackTourSkipped = (stepReached: number) => {
    trackEvent('Onboarding Tour Skipped', { stepReached });
  };

  // Brew Button Events
  const trackBrewClicked = (isAuthenticated: boolean, durationMinutes: number) => {
    trackEvent('Brew Button Clicked', { 
      isAuthenticated, 
      durationMinutes,
      userType: isAuthenticated ? 'authenticated' : 'guest'
    });
  };

  const trackAuthTriggeredFromBrew = () => {
    trackEvent('Auth Modal Triggered From Brew');
  };

  const trackAuthConversion = (source: 'brew' | 'tour' | 'header') => {
    trackEvent('User Authenticated', { source });
  };

  // Listen Page Events
  const trackListenPageVisit = (source: 'navigation' | 'tour_nudge' | 'direct') => {
    trackEvent('Listen Page Visited', { source });
  };

  const trackPodcastPlayed = (podcastId: string, source: 'listen' | 'library' | 'detail') => {
    trackEvent('Podcast Played', { podcastId, source });
  };

  // Voice Selection Events
  const trackVoiceModalOpened = () => {
    trackEvent('Voice Selection Modal Opened');
  };

  const trackVoiceSelected = (voiceId: string, voiceQuality: string) => {
    trackEvent('Voice Selected', { voiceId, voiceQuality });
  };

  return {
    trackEvent,
    trackTourStarted,
    trackTourCompleted,
    trackTourSkipped,
    trackBrewClicked,
    trackAuthTriggeredFromBrew,
    trackAuthConversion,
    trackListenPageVisit,
    trackPodcastPlayed,
    trackVoiceModalOpened,
    trackVoiceSelected,
  };
}
