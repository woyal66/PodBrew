import type { GeneratedPodcast } from "@shared/schema";

type RegenerateToast = (input: {
  title: string;
  description: string;
  variant?: "default" | "destructive";
}) => void;

export type RegenerateResult =
  | { ok: true }
  | { ok: false; reason: "document" | "no-topic" };

/**
 * Subset of the original generation parameters we re-seed the Create form
 * with. The full row in the database has many more fields (research notes,
 * voice assignments, etc.), but only this subset round-trips through the
 * "Brew again" flow. Every field is optional because:
 *
 *   - older podcasts may pre-date a given option,
 *   - the slim list payload omits `generationParams` entirely,
 *   - and the lazy-fetched full row may legitimately be `null`.
 */
interface RegenerateGenerationParams {
  topic?: string;
  templateCategory?: string;
  durationMinutes?: number;
  numPeople?: number;
  podcastStyle?: string;
  coHostPersonality?: string;
  podcastMood?: string;
  languageComplexity?: number;
  timeFrame?: string;
  language?: string;
}

/** Type guard: only accept plain objects (not arrays / null / primitives). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Project an unknown blob (the raw `generationParams` JSON column or a
 * `/api/podcasts/:id` response field) onto the typed shape we care about,
 * keeping a value only when it has the expected primitive type. Anything
 * unexpected becomes `undefined` so the caller's `||` defaults take over.
 */
function pickRegenerateParams(value: unknown): RegenerateGenerationParams {
  if (!isPlainObject(value)) return {};
  const v = value;
  const str = (key: string): string | undefined =>
    typeof v[key] === "string" ? (v[key] as string) : undefined;
  const num = (key: string): number | undefined =>
    typeof v[key] === "number" && Number.isFinite(v[key])
      ? (v[key] as number)
      : undefined;
  return {
    topic: str("topic"),
    templateCategory: str("templateCategory"),
    durationMinutes: num("durationMinutes"),
    numPeople: num("numPeople"),
    podcastStyle: str("podcastStyle"),
    coHostPersonality: str("coHostPersonality"),
    podcastMood: str("podcastMood"),
    languageComplexity: num("languageComplexity"),
    timeFrame: str("timeFrame"),
    language: str("language"),
  };
}

/**
 * Seed the Create form with this podcast's original settings and route the
 * user to it. The slim Library list payload no longer carries
 * `generationParams` (Task #102), so when it's missing we lazily fetch the
 * full row via `GET /api/podcasts/:id` before seeding. Detail page rows
 * still carry `generationParams` directly — for them this is a no-op.
 */
export async function regenerateFromPodcast(
  podcast: GeneratedPodcast,
  opts: { setLocation: (path: string) => void; toast: RegenerateToast },
): Promise<RegenerateResult> {
  if (podcast.templateCategory === "documents") {
    opts.toast({
      title: "Cannot regenerate",
      description:
        "Document summary podcasts require uploading a new document.",
      variant: "destructive",
    });
    return { ok: false, reason: "document" };
  }

  let params: RegenerateGenerationParams = pickRegenerateParams(
    podcast.generationParams,
  );

  // Slim list rows omit `generationParams`. If we got nothing useful from
  // the row in hand, fetch the full record once.
  const seemsEmpty =
    !params.topic &&
    !params.templateCategory &&
    params.durationMinutes === undefined &&
    params.numPeople === undefined;
  if (seemsEmpty) {
    try {
      const res = await fetch(`/api/podcasts/${podcast.id}`, {
        credentials: "include",
      });
      if (res.ok) {
        const full: unknown = await res.json();
        const fullParams = isPlainObject(full)
          ? (full as { generationParams?: unknown }).generationParams
          : undefined;
        params = pickRegenerateParams(fullParams);
      }
    } catch {
      // Network/parse failure → fall through to topic-only seed below.
    }
  }

  const topic = params.topic || podcast.topic;
  if (!topic) {
    opts.toast({
      title: "Cannot regenerate",
      description: "No topic available for this podcast.",
      variant: "destructive",
    });
    return { ok: false, reason: "no-topic" };
  }

  const regenerateData = {
    templateCategory:
      params.templateCategory || podcast.templateCategory || "custom",
    topic,
    durationMinutes: params.durationMinutes ?? 2,
    numPeople: params.numPeople ?? 2,
    podcastStyle: params.podcastStyle || "conversational",
    coHostPersonality: params.coHostPersonality || "casual",
    podcastMood: params.podcastMood || "balanced",
    languageComplexity: params.languageComplexity ?? 5,
    timeFrame: params.timeFrame || "pastMonth",
    language: params.language || "en",
  };

  try {
    localStorage.setItem(
      "podbrewRegenerateParams",
      JSON.stringify(regenerateData),
    );
  } catch {
    // localStorage may be unavailable (private mode, quota); the in-app
    // event below is still useful when already on the home page.
  }

  const isOnHomePage =
    window.location.pathname === "/" || window.location.pathname === "";
  if (isOnHomePage) {
    window.dispatchEvent(new CustomEvent("podbrew-regenerate"));
  } else {
    opts.setLocation("/");
  }

  opts.toast({
    title: "Ready to regenerate",
    description: "Form pre-filled with this podcast's settings.",
  });

  return { ok: true };
}
