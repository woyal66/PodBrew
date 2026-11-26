import { z } from "zod";
import type { TemplateCategory } from "@shared/schema";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Construction } from "lucide-react";
import { NewsTemplateForm } from "@/components/forms/NewsTemplateForm";
import { DocumentTemplateForm as DocumentsTemplateForm } from "@/components/forms/DocumentTemplateForm";
import { SportsTemplateForm } from "@/components/forms/SportsTemplateForm";
import { TeachMeTemplateForm } from "@/components/forms/TeachMeTemplateForm";
import { EventTemplateForm as EventsTemplateForm } from "@/components/forms/EventTemplateForm";
import { StoryTemplateForm as StoriesTemplateForm } from "@/components/forms/StoryTemplateForm";
import { MedicalTemplateForm } from "@/components/forms/MedicalTemplateForm";
import { DeepDiveForm } from "@/components/forms/DeepDiveForm";

// Base schema for all templates
export const baseTemplateSchema = z.object({
  durationMinutes: z.number().min(2).max(60),
  languageComplexity: z.number().min(1).max(10),
  numPeople: z.number().min(1).max(5),
  podcastStyle: z.string(),
  timeFrame: z.string(),
  coHostPersonality: z.string().optional(),
  podcastMood: z.string().optional(),
  language: z.string(),
  selectedVoicePool: z.array(z.string()),
  assignedVoices: z.array(z.string()),
});

// Custom template schema (existing form)
export const customTemplateSchema = baseTemplateSchema.extend({
  topic: z.string().min(1),
});

// News template schema
export const newsTemplateSchema = baseTemplateSchema.extend({
  topic: z.string().min(1),
  newsCategory: z.string(),
  newsFormat: z.enum(['anchor', 'debate', 'casual']),
  timeRange: z.enum(['24h', 'week', 'month']),
});

// Documents template schema
export const documentsTemplateSchema = baseTemplateSchema.extend({
  documentFile: z.instanceof(File).optional(),
  documentUrl: z.string().optional(),
  summaryType: z.enum(['executive', 'detailed', 'educational']),
  summaryDepth: z.number().min(1).max(5),
});

// Sports template schema
export const sportsTemplateSchema = baseTemplateSchema.extend({
  sportType: z.string(),
  team: z.string().optional(),
  league: z.string().optional(),
  format: z.enum(['recap', 'analysis', 'preview']),
});

// Teach Me template schema
export const teachmeTemplateSchema = baseTemplateSchema.extend({
  topic: z.string().min(1, "Please enter what you'd like to learn about"),
});

// Events template schema
export const eventsTemplateSchema = baseTemplateSchema.extend({
  eventName: z.string().min(1),
  eventType: z.string(),
  eventDate: z.string().optional(),
  venue: z.string().optional(),
});

// Stories template schema (Audiobook)
export const storiesTemplateSchema = baseTemplateSchema.extend({
  storyGenre: z.string(),
  characters: z.string().optional(),
});

// Medical template schema
export const medicalTemplateSchema = baseTemplateSchema.extend({
  condition: z.string().min(1),
  detailLevel: z.number().min(1).max(5),
  disclaimer: z.boolean(),
});

// Placeholder component for templates under development
function ComingSoonTemplate({ templateName }: { templateName: string }) {
  return (
    <Alert className="mb-6">
      <Construction className="h-4 w-4" />
      <AlertDescription>
        <strong>{templateName}</strong> mode is coming soon! This specialized template is currently under development. 
        For now, try the Custom Topic template to create podcasts about any subject.
      </AlertDescription>
    </Alert>
  );
}

// Template form components
export const CustomTemplateForm = () => null; // Existing form rendered by PodcastGenerator

// Regenerate params interface
export interface RegenerateParams {
  [key: string]: any;
}

// Template form props interface
export interface TemplateFormProps {
  topic: string;
  setTopic: (topic: string) => void;
  durationMinutes: number;
  setDurationMinutes: (duration: number) => void;
  languageComplexity: number;
  setLanguageComplexity: (complexity: number) => void;
  numPeople: number;
  setNumPeople: (num: number) => void;
  podcastStyle: string;
  setPodcastStyle: (style: string) => void;
  timeFrame: string;
  setTimeFrame: (frame: string) => void;
  coHostPersonality: string;
  setCoHostPersonality: (personality: string) => void;
  podcastMood: string;
  setPodcastMood: (mood: string) => void;
  language: string;
  setLanguage: (lang: string) => void;
  selectedVoicePool: any[];
  setSelectedVoicePool: (voices: any[]) => void;
  assignedVoices: any[];
  selectedVoiceIds: string[];
  selectedVoices: any[];
  setShowVoiceModal: (show: boolean) => void;
  creditsData?: { credits: number; plan: string };
  isListening: boolean;
  onVoiceInput: () => void;
  onEnhanceTopic: () => void;
  onToggleLocation?: () => void;
  isEnhancing: boolean;
  onSubmit: (e: React.FormEvent) => void;
  isGenerating: boolean;
  topicRef?: React.RefObject<HTMLTextAreaElement>;
  regenerateParams?: RegenerateParams;
  onRegenerateUsed?: () => void;
  locationEnabled?: boolean;
  locationCity?: string | null;
  onQuickBrew?: () => void;
  showQuickBrew?: boolean;
  isQuickBrewLoading?: boolean;
  brewProgress?: number;
  brewStatus?: string;
}

