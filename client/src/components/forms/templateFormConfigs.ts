import { type LucideIcon, Globe, Trophy, Calendar, BookOpen, Stethoscope, FileText, BookMarked, Mic } from "lucide-react";

export interface TemplateFormConfig {
  templateId: 'custom' | 'news' | 'sports' | 'events' | 'teachme' | 'medical' | 'documents' | 'stories';
  
  // Topic section
  topicLabel: string;
  topicDescription: string;
  topicPlaceholder: string;
  topicIcon: LucideIcon;
  topicTestId: string;
  
  // Submit button
  submitButtonText: string;
  submitButtonGeneratingText: string;
  
  // Optional overrides for common controls
  styleOptions?: Array<{ value: string; label: string; description?: string }>;
  timeFrameOptions?: Array<{ value: string; label: string }>;
  personalityOptions?: Array<{ value: string; label: string; description?: string }>;
  
  // Control visibility
  showCoHostPersonality?: boolean;
  showTimeFrame?: boolean;
  showPodcastStyle?: boolean;
  showLocationToggle?: boolean;
  
  // Default time frame when showTimeFrame is false
  defaultTimeFrame?: string;
  
  // Default podcast style (if different from "conversational")
  defaultPodcastStyle?: string;
}

// Custom Template Configuration (Full Customization)
export const customTemplateConfig: TemplateFormConfig = {
  templateId: 'custom',
  topicLabel: 'Podcast Topic',
  topicDescription: 'Enter any topic you want to create a podcast about. Be as specific or as broad as you like.',
  topicPlaceholder: "Enter your podcast topic... (e.g., 'The history of jazz music' or 'Tips for growing tomatoes')",
  topicIcon: Mic,
  topicTestId: 'input-topic',
  submitButtonText: 'Brew Custom Podcast',
  submitButtonGeneratingText: 'Brewing Custom Podcast...',
};

// News Template Configuration
export const newsTemplateConfig: TemplateFormConfig = {
  templateId: 'news',
  topicLabel: 'News Topic',
  topicDescription: 'What news would you like covered? Customize your briefing with any topic or event.',
  topicPlaceholder: "Enter your news topic here... (e.g., 'latest AI breakthroughs', 'climate change updates', 'tech industry news')",
  topicIcon: Globe,
  topicTestId: 'input-news-topic',
  submitButtonText: 'Brew News Briefing',
  submitButtonGeneratingText: 'Brewing News...',
  defaultPodcastStyle: 'news',
  timeFrameOptions: [
    { value: "past24h", label: "Last 24 Hours" },
    { value: "pastWeek", label: "Past Week" },
    { value: "pastMonth", label: "Past Month" },
    { value: "pastYear", label: "Past Year" },
    { value: "allTime", label: "Historical" },
  ],
  personalityOptions: [
    { value: "executive", label: "Professional", description: "Formal, authoritative tone" },
    { value: "casual", label: "Conversational", description: "Friendly, approachable style" },
    { value: "investigative", label: "Investigative", description: "Critical, analytical approach" },
  ],
};

// Sports Template Configuration
export const sportsTemplateConfig: TemplateFormConfig = {
  templateId: 'sports',
  topicLabel: 'Sports Event or Team',
  topicDescription: "Enter the game, match, team, or sports event (e.g., \"Lakers vs Celtics\", \"Premier League highlights\").",
  topicPlaceholder: "Enter sports event or team (e.g., 'Manchester United latest match')",
  topicIcon: Trophy,
  topicTestId: 'input-sports-topic',
  submitButtonText: 'Brew Sports Cast',
  submitButtonGeneratingText: 'Brewing Sports...',
  styleOptions: [
    { value: "recap", label: "Game Recap", description: "Post-game highlights and analysis" },
    { value: "preview", label: "Game Preview", description: "Pre-game analysis and predictions" },
    { value: "analysis", label: "Deep Analysis", description: "Tactical breakdown" },
  ],
  timeFrameOptions: [
    { value: "past24h", label: "Last 24 Hours" },
    { value: "pastWeek", label: "Past Week" },
    { value: "pastMonth", label: "Past Month" },
  ],
  showPodcastStyle: false,
};

// Events Template Configuration
export const eventsTemplateConfig: TemplateFormConfig = {
  templateId: 'events',
  topicLabel: 'Event Name',
  topicDescription: 'Enter the event name or description (e.g., "TechCrunch Disrupt 2024", "Coachella Music Festival").',
  topicPlaceholder: "Enter event name (e.g., 'Comic Con 2024 San Diego')",
  topicIcon: Calendar,
  topicTestId: 'input-event-topic',
  submitButtonText: 'Brew Event Guide',
  submitButtonGeneratingText: 'Brewing Event...',
  styleOptions: [
    { value: "recap", label: "Event Recap", description: "Post-event summary and highlights" },
    { value: "preview", label: "Event Preview", description: "What to expect before the event" },
    { value: "guide", label: "Attendee Guide", description: "Practical information for attendees" },
  ],
  // Default timeFrame options - will be overridden based on eventFormat
  timeFrameOptions: [
    { value: "past24h", label: "Last 24 Hours" },
    { value: "pastWeek", label: "Past Week" },
    { value: "pastMonth", label: "Past Month" },
  ],
  showPodcastStyle: false,
};

