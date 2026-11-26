import OpenAI from 'openai';
import pLimit from 'p-limit';
import pRetry, { AbortError } from 'p-retry';

// LLM Router Service - Routes tasks to optimal models for cost efficiency
// Uses Replit AI Integrations for OpenRouter (DeepSeek) - no separate API key needed

// Model configurations with pricing (per 1M tokens)
const MODEL_PRICING = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'deepseek/deepseek-chat-v3.1': { input: 0.55, output: 2.19 },
  'deepseek/deepseek-r1-0528-qwen3-8b': { input: 0.55, output: 2.19 },
} as const;

type ModelId = keyof typeof MODEL_PRICING;

// Task types that determine model routing
export type LLMTaskType = 
  | 'script_generation'    // Main podcast script - DeepSeek R1 (bulk, cost-effective)
  | 'title_generation'     // Short title - GPT-4o-mini (simple)
  | 'topic_enhancement'    // Quality critical - GPT-4o (keep high quality)
  | 'syllabus_generation'  // Course syllabus - DeepSeek R1
  | 'content_summary'      // Document summarization - DeepSeek R1
  | 'research_format'      // Format research data - DeepSeek R1
  | 'metadata'             // Simple metadata - GPT-4o-mini
  | 'critical';            // Critical quality tasks - GPT-4o

// Model routing configuration
const TASK_MODEL_ROUTING: Record<LLMTaskType, { primary: ModelId; fallback: ModelId }> = {
  script_generation: { primary: 'deepseek/deepseek-chat-v3.1', fallback: 'gpt-4o' },
  title_generation: { primary: 'gpt-4o-mini', fallback: 'gpt-4o' },
  topic_enhancement: { primary: 'gpt-4o', fallback: 'gpt-4o' }, // Keep on GPT-4o for quality
  syllabus_generation: { primary: 'deepseek/deepseek-chat-v3.1', fallback: 'gpt-4o' },
  content_summary: { primary: 'deepseek/deepseek-chat-v3.1', fallback: 'gpt-4o' },
  research_format: { primary: 'deepseek/deepseek-chat-v3.1', fallback: 'gpt-4o' },
  metadata: { primary: 'gpt-4o-mini', fallback: 'gpt-4o-mini' },
  critical: { primary: 'gpt-4o', fallback: 'gpt-4o' },
};

// OpenAI client (for GPT-4o and GPT-4o-mini)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// OpenRouter client for DeepSeek (via Replit AI Integrations)
const openrouter = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY,
});

// Rate limiter for concurrent requests
const requestLimit = pLimit(3);

// Cost tracking
interface CostEntry {
  timestamp: number;
  taskType: LLMTaskType;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  duration: number;
}

const costHistory: CostEntry[] = [];
const MAX_COST_HISTORY = 1000;

// Helper to check if OpenRouter is available
function isOpenRouterAvailable(): boolean {
  return !!(process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL && process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY);
}

// Helper to check if error is rate limit
function isRateLimitError(error: any): boolean {
  const errorMsg = error?.message || String(error);
  return (
    errorMsg.includes('429') ||
    errorMsg.includes('RATELIMIT_EXCEEDED') ||
    errorMsg.toLowerCase().includes('quota') ||
    errorMsg.toLowerCase().includes('rate limit')
  );
}

// Calculate cost for a request
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model as ModelId];
  if (!pricing) return 0;
  return (inputTokens * pricing.input / 1_000_000) + (outputTokens * pricing.output / 1_000_000);
}

// Get the appropriate client for a model
function getClientForModel(model: string): OpenAI {
  if (model.startsWith('deepseek/')) {
    return openrouter;
  }
  return openai;
}

// Main routing function
export interface LLMRequest {
  taskType: LLMTaskType;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' | 'text' };
}

export interface LLMResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  duration: number;
  usedFallback: boolean;
}

