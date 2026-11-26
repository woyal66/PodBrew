/**
 * NotebookLM Podcast API integration
 *
 * Calls the Google Discovery Engine Podcast API to generate a
 * "Conversational Deep Dive" episode from a topic (and optional source URL).
 *
 * Required env vars:
 *   NOTEBOOKLM_API_ENABLED=true
 *   NOTEBOOKLM_PROJECT_ID=<gcp-project-id>
 *   GOOGLE_CLOUD_API_KEY  OR  GOOGLE_APPLICATION_CREDENTIALS
 */

const API_BASE = 'https://discoveryengine.googleapis.com';
const DEFAULT_POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface DeepDiveOptions {
  topic: string;
  sourceUrl?: string;
  /** Raw text content (e.g. extracted from an uploaded document) to include as source material */
  sourceText?: string;
}

interface LROResponse {
  name?: string;
  done?: boolean;
  error?: { code: number; message: string; status?: string };
  response?: {
    '@type'?: string;
    audioData?: string; // base64-encoded MP3
    audioUrl?: string;  // direct URL variant (spec may change)
  };
  metadata?: Record<string, unknown>;
}

/**
 * Resolve an auth credential for the Discovery Engine API.
 * Prefers API key; falls back to Application Default Credentials (ADC).
 */
async function resolveAuthHeader(): Promise<{ headerName: string; headerValue: string }> {
  const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
  if (apiKey) {
    return { headerName: 'X-Goog-Api-Key', headerValue: apiKey };
  }

  try {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const tokenResult = await client.getAccessToken();
    const token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;
    if (!token) throw new Error('ADC returned empty token');
    return { headerName: 'Authorization', headerValue: `Bearer ${token}` };
  } catch (adcErr) {
    throw new Error(
      `No valid Google auth found. Set GOOGLE_CLOUD_API_KEY or configure GOOGLE_APPLICATION_CREDENTIALS. (${adcErr instanceof Error ? adcErr.message : String(adcErr)})`
    );
  }
}

/**
 * Poll a Long-Running Operation until done, then return the MP3 buffer.
 */
async function pollLRO(
  operationName: string,
  auth: { headerName: string; headerValue: string },
  timeoutMs = DEFAULT_POLL_TIMEOUT_MS
): Promise<Buffer> {
  const pollUrl = `${API_BASE}/v1/${operationName}`;
  const headers: Record<string, string> = { [auth.headerName]: auth.headerValue };
  const start = Date.now();
  let backoff = 3_000;

  while (Date.now() - start < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, backoff));
    backoff = Math.min(Math.round(backoff * 1.5), 15_000);

    const res = await fetch(pollUrl, { headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`NotebookLM LRO poll failed (${res.status}): ${body}`);
    }

    const lro: LROResponse = await res.json();

    if (lro.error) {
      throw new Error(
        `NotebookLM generation error ${lro.error.code} (${lro.error.status ?? 'unknown'}): ${lro.error.message}`
      );
    }

    if (lro.done) {
      const audioData = lro.response?.audioData;
      if (audioData) {
        console.log('[NotebookLM] Generation complete — received base64 audio data');
        return Buffer.from(audioData, 'base64');
      }
      // Some variants return a direct URL
      const audioUrl = lro.response?.audioUrl;
      if (audioUrl) {
        console.log('[NotebookLM] Generation complete — downloading from audio URL');
        const dlRes = await fetch(audioUrl);
        if (!dlRes.ok) throw new Error(`Failed to download audio from ${audioUrl}: ${dlRes.status}`);
        return Buffer.from(await dlRes.arrayBuffer());
      }
      throw new Error('NotebookLM LRO marked done but contained no audio data');
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`[NotebookLM] Still generating… (${elapsed}s elapsed, next poll in ${Math.round(backoff / 1000)}s)`);
  }

  throw new Error(`NotebookLM generation timed out after ${Math.round(timeoutMs / 60_000)} minutes`);
}

/**
 * Generate a Conversational Deep Dive podcast via the NotebookLM API.
 * Returns a Buffer containing the MP3 audio.
 */
export async function generateDeepDivePodcast(options: DeepDiveOptions): Promise<Buffer> {
  const projectId = process.env.NOTEBOOKLM_PROJECT_ID;
  if (!projectId) {
    throw new Error('NOTEBOOKLM_PROJECT_ID is not configured');
  }

  const auth = await resolveAuthHeader();

  const requestBody: Record<string, unknown> = {
    topic: options.topic,
    output_config: { audio_format: 'MP3' },
  };

  const sources: Record<string, unknown>[] = [];
  if (options.sourceUrl) {
    sources.push({ uri: options.sourceUrl });
  }
  if (options.sourceText) {
    // NotebookLM accepts inline text via a `text` source field
    sources.push({ text: options.sourceText.slice(0, 200_000) }); // cap at 200k chars
  }
  if (sources.length > 0) {
    requestBody.sources = sources;
  }

  const generateUrl = `${API_BASE}/v1/projects/${projectId}/locations/global/podcasts:generate`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [auth.headerName]: auth.headerValue,
  };

  console.log(`[NotebookLM] Requesting deep dive for topic: "${options.topic.slice(0, 80)}"`);

  const res = await fetch(generateUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`NotebookLM API error (${res.status}): ${body}`);
  }

  const lro: LROResponse = await res.json();

  // Occasionally the API returns synchronously (very short content)
  if (lro.done) {
    const audioData = lro.response?.audioData;
    if (audioData) return Buffer.from(audioData, 'base64');
    const audioUrl = lro.response?.audioUrl;
    if (audioUrl) {
      const dlRes = await fetch(audioUrl);
      return Buffer.from(await dlRes.arrayBuffer());
    }
  }

  if (!lro.name) {
    throw new Error('NotebookLM API did not return an LRO operation name');
  }

  console.log(`[NotebookLM] LRO started: ${lro.name}`);
  return pollLRO(lro.name, auth);
}

/** Returns true when the NotebookLM feature is fully configured. */
export function isNotebookLMEnabled(): boolean {
  return (
    process.env.NOTEBOOKLM_API_ENABLED === 'true' &&
    Boolean(process.env.NOTEBOOKLM_PROJECT_ID) &&
    Boolean(process.env.GOOGLE_CLOUD_API_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS)
  );
}
