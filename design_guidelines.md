# Design Guidelines: PodBrew - AI Podcast Generator

## Design Approach
**Reference-Based:** Inspired by Spotify's warmth and playfulness, Apple Podcasts' clean hierarchy, and SoundCloud's creator-focused interface. Emphasis on audio visualization and seamless creation-to-listening flow.

## Core Design Principles
1. **Audio-First Experience**: Every element supports podcast creation and playback
2. **Warm & Inviting**: Orange/amber palette creates energetic, creative atmosphere
3. **Studio Quality**: Professional polish that builds trust in AI-generated content
4. **Instant Gratification**: Topic input → podcast generation → playback in single flow

## Typography
**Font Stack:**
- Primary: 'Plus Jakarta Sans' (Google Fonts) - Warm, rounded for friendly professionalism
- Secondary: 'Space Grotesk' (Google Fonts) - Bold headings with character

**Hierarchy:**
- Page Title: text-5xl font-bold (Space Grotesk)
- Section Headers: text-3xl font-semibold (Plus Jakarta Sans)
- Podcast Titles: text-xl font-bold
- Input Labels: text-sm font-medium uppercase tracking-wide
- Body/Descriptions: text-base
- Metadata (duration/timestamp): text-xs font-medium

## Layout System
**Spacing Primitives:** Tailwind units of 4, 6, 8, 12, 16, 24
- Hero padding: py-24 to py-32
- Section spacing: space-y-16
- Card padding: p-6 to p-8
- Grid gaps: gap-6

**Container:**
- Max-width: max-w-7xl
- Creation section: max-w-4xl centered
- Hero: Full-width with inner max-w-6xl

## Component Library

### Hero Section
**Layout:** Full-width with background image (podcast studio with warm lighting, microphones, headphones - professional but inviting aesthetic)
- Height: min-h-[600px] with content vertically centered
- Gradient overlay: Dark gradient (bottom-to-top) for text legibility
- Content: Centered column with main headline, subheadline, primary CTA

**Content Structure:**
- Main headline: "Transform Ideas into Professional Podcasts in Minutes"
- Subheadline: "AI-powered podcast generation from simple text prompts. No recording equipment needed."
- Primary CTA button: "Create Your First Podcast" (px-8 py-4, rounded-full, backdrop-blur-md background)
- Trust indicator below CTA: "Join 10,000+ creators | 50,000+ podcasts generated"

### Navigation Header
- Fixed/sticky top, h-20, backdrop-blur-lg
- Logo with waveform icon (left)
- Navigation: "Create", "Library", "Pricing" (center for desktop, hidden mobile)
- User credits/account (right)

### Creation Section
**Position:** Immediately after hero, prominent placement with warm background treatment

**Elements:**
- Large heading: "What's Your Podcast About?"
- Textarea: min-h-40, rounded-2xl, generous padding (p-6)
- Placeholder: "Enter your topic... (e.g., 'The history of jazz music' or 'Tips for growing tomatoes')"
- Character counter: Shows suggested range (100-500 characters)
- Duration selector: Radio buttons for "90 seconds" / "2 minutes" / "3 minutes"
- Voice style picker: Grid of 4-6 options (Professional, Conversational, Energetic, Storytelling) with small avatar icons
- Generate button: Large (px-12 py-4), rounded-full, full-width mobile

### Audio Player Component
**Design:** Modern, card-based player inspired by Spotify

**Elements:**
- Podcast title and generated timestamp
- Large waveform visualization (animated bars showing audio progress)
- Play/pause button (rounded-full, large p-4 center)
- Progress bar with time markers (00:00 / 02:00)
- Controls row: Download button, Share button, Regenerate button
- Background: Subtle gradient card with rounded-2xl, shadow-lg

### Podcast Library Grid
**Layout:** 
- Grid: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6
- Each card: Podcast episode with album-art-style placeholder

**Card Structure:**
- Square thumbnail with waveform pattern or topic-based generated artwork
- Podcast title (text-lg font-bold, line-clamp-2)
- Topic preview (text-sm, line-clamp-1, reduced opacity)
- Duration badge (bottom-right of thumbnail)
- Mini play button overlay (appears on hover, backdrop-blur-md)
- Generated date (text-xs)

### Feature Highlights Section
**Layout:** 3-column grid below hero (grid-cols-1 md:grid-cols-3)

**Features:**
- Icon + Title + Description format
- Icons: microphone (AI Voices), clock (Fast Generation), sparkles (Smart Topics)
- Each column: Centered text, icon at top (w-12 h-12), rounded-2xl backgrounds with subtle orange tint

### Loading States
- Generation: Animated waveform skeleton in library grid
- Progress indicator: "Generating your podcast... 45%" with pulsing waveform
- Smooth fade-in when complete

### Empty State
- Center-aligned in library area
- Large microphone icon (w-24 h-24)
- Heading: "Your Podcast Studio Awaits"
- Description: "Create your first AI-generated podcast to get started"
- CTA button linking to creation section

## Icons
**Library:** Heroicons
- Play/Pause: play, pause
- Download: arrow-down-tray
- Share: share
- Microphone: microphone
- Waveform: chart-bar-square (rotated)
- Regenerate: arrow-path

## Images
**Hero Image:** Large background image showcasing professional podcast studio setup - warm lighting, vintage microphone in focus, headphones, acoustic panels. Warm color temperature with orange/amber lighting accents. Creates aspirational, professional atmosphere while remaining inviting.

**Card Thumbnails:** Generated podcast episodes display abstract waveform patterns or topic-themed artwork (can use gradient backgrounds with wave patterns as default).

## Responsive Behavior
**Mobile:**
- Single column library
- Stacked creation inputs
- Simplified voice picker (dropdown instead of grid)
- Full-width player controls

**Tablet (md:):**
- 2-column library
- Side-by-side duration/voice selectors

**Desktop (lg:+):**
- 3-column library
- Horizontal player controls
- Feature grid fully expanded

## Accessibility
- Audio player keyboard controls (spacebar play/pause, arrow keys seek)
- ARIA labels on all player controls
- Focus indicators with high contrast
- Alt text for all podcast thumbnails
- Screen reader announcements for generation progress
- Skip-to-content link for navigation

## Interaction Patterns
- Click podcast card: Expands inline player or opens modal with full player
- Waveform visualization syncs with audio playback
- Smooth transitions for all state changes (duration-300)
- Toast notifications for generation complete/errors (top-right)
- Auto-play option after generation completes
- Download provides MP3 file with embedded metadata

## Special Considerations
- **Optimistic UI:** Show generating skeleton immediately
- **Queue System:** Display position if generation is queued
- **Error Recovery:** Offer "Try Again" with same prompt on failure
- **Storage:** Display newest first, with filter/sort options (date, duration, title)
- **Sharing:** Generate shareable link with embedded player
- **Credits Display:** Clear indication of remaining generation credits

This design creates a warm, professional podcast creation experience where users feel empowered to create broadcast-quality content effortlessly. The orange/amber palette energizes the interface while maintaining clarity and professionalism.