// Teach Me Template Configuration
export const teachMeTemplateConfig: TemplateFormConfig = {
  templateId: 'teachme',
  topicLabel: 'What would you like to learn?',
  topicDescription: 'Enter any topic, concept, or skill you want to understand (e.g., "quantum physics", "how to code in Python", "ancient Rome").',
  topicPlaceholder: "Enter what you'd like to learn (e.g., 'Explain blockchain technology')",
  topicIcon: BookOpen,
  topicTestId: 'input-teachme-topic',
  submitButtonText: 'Brew Learning Session',
  submitButtonGeneratingText: 'Brewing Lesson...',
  styleOptions: [
    { value: "tutor", label: "Tutor", description: "Patient step-by-step instruction" },
    { value: "lecturer", label: "Lecturer", description: "Formal academic presentation" },
    { value: "conversational", label: "Conversational", description: "Natural, friendly discussion" },
    { value: "coach", label: "Coach", description: "Motivational action-oriented guidance" },
  ],
  showTimeFrame: false,
  showLocationToggle: false,
};

// Medical Template Configuration
export const medicalTemplateConfig: TemplateFormConfig = {
  templateId: 'medical',
  topicLabel: 'Medical Topic or Condition',
  topicDescription: 'Enter a medical condition, treatment, or health topic to explore.',
  topicPlaceholder: "Enter medical topic (e.g., 'diabetes management', 'cardiovascular health')",
  topicIcon: Stethoscope,
  topicTestId: 'input-medical-topic',
  submitButtonText: 'Brew Medical Brief',
  submitButtonGeneratingText: 'Brewing Medical...',
  styleOptions: [
    { value: "overview", label: "Overview", description: "General introduction" },
    { value: "symptoms", label: "Symptoms & Diagnosis", description: "Signs and identification" },
    { value: "treatment", label: "Treatment Options", description: "Management approaches" },
    { value: "prevention", label: "Prevention", description: "Risk reduction strategies" },
  ],
  showPodcastStyle: false,
  showTimeFrame: false,
  showLocationToggle: false,
};

// Documents Template Configuration
export const documentsTemplateConfig: TemplateFormConfig = {
  templateId: 'documents',
  topicLabel: 'Summarise Instructions',
  topicDescription: 'Provide additional context or instructions for how to summarize your document.',
  topicPlaceholder: "Optional: Add specific instructions (e.g., 'Focus on financial data', 'Summarize key findings')",
  topicIcon: FileText,
  topicTestId: 'input-document-topic',
  submitButtonText: 'Brew Summary',
  submitButtonGeneratingText: 'Brewing Summary...',
  styleOptions: [
    { value: "executive-briefing", label: "Executive Summary", description: "Brief, high-level overview" },
    { value: "conversational", label: "Detailed Analysis", description: "Comprehensive breakdown" },
    { value: "tutor", label: "Chapter by Chapter", description: "Sequential walkthrough" },
  ],
  showPodcastStyle: false,
  showLocationToggle: false,
};

// Stories Template Configuration
export const storiesTemplateConfig: TemplateFormConfig = {
  templateId: 'stories',
  topicLabel: 'Story Idea or Prompt',
  topicDescription: 'Describe the story you want to create, including characters, setting, or plot ideas.',
  topicPlaceholder: "Enter your story idea (e.g., 'A detective solving a mystery in a futuristic city')",
  topicIcon: BookMarked,
  topicTestId: 'input-story-topic',
  submitButtonText: 'Brew Story',
  submitButtonGeneratingText: 'Brewing Story...',
  styleOptions: [
    { value: "narrative", label: "Narrative", description: "Story-driven presentation" },
    { value: "conversational", label: "Conversational", description: "Natural, friendly discussion" },
  ],
  showTimeFrame: false,
  showLocationToggle: false,
};

// Export all configs as a map for easy lookup
export const TEMPLATE_CONFIGS: Record<string, TemplateFormConfig> = {
  news: newsTemplateConfig,
  sports: sportsTemplateConfig,
  events: eventsTemplateConfig,
  teachme: teachMeTemplateConfig,
  medical: medicalTemplateConfig,
  documents: documentsTemplateConfig,
  stories: storiesTemplateConfig,
};