export async function routeLLMRequest(request: LLMRequest): Promise<LLMResponse> {
  const startTime = Date.now();
  const routing = TASK_MODEL_ROUTING[request.taskType];
  
  // Determine which model to use
  let primaryModel = routing.primary;
  let fallbackModel = routing.fallback;
  
  // If OpenRouter not available and primary is DeepSeek, use fallback directly
  if (primaryModel.startsWith('deepseek/') && !isOpenRouterAvailable()) {
    console.log(`[LLM Router] OpenRouter not available, using fallback ${fallbackModel} for ${request.taskType}`);
    primaryModel = fallbackModel;
  }

  const attemptRequest = async (model: string): Promise<LLMResponse> => {
    const client = getClientForModel(model);
    
    const response = await client.chat.completions.create({
      model: model.startsWith('deepseek/') ? model : model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 8192,
      ...(request.responseFormat && { response_format: request.responseFormat }),
    });

    const content = response.choices[0]?.message?.content || '';
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const cost = calculateCost(model, inputTokens, outputTokens);
    const duration = Date.now() - startTime;

    return {
      content,
      model,
      inputTokens,
      outputTokens,
      cost,
      duration,
      usedFallback: false,
    };
  };

  try {
    // Try primary model with retries
    const result = await requestLimit(() =>
      pRetry(
        async () => {
          try {
            return await attemptRequest(primaryModel);
          } catch (error: any) {
            if (isRateLimitError(error)) {
              throw error; // Retry on rate limit
            }
            throw new AbortError(error); // Don't retry other errors
          }
        },
        {
          retries: 3,
          minTimeout: 1000,
          maxTimeout: 10000,
          factor: 2,
        }
      )
    );

    // Track cost
    trackCost(request.taskType, result);
    
    console.log(`[LLM Router] ${request.taskType} completed with ${result.model} in ${result.duration}ms ($${result.cost.toFixed(4)})`);
    return result;

  } catch (primaryError) {
    // Try fallback if primary fails
    if (primaryModel !== fallbackModel) {
      console.warn(`[LLM Router] Primary ${primaryModel} failed, trying fallback ${fallbackModel}:`, primaryError);
      
      try {
        const result = await attemptRequest(fallbackModel);
        result.usedFallback = true;
        
        trackCost(request.taskType, result);
        
        console.log(`[LLM Router] ${request.taskType} completed with fallback ${result.model} in ${result.duration}ms ($${result.cost.toFixed(4)})`);
        return result;
        
      } catch (fallbackError) {
        console.error(`[LLM Router] Both primary and fallback failed for ${request.taskType}`);
        throw fallbackError;
      }
    }
    
    throw primaryError;
  }
}

// Track cost entry
function trackCost(taskType: LLMTaskType, result: LLMResponse): void {
  costHistory.push({
    timestamp: Date.now(),
    taskType,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cost: result.cost,
    duration: result.duration,
  });

  // Keep history bounded
  if (costHistory.length > MAX_COST_HISTORY) {
    costHistory.splice(0, costHistory.length - MAX_COST_HISTORY);
  }
}

// Get cost statistics
export interface LLMStats {
  totalRequests: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgDuration: number;
  byModel: Record<string, { requests: number; cost: number; tokens: number }>;
  byTaskType: Record<string, { requests: number; cost: number }>;
  last24h: {
    requests: number;
    cost: number;
    savings: number; // Estimated savings vs all GPT-4o
  };
  openRouterAvailable: boolean;
}

