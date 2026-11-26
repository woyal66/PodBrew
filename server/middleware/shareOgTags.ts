import type { Request, Response, NextFunction } from "express";
import * as fs from "fs";
import * as path from "path";
import { storage } from "../storage";
import type { GeneratedPodcast } from "@shared/schema";

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || "https://podbrew.pro";

const isProd = process.env.NODE_ENV === "production";

const DEV_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  "client",
  "index.html",
);
const PROD_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  "dist",
  "public",
  "index.html",
);

let cachedProdTemplate: string | null = null;

function loadTemplate(): string | null {
  try {
    if (isProd) {
      if (!cachedProdTemplate) {
        cachedProdTemplate = fs.readFileSync(PROD_TEMPLATE_PATH, "utf-8");
      }
      return cachedProdTemplate;
    }
    return fs.readFileSync(DEV_TEMPLATE_PATH, "utf-8");
  } catch {
    return null;
  }
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function resolveCoverUrl(
  coverImageUrl: string | null | undefined,
): string {
  const fallback = `${PUBLIC_BASE_URL}/og-image.png`;
  if (!coverImageUrl) return fallback;
  if (coverImageUrl.startsWith("data:")) return fallback;
  if (coverImageUrl.startsWith("https://")) return coverImageUrl;
  // Upgrade http:// to https:// — Facebook/Twitter require HTTPS image URLs.
  if (coverImageUrl.startsWith("http://")) {
    return "https://" + coverImageUrl.slice("http://".length);
  }
  if (coverImageUrl.startsWith("/")) {
    return `${PUBLIC_BASE_URL}${coverImageUrl}`;
  }
  return `${PUBLIC_BASE_URL}/${coverImageUrl}`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1).trimEnd() + "…";
}

interface MetaValues {
  title: string;
  description: string;
  image: string;
  url: string;
}

function buildMetaForPodcast(podcast: GeneratedPodcast): MetaValues {
  const rawTitle = (podcast.title || podcast.topic || "PodBrew Podcast").trim();
  const title = truncate(`${rawTitle} - PodBrew AI Podcast`, 120);
  const rawTopic = (podcast.topic || rawTitle).trim();
  const description = truncate(
    `Listen to this AI-generated podcast about ${rawTopic}. Created with PodBrew.`,
    180,
  );
  const image = resolveCoverUrl(podcast.coverImageUrl);
  const url = `${PUBLIC_BASE_URL}/podcast/${podcast.id}`;
  return { title, description, image, url };
}

function rewriteAttribute(
  html: string,
  attrName: "name" | "property",
  attrValue: string,
  newContent: string,
): string {
  const escapedAttr = attrValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(<meta\\s+[^>]*${attrName}=["']${escapedAttr}["'][^>]*content=["'])([^"']*)(["'][^>]*>)`,
    "i",
  );
  if (pattern.test(html)) {
    return html.replace(pattern, `$1${escapeHtmlAttr(newContent)}$3`);
  }
  // contentBefore-attr ordering variant
  const altPattern = new RegExp(
    `(<meta\\s+[^>]*content=["'])([^"']*)(["'][^>]*${attrName}=["']${escapedAttr}["'][^>]*>)`,
    "i",
  );
  if (altPattern.test(html)) {
    return html.replace(altPattern, `$1${escapeHtmlAttr(newContent)}$3`);
  }
  // Tag missing — inject before </head>
  const newTag = `<meta ${attrName}="${escapeHtmlAttr(attrValue)}" content="${escapeHtmlAttr(newContent)}" />`;
  if (html.includes("</head>")) {
    return html.replace("</head>", `    ${newTag}\n  </head>`);
  }
  return html;
}

function rewriteCanonical(html: string, url: string): string {
  const pattern = /(<link\s+rel=["']canonical["']\s+href=["'])([^"']*)(["'][^>]*\/?>)/i;
  if (pattern.test(html)) {
    return html.replace(pattern, `$1${escapeHtmlAttr(url)}$3`);
  }
  return html;
}

function rewriteTitle(html: string, title: string): string {
  const pattern = /<title>[^<]*<\/title>/i;
  const safe = `<title>${escapeHtmlText(title)}</title>`;
  if (pattern.test(html)) return html.replace(pattern, safe);
  if (html.includes("</head>")) {
    return html.replace("</head>", `    ${safe}\n  </head>`);
  }
  return html;
}

export function injectPodcastMeta(
  template: string,
  podcast: GeneratedPodcast,
): string {
  const meta = buildMetaForPodcast(podcast);
  let html = template;
  html = rewriteTitle(html, meta.title);
  html = rewriteAttribute(html, "name", "title", meta.title);
  html = rewriteAttribute(html, "name", "description", meta.description);
  html = rewriteAttribute(html, "property", "og:type", "music.song");
  html = rewriteAttribute(html, "property", "og:url", meta.url);
  html = rewriteAttribute(html, "property", "og:title", meta.title);
  html = rewriteAttribute(html, "property", "og:description", meta.description);
  html = rewriteAttribute(html, "property", "og:image", meta.image);
  html = rewriteAttribute(html, "name", "twitter:card", "summary_large_image");
  html = rewriteAttribute(html, "name", "twitter:url", meta.url);
  html = rewriteAttribute(html, "name", "twitter:title", meta.title);
  html = rewriteAttribute(html, "name", "twitter:description", meta.description);
  html = rewriteAttribute(html, "name", "twitter:image", meta.image);
  html = rewriteCanonical(html, meta.url);
  return html;
}

function sendShareHtml(res: Response, html: string): void {
  // Auth-dependent body (owner of a private podcast sees richer OG tags
  // than an anonymous visitor at the same URL). Vary on cookie and forbid
  // shared caches from collapsing those variants.
  res.status(200).set({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    Vary: "Cookie",
  }).end(html);
}

async function handleShareRoute(req: Request, res: Response, next: NextFunction) {
  const { id } = req.params as { id?: string };
  if (!id) return next();

  const template = loadTemplate();
  if (!template) return next();

  let podcast: GeneratedPodcast | undefined;
  try {
    podcast = await storage.getPodcast(id);
  } catch (err) {
    console.warn("[shareOgTags] lookup failed:", err);
    return next();
  }

  if (!podcast) {
    // Send unmodified template; SPA will display its own 404 / error UI.
    sendShareHtml(res, template);
    return;
  }

  // Privacy: never leak private podcasts in OG tags. Use the
  // passport-authenticated identity (req.user?.id) — NOT the
  // client-controlled `req.userId` cookie which an attacker can forge.
  // Owners still get the rich tags so internal previews look good.
  const authedUserId =
    typeof req.isAuthenticated === "function" && req.isAuthenticated()
      ? (req.user as { id?: string } | undefined)?.id
      : undefined;
  const isOwner = !!authedUserId && authedUserId === podcast.userId;
  if (!podcast.isPublic && !isOwner) {
    sendShareHtml(res, template);
    return;
  }

  const html = injectPodcastMeta(template, podcast);
  sendShareHtml(res, html);
}

export function registerShareOgRoutes(app: import("express").Express): void {
  app.get("/podcast/:id", handleShareRoute);
  app.get("/podcasts/:id", handleShareRoute);
}
