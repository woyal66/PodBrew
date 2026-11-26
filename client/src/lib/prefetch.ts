const prefetchedUrls = new Set<string>();
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

function shouldPrefetch(url: string): boolean {
  if (prefetchedUrls.has(url)) return false;
  if (url.startsWith('#')) return false;
  if (url.includes('://') && !url.includes(window.location.host)) return false;
  if (url.startsWith('mailto:') || url.startsWith('tel:')) return false;
  return true;
}

function prefetchUrl(url: string): void {
  if (!shouldPrefetch(url)) return;
  
  prefetchedUrls.add(url);
  
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = url;
  link.as = 'document';
  document.head.appendChild(link);
}

function handleMouseEnter(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  
  const anchor = target.closest('a');
  if (!anchor) return;
  
  const href = anchor.getAttribute('href');
  if (!href) return;
  
  if (hoverTimer) clearTimeout(hoverTimer);
  
  hoverTimer = setTimeout(() => {
    prefetchUrl(href);
  }, 65);
}

function handleMouseLeave(): void {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

function handleTouchStart(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  
  const anchor = target.closest('a');
  if (!anchor) return;
  
  const href = anchor.getAttribute('href');
  if (href) {
    prefetchUrl(href);
  }
}

export function initPrefetch(): void {
  if (typeof window === 'undefined') return;
  
  const supportsPreload = 'relList' in HTMLLinkElement.prototype;
  if (!supportsPreload) return;
  
  document.addEventListener('mouseover', handleMouseEnter, { passive: true });
  document.addEventListener('mouseout', handleMouseLeave, { passive: true });
  document.addEventListener('touchstart', handleTouchStart, { passive: true });
}

export function cleanupPrefetch(): void {
  document.removeEventListener('mouseover', handleMouseEnter);
  document.removeEventListener('mouseout', handleMouseLeave);
  document.removeEventListener('touchstart', handleTouchStart);
}
