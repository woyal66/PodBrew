import { JSDOM, VirtualConsole } from "jsdom";
import { Readability, isProbablyReaderable } from "@mozilla/readability";

export interface ExtractedArticle {
  title: string;
  text: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  strategy: "readability" | "json-ld" | "next-data" | "regex-fallback";
}

export interface ExtractionResult {
  article: ExtractedArticle | null;
  paywallDetected: boolean;
  loginWallDetected: boolean;
}

const PAYWALL_HINTS = [
  /subscribe to (?:read|continue|keep reading)/i,
  /subscriber[- ]only/i,
  /this (?:article|story) is for (?:paid )?subscribers/i,
  /create a free account to (?:read|continue)/i,
  /sign in to read/i,
  /you've reached your (?:free )?article limit/i,
  /unlock (?:this|the full) (?:article|story)/i,
  /metered\s*paywall/i,
  /article\s*paywall/i,
];

const LOGIN_WALL_HINTS = [
  /please (?:sign in|log in) to (?:read|continue|view)/i,
  /log in to continue reading/i,
  /sign up to read/i,
];

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ""; }
    })
    .replace(/&#x([\da-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ""; }
    });
}

function htmlToText(html: string): string {
  // Replace block tags with newlines so paragraphs survive tag stripping.
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|figcaption)\s*>/gi, "\n")
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  return text
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildDom(html: string, url: string): JSDOM | null {
  try {
    const virtualConsole = new VirtualConsole();
    // Silence noisy "could not parse CSS" / resource warnings from JSDOM.
    virtualConsole.on("error", () => {});
    virtualConsole.on("warn", () => {});
    virtualConsole.on("info", () => {});
    virtualConsole.on("dir", () => {});
    return new JSDOM(html, {
      url,
      // Don't fetch external resources; we only need to parse the HTML.
      resources: undefined,
      runScripts: undefined,
      pretendToBeVisual: false,
      virtualConsole,
    });
  } catch {
    return null;
  }
}

function extractWithReadability(html: string, url: string): ExtractedArticle | null {
  const dom = buildDom(html, url);
  if (!dom) return null;
  try {
    const doc = dom.window.document;
    // isProbablyReaderable is a cheap pre-check; if it fails we still try
    // Readability because it sometimes succeeds where the heuristic doesn't.
    const probable = (() => {
      try { return isProbablyReaderable(doc); } catch { return false; }
    })();
    const reader = new Readability(doc, {
      // Reasonably high so we don't accept "subscribe to read more" snippets.
      charThreshold: 250,
      keepClasses: false,
    });
    const parsed = reader.parse();
    if (!parsed) return null;
    const text = (parsed.textContent || htmlToText(parsed.content || "")).trim();
    if (!text || text.length < (probable ? 200 : 350)) return null;
    return {
      title: (parsed.title || doc.title || "").trim() || "Web page",
      text,
      byline: parsed.byline || undefined,
      excerpt: parsed.excerpt || undefined,
      siteName: parsed.siteName || undefined,
      strategy: "readability",
    };
  } catch {
    return null;
  } finally {
    try { dom.window.close(); } catch {}
  }
}

function gatherJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      out.push(parsed);
    } catch {
      // Some sites embed multiple JSON objects concatenated; try a lenient
      // recovery for the common "}{ " case.
      try {
        const wrapped = JSON.parse(`[${raw.replace(/}\s*{/g, "},{")}]`);
        out.push(wrapped);
      } catch {
        // ignore malformed block
      }
    }
  }
  return out;
}

function findArticleNode(node: unknown): Record<string, unknown> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findArticleNode(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const types: string[] = Array.isArray(type)
    ? (type as unknown[]).map((t) => String(t))
    : type
      ? [String(type)]
      : [];
  const articleTypes = new Set([
    "Article",
    "NewsArticle",
    "BlogPosting",
    "Report",
    "ScholarlyArticle",
    "TechArticle",
    "OpinionNewsArticle",
    "ReportageNewsArticle",
    "AnalysisNewsArticle",
    "BackgroundNewsArticle",
    "ReviewNewsArticle",
  ]);
  if (types.some((t) => articleTypes.has(t))) {
    return obj;
  }
  if (Array.isArray(obj["@graph"])) {
    return findArticleNode(obj["@graph"]);
  }
  return null;
}

function extractWithJsonLd(html: string): ExtractedArticle | null {
  const blocks = gatherJsonLdBlocks(html);
  for (const block of blocks) {
    const article = findArticleNode(block);
    if (!article) continue;
    const bodyRaw =
      (article.articleBody as string | undefined) ||
      (article.text as string | undefined) ||
      (article.description as string | undefined);
    if (!bodyRaw) continue;
    const text = htmlToText(String(bodyRaw));
    if (text.length < 250) continue;
    const title =
      (article.headline as string | undefined) ||
      (article.name as string | undefined) ||
      "Web page";
    let byline: string | undefined;
    const author = article.author as unknown;
    if (typeof author === "string") byline = author;
    else if (Array.isArray(author)) {
      byline = author
        .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>).name : a))
        .filter(Boolean)
        .map(String)
        .join(", ") || undefined;
    } else if (author && typeof author === "object") {
      byline = (author as Record<string, unknown>).name as string | undefined;
    }
    let siteName: string | undefined;
    const publisher = article.publisher as unknown;
    if (publisher && typeof publisher === "object") {
      siteName = (publisher as Record<string, unknown>).name as string | undefined;
    }
    return {
      title: String(title).trim() || "Web page",
      text,
      byline: byline?.trim(),
      excerpt: article.description ? htmlToText(String(article.description)).slice(0, 280) : undefined,
      siteName: siteName?.trim(),
      strategy: "json-ld",
    };
  }
  return null;
}

