import { z } from 'zod';

/**
 * Common query parameter validation schemas
 */

/**
 * Pagination schema for list endpoints
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});

/**
 * ID parameter schema
 */
export const idParamSchema = z.object({
  id: z.string().uuid('Invalid ID format')
});

/**
 * Optional search query schema
 */
export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  query: z.string().min(1).max(200).optional()
});

/**
 * Sort order schema
 */
export const sortOrderSchema = z.object({
  sort: z.enum(['asc', 'desc']).default('desc'),
  sortBy: z.string().optional()
});

/**
 * Boolean query parameter (handles string 'true'/'false')
 */
export const booleanQuerySchema = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform(val => val === 'true')
]);

/**
 * Trending topics category schema
 * Categories based on research of most popular news topics people consume:
 * - Business: economy, markets, CEO news, corporate (highest demand)
 * - Health: wellness, medical news, public health
 * - World: international news, global affairs
 * - Culture: lifestyle, food, travel, social trends
 * - Crime: true crime (extremely popular for podcasts)
 */
export const trendingCategorySchema = z.object({
  category: z.enum(['all', 'tech', 'sports', 'politics', 'entertainment', 'science', 'business', 'health', 'world', 'culture', 'crime']).default('all')
});

/**
 * Public podcasts query schema (with sorting and filtering)
 * filterByTemplate values MUST match database template_category values exactly
 */
export const publicPodcastsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(30),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z.enum(['listens', 'date', 'duration', 'newest', 'popular', 'trending']).default('newest'),
  // Values match database template_category: custom, events, news, sports, teachme, stories, medical, documents, summarize
  filterByTemplate: z.enum(['all', 'news', 'sports', 'custom', 'teachme', 'stories', 'events', 'medical', 'documents', 'summarize']).optional(),
  // slim=1/true skips engagement/comment enrichment for fast initial tile render
  slim: z.string().optional().transform(v => v === '1' || v === 'true').default(''),
});

export type PaginationParams = z.infer<typeof paginationSchema>;
export type TrendingCategoryParams = z.infer<typeof trendingCategorySchema>;
export type PublicPodcastsQueryParams = z.infer<typeof publicPodcastsQuerySchema>;