export function getLLMStats(): LLMStats {
  const now = Date.now();
  const last24h = costHistory.filter(e => now - e.timestamp < 24 * 60 * 60 * 1000);
  
  const byModel: Record<string, { requests: number; cost: number; tokens: number }> = {};
  const byTaskType: Record<string, { requests: number; cost: number }> = {};
  
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalDuration = 0;
  
  for (const entry of costHistory) {
    totalCost += entry.cost;
    totalInputTokens += entry.inputTokens;
    totalOutputTokens += entry.outputTokens;
    totalDuration += entry.duration;
    
    if (!byModel[entry.model]) {
      byModel[entry.model] = { requests: 0, cost: 0, tokens: 0 };
    }
    byModel[entry.model].requests++;
    byModel[entry.model].cost += entry.cost;
    byModel[entry.model].tokens += entry.inputTokens + entry.outputTokens;
    
    if (!byTaskType[entry.taskType]) {
      byTaskType[entry.taskType] = { requests: 0, cost: 0 };
    }
    byTaskType[entry.taskType].requests++;
    byTaskType[entry.taskType].cost += entry.cost;
  }

  // Calculate savings (what it would have cost with all GPT-4o)
  let last24hCost = 0;
  let last24hGpt4oCost = 0;
  for (const entry of last24h) {
    last24hCost += entry.cost;
    // Calculate hypothetical GPT-4o cost
    last24hGpt4oCost += calculateCost('gpt-4o', entry.inputTokens, entry.outputTokens);
  }

  return {
    totalRequests: costHistory.length,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    avgDuration: costHistory.length > 0 ? totalDuration / costHistory.length : 0,
    byModel,
    byTaskType,
    last24h: {
      requests: last24h.length,
      cost: last24hCost,
      savings: last24hGpt4oCost - last24hCost,
    },
    openRouterAvailable: isOpenRouterAvailable(),
  };
}

// Convenience functions for common tasks
export async function generateWithDeepSeek(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number; jsonMode?: boolean }
): Promise<string> {
  const result = await routeLLMRequest({
    taskType: 'script_generation',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: options?.maxTokens ?? 8192,
    temperature: options?.temperature ?? 0.7,
    responseFormat: options?.jsonMode ? { type: 'json_object' } : undefined,
  });
  return result.content;
}

export async function generateTitle(
  topic: string,
  templateCategory: string
): Promise<string> {
  const result = await routeLLMRequest({
    taskType: 'title_generation',
    messages: [
      {
        role: 'system',
        content: `You are a podcast title expert. Create catchy, concise podcast titles that capture the essence of the content in maximum 8 words. The title should be engaging, memorable, and accurately represent the podcast topic. 

Rules:
- MAXIMUM 8 words
- Make it catchy and engaging
- Capture the core essence
- Use action words when appropriate
- Avoid generic words like "podcast" or "episode"
- Make it specific to the content

Examples:
- "AI Revolutionizing Healthcare: The Future is Here"
- "Bitcoin's Wild Ride Through 2024"
- "Climate Change Solutions That Actually Work"
- "The Truth About Modern Diet Trends"`
      },
      {
        role: 'user',
        content: `Generate a catchy podcast title (max 8 words) for this ${templateCategory} podcast:\n\n${topic}`
      }
    ],
    temperature: 0.8,
    maxTokens: 50,
  });
  
  let title = result.content.trim();
  title = title.replace(/^["']|["']$/g, '');
  
  const words = title.split(/\s+/);
  if (words.length > 8) {
    title = words.slice(0, 8).join(' ');
  }
  
  return title || topic.split(/\s+/).slice(0, 8).join(' ');
}

export async function enhanceTopicWithRouter(
  topic: string,
  templateCategory: string,
  style?: string,
  complexity?: string
): Promise<string> {
  const contextGuidance = templateCategory === 'news' 
    ? 'Focus on making it news-worthy and current'
    : templateCategory === 'teachme'
    ? 'Focus on educational aspects and learning objectives'
    : 'Focus on making it engaging and informative';

  const result = await routeLLMRequest({
    taskType: 'topic_enhancement',
    messages: [
      {
        role: 'system',
        content: 'You are an expert at transforming brief prompts into detailed, compelling podcast topic descriptions. You expand keywords into natural language and add valuable context in exactly 2-3 sentences.'
      },
      {
        role: 'user',
        content: `Transform this into a detailed podcast topic description (2-3 sentences):

Topic: ${topic}
Template: ${templateCategory}
${style ? `Style: ${style}` : ''}
${complexity ? `Complexity: ${complexity}` : ''}

Guidelines:
- ${contextGuidance}
- Make it actionable and clear what listeners will learn

Output only the enhanced topic description (2-3 sentences), nothing else.`
      }
    ],
    temperature: 0.7,
    maxTokens: 300,
  });

  const enhanced = result.content.trim();
  if (enhanced.length > 700 || enhanced.includes('I cannot') || enhanced.includes('I apologize')) {
    return topic;
  }
  
  return enhanced;
}

export { isOpenRouterAvailable };
