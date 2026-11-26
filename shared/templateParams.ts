import { z } from 'zod';

/**
 * Discriminated unions for template-specific parameters
 * Eliminates Record<string, any> and provides type safety
 */

// Base template params (shared by all)
export const baseTemplateParams = z.object({
  topic: z.string().optional(),
  durationMinutes: z.number(),
  languageComplexity: z.number(),
  numPeople: z.number(),
  podcastStyle: z.string(),
  timeFrame: z.string(),
  coHostPersonality: z.string().optional(),
  podcastMood: z.string().optional(),
  language: z.string(),
});

// News-specific parameters
export const newsTemplateParams = baseTemplateParams.extend({
  type: z.literal('news'),
  newsCategory: z.string(),
  newsFormat: z.enum(['anchor', 'debate', 'casual']),
  timeRange: z.enum(['24h', 'week', 'month']),
});

// Documents-specific parameters
export const documentsTemplateParams = baseTemplateParams.extend({
  type: z.literal('documents'),
  summaryType: z.enum(['executive', 'detailed', 'educational']),
  summaryDepth: z.number().min(1).max(5),
  documentContent: z.string().optional(),
});

// Sports-specific parameters
export const sportsTemplateParams = baseTemplateParams.extend({
  type: z.literal('sports'),
  sportType: z.string(),
  team: z.string().optional(),
  league: z.string().optional(),
  format: z.enum(['recap', 'analysis', 'preview']),
});

// TeachMe-specific parameters
export const teachMeTemplateParams = baseTemplateParams.extend({
  type: z.literal('teachme'),
});

// Events-specific parameters
export const eventsTemplateParams = baseTemplateParams.extend({
  type: z.literal('events'),
  eventName: z.string(),
  eventType: z.string(),
  eventDate: z.string().optional(),
  venue: z.string().optional(),
});

// Stories-specific parameters
export const storiesTemplateParams = baseTemplateParams.extend({
  type: z.literal('stories'),
  storyGenre: z.string(),
  characters: z.string().optional(),
});

// Medical-specific parameters
export const medicalTemplateParams = baseTemplateParams.extend({
  type: z.literal('medical'),
  condition: z.string(),
  detailLevel: z.number().min(1).max(5),
});

// Custom template parameters
export const customTemplateParams = baseTemplateParams.extend({
  type: z.literal('custom'),
});

// Discriminated union of all template params
export const templateParamsSchema = z.discriminatedUnion('type', [
  newsTemplateParams,
  documentsTemplateParams,
  sportsTemplateParams,
  teachMeTemplateParams,
  eventsTemplateParams,
  storiesTemplateParams,
  medicalTemplateParams,
  customTemplateParams,
]);

export type NewsTemplateParams = z.infer<typeof newsTemplateParams>;
export type DocumentsTemplateParams = z.infer<typeof documentsTemplateParams>;
export type SportsTemplateParams = z.infer<typeof sportsTemplateParams>;
export type TeachMeTemplateParams = z.infer<typeof teachMeTemplateParams>;
export type EventsTemplateParams = z.infer<typeof eventsTemplateParams>;
export type StoriesTemplateParams = z.infer<typeof storiesTemplateParams>;
export type MedicalTemplateParams = z.infer<typeof medicalTemplateParams>;
export type CustomTemplateParams = z.infer<typeof customTemplateParams>;

export type TemplateParams = z.infer<typeof templateParamsSchema>;