// Base default values shared across all templates
const BASE_DEFAULTS = {
  language: 'en',
  selectedVoicePool: [],
  languageComplexity: 5,
  podcastMood: 'balanced',
} as const;

// Template registry type
export interface TemplateConfig {
  id: TemplateCategory;
  name: string;
  schema: z.ZodSchema;
  defaultValues: Record<string, any>;
  FormComponent: React.ComponentType<TemplateFormProps>;
  requiresFileUpload?: boolean;
  requiresApiKey?: boolean;
}

// Template registry
export const TEMPLATE_REGISTRY: Record<TemplateCategory, TemplateConfig> = {
  custom: {
    id: 'custom',
    name: 'Custom Topic',
    schema: customTemplateSchema,
    defaultValues: {
      ...BASE_DEFAULTS,
      topic: '',
      durationMinutes: 2,
      numPeople: 2,
      podcastStyle: 'conversational',
      timeFrame: 'pastMonth',
      assignedVoices: [],
    },
    FormComponent: CustomTemplateForm,
  },
  news: {
    id: 'news',
    name: 'News Briefing',
    schema: newsTemplateSchema,
    defaultValues: {
      ...BASE_DEFAULTS,
      topic: '',
      newsCategory: 'general',
      newsFormat: 'anchor' as const,
      timeRange: '24h' as const,
      durationMinutes: 2,
      numPeople: 1,
      podcastStyle: 'news',
      timeFrame: 'past24h',
      coHostPersonality: 'academic',
      podcastMood: 'serious',
      assignedVoices: [],
    },
    FormComponent: NewsTemplateForm,
  },
  documents: {
    id: 'documents',
    name: 'Summarise',
    schema: documentsTemplateSchema,
    defaultValues: {
      ...BASE_DEFAULTS,
      summaryType: 'executive' as const,
      summaryDepth: 3,
      durationMinutes: 5,
      languageComplexity: 7,
      numPeople: 1,
      podcastStyle: 'narrative',
      timeFrame: 'allTime',
      coHostPersonality: 'academic',
      assignedVoices: [],
    },
    FormComponent: DocumentsTemplateForm,
    requiresFileUpload: true,
  },
  sports: {
    id: 'sports',
    name: 'Sports Recap',
    schema: sportsTemplateSchema,
    defaultValues: {
      ...BASE_DEFAULTS,
      sportType: 'football',
      format: 'recap' as const,
      durationMinutes: 3,
      numPeople: 2,
      podcastStyle: 'conversational',
      timeFrame: 'past24h',
      assignedVoices: [],
    },
    FormComponent: SportsTemplateForm,
    requiresApiKey: true,
  },
  teachme: {
    id: 'teachme',
    name: 'Teach Me',
    schema: teachmeTemplateSchema,
    defaultValues: {
      ...BASE_DEFAULTS,
      topic: '',
      durationMinutes: 10,
      numPeople: 1,
      podcastStyle: 'conversational',
      timeFrame: 'allTime',
      coHostPersonality: 'academic',
      assignedVoices: [],
    },
    FormComponent: TeachMeTemplateForm,
  },
  events: {
    id: 'events',
    name: 'Event Information',
    schema: eventsTemplateSchema,
    defaultValues: {
      ...BASE_DEFAULTS,
      eventName: '',
      eventType: 'conference',
      durationMinutes: 3,
      numPeople: 1,
      podcastStyle: 'conversational',
      timeFrame: 'next24h',
      podcastMood: 'energetic',
      assignedVoices: [],
    },
    FormComponent: EventsTemplateForm,
  },
  stories: {
    id: 'stories',
    name: 'Audiobook',
    schema: storiesTemplateSchema,
    defaultValues: {
      ...BASE_DEFAULTS,
      storyGenre: 'fantasy',
      durationMinutes: 10,
      languageComplexity: 6,
      numPeople: 1,
      podcastStyle: 'narrative',
      timeFrame: 'allTime',
      coHostPersonality: 'storyteller',
      assignedVoices: [],
    },
    FormComponent: StoriesTemplateForm,
  },
  medical: {
    id: 'medical',
    name: 'Ask AI Doctor',
    schema: medicalTemplateSchema,
    defaultValues: {
      ...BASE_DEFAULTS,
      condition: '',
      detailLevel: 3,
      disclaimer: false,
      durationMinutes: 6,
      languageComplexity: 7,
      numPeople: 1,
      podcastStyle: 'conversational',
      timeFrame: 'allTime',
      coHostPersonality: 'academic',
      assignedVoices: [],
    },
    FormComponent: MedicalTemplateForm,
  },
  deepdive: {
    id: 'deepdive',
    name: 'Deep Dive',
    schema: baseTemplateSchema,
    defaultValues: {
      ...BASE_DEFAULTS,
      durationMinutes: 10,
      numPeople: 2,
      podcastStyle: 'conversational',
      timeFrame: 'allTime',
      assignedVoices: [],
    },
    // DeepDiveForm is rendered directly by the home page — this is a sentinel
    FormComponent: DeepDiveForm as any,
  },
};

// Helper to get template config
export function getTemplateConfig(template: TemplateCategory): TemplateConfig {
  return TEMPLATE_REGISTRY[template];
}