function deepFindStrings(
  node: unknown,
  keys: Set<string>,
  out: string[],
  minLength: number,
  depth = 0,
): void {
  if (depth > 8) return;
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) deepFindStrings(item, keys, out, minLength, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (keys.has(k) && typeof v === "string" && v.length >= minLength) {
      out.push(v);
    } else {
      deepFindStrings(v, keys, out, minLength, depth + 1);
    }
  }
}

function extractFromNextData(html: string): ExtractedArticle | null {
  // Next.js / Nuxt / Remix frequently inline the article body inside a JSON
  // payload before the JS runs. Pull the largest plausible body out of it.
  const candidates: string[] = [];
  const patterns = [
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script[^>]*>\s*window\.__NUXT__\s*=\s*([\s\S]*?)<\/script>/i,
    /<script[^>]*>\s*window\.__INITIAL_STATE__\s*=\s*([\s\S]*?);?\s*<\/script>/i,
    /<script[^>]+id=["']__APOLLO_STATE__["'][^>]*>([\s\S]*?)<\/script>/i,
  ];
  let title: string | undefined;
  for (const pat of patterns) {
    const m = html.match(pat);
    if (!m) continue;
    let raw = m[1].trim();
    // Some payloads end with a trailing semicolon or `)(...)` IIFE wrapper.
    if (raw.endsWith(";")) raw = raw.slice(0, -1).trim();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try matching the largest balanced JSON object we can find.
      const objStart = raw.indexOf("{");
      if (objStart >= 0) {
        try { parsed = JSON.parse(raw.slice(objStart)); } catch { /* ignore */ }
      }
    }
    if (!parsed) continue;
    const bodies: string[] = [];
    deepFindStrings(
      parsed,
      new Set([
        "body_html",
        "body",
        "content",
        "html",
        "articleBody",
        "post_content",
        "rendered_body",
      ]),
      bodies,
      // Article bodies are long; this filters out things like
      // `body: "loading..."` or other tiny stub strings.
      200,
    );
    candidates.push(...bodies);
    if (!title) {
      const titles: string[] = [];
      // Titles are typically short; we just want any non-empty string.
      deepFindStrings(parsed, new Set(["title", "headline", "post_title"]), titles, 1);
      if (titles.length) {
        const t = titles.find((s) => s.length < 300 && !/<[a-z]/i.test(s));
        if (t) title = t.trim();
      }
    }
  }
  if (!candidates.length) return null;
  // Use the longest plausible body.
  candidates.sort((a, b) => b.length - a.length);
  const text = htmlToText(candidates[0]);
  if (text.length < 350) return null;
  return {
    title: title || "Web page",
    text,
    strategy: "next-data",
  };
}

function extractWithRegexFallback(html: string): ExtractedArticle | null {
  const pickRegion = (re: RegExp): string | null => {
    const m = html.match(re);
    return m ? m[1] : null;
  };
  let region =
    pickRegion(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    pickRegion(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
    pickRegion(/<body[^>]*>([\s\S]*?)<\/body>/i) ||
    html;

  region = region
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");

  const text = htmlToText(region);
  if (text.length < 200) return null;

  let title = "";
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = decodeEntities(titleMatch[1].replace(/\s+/g, " ").trim());
  if (!title) {
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (ogTitle) title = decodeEntities(ogTitle[1].trim());
  }
  return {
    title: title || "Web page",
    text,
    strategy: "regex-fallback",
  };
}

function detectAccessWalls(html: string): { paywallDetected: boolean; loginWallDetected: boolean } {
  const sample = html.slice(0, 200_000);
  const paywallDetected = PAYWALL_HINTS.some((re) => re.test(sample));
  const loginWallDetected = LOGIN_WALL_HINTS.some((re) => re.test(sample));
  return { paywallDetected, loginWallDetected };
}

/**
 * Run the full extraction pipeline. Strategies are tried in order of
 * cleanliness; the first one that returns a substantive article wins.
 */
export function extractArticle(html: string, url: string): ExtractionResult {
  const walls = detectAccessWalls(html);

  const strategies: Array<() => ExtractedArticle | null> = [
    () => extractWithJsonLd(html),
    () => extractWithReadability(html, url),
    () => extractFromNextData(html),
    () => extractWithRegexFallback(html),
  ];

  for (const run of strategies) {
    try {
      const article = run();
      if (article && article.text.length >= 250) {
        // Trim very long whitespace runs that some structured data leaves behind.
        article.text = article.text.replace(/\n{3,}/g, "\n\n").trim();
        return { article, ...walls };
      }
    } catch {
      // try the next strategy
    }
  }

  return { article: null, ...walls };
}
