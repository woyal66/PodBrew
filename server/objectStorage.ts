import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    try {
      const [metadata] = await file.getMetadata();
      const fileSize: number = Number(metadata.size) || 0;

      // Public-objects served with TTLs >= 1 day are content-addressed
      // (audio uploads, cover WebPs at `covers/<sha>.webp`, voice previews,
      // voice avatars). Their bytes never change for a given URL, so add
      // `immutable` so browsers skip revalidation entirely until the URL
      // changes. Shorter TTLs (defaults to 1h) keep the original semantics.
      const cacheControl =
        cacheTtlSec >= 86400
          ? `public, max-age=${cacheTtlSec}, immutable`
          : `public, max-age=${cacheTtlSec}`;
      
      // Always advertise that we accept range requests
      res.set("Accept-Ranges", "bytes");
      
      // Parse Range header for byte-range requests (enables audio/video seeking)
      const range = res.req.headers.range;
      
      if (range) {
        // Parse range header (format: "bytes=start-end")
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        
        // Validate range (avoid NaN, negative, or inverted ranges)
        if (isNaN(start) || isNaN(end) || start < 0 || end < start || start >= fileSize) {
          // Invalid range - return full file instead
          res.set({
            "Content-Type": metadata.contentType || "application/octet-stream",
            "Content-Length": fileSize.toString(),
            "Cache-Control": cacheControl,
          });
          const stream = file.createReadStream();
          stream.on("error", (err) => {
            console.error("Stream error:", err);
            if (!res.headersSent) {
              res.status(500).json({ error: "Error streaming file" });
            }
          });
          stream.pipe(res);
          return;
        }
        
        const chunkSize = (end - start) + 1;
        
        // Set status to 206 Partial Content
        res.status(206);
        res.set({
          "Content-Type": metadata.contentType || "application/octet-stream",
          "Content-Length": chunkSize.toString(),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Cache-Control": cacheControl,
        });
        
        // Stream only the requested byte range
        const stream = file.createReadStream({ start, end });
        
        stream.on("error", (err) => {
          console.error("Stream error:", err);
          if (!res.headersSent) {
            res.status(500).json({ error: "Error streaming file" });
          }
        });
        
        stream.pipe(res);
      } else {
        // No range request - send entire file
        res.set({
          "Content-Type": metadata.contentType || "application/octet-stream",
          "Content-Length": fileSize.toString(),
          "Cache-Control": cacheControl,
        });

        const stream = file.createReadStream();

        stream.on("error", (err) => {
          console.error("Stream error:", err);
          if (!res.headersSent) {
            res.status(500).json({ error: "Error streaming file" });
          }
        });

        stream.pipe(res);
      }
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  /**
   * Generic method to upload a file to object storage
   * @param relativePath - Path relative to public directory (e.g., "podcasts/file.mp3" or "voice-previews/voice1/preview.mp3")
   * @param buffer - File buffer
   * @param contentType - MIME type
   * @returns Public URL path
   */
  async uploadPublicObject(relativePath: string, buffer: Buffer, contentType: string): Promise<string> {
    const publicDir = this.getPublicObjectSearchPaths()[0];
    const fullPath = `${publicDir}/${relativePath}`;
    
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    await file.save(buffer, {
      contentType,
    });

    return `/public-objects/${relativePath}`;
  }

  async uploadAudioFile(audioBuffer: Buffer, filename: string): Promise<string> {
    return this.uploadPublicObject(`podcasts/${filename}`, audioBuffer, 'audio/mpeg');
  }

  async uploadImageFile(imageBuffer: Buffer, filename: string): Promise<string> {
    return this.uploadPublicObject(`covers/${filename}`, imageBuffer, 'image/png');
  }

  async uploadVoicePreview(voiceId: string, audioBuffer: Buffer, filename: string): Promise<string> {
    return this.uploadPublicObject(`voice-previews/${voiceId}/${filename}`, audioBuffer, 'audio/mpeg');
  }

  async uploadVoiceAvatar(voiceId: string, imageBuffer: Buffer, filename: string): Promise<string> {
    return this.uploadPublicObject(`voice-avatars/${voiceId}/${filename}`, imageBuffer, 'image/png');
  }

  /**
   * Download a public object as a Buffer (for server-side processing)
   * @param relativePath - Path relative to public directory (e.g., "voice-previews/voiceId/watermarks/file.mp3")
   * @returns Buffer containing file data, or null if not found
   */
  async downloadPublicObjectAsBuffer(relativePath: string): Promise<Buffer | null> {
    try {
      // Remove leading /public-objects/ if present (normalize path)
      const normalizedPath = relativePath.replace(/^\/public-objects\//, '');
      const file = await this.searchPublicObject(normalizedPath);
      
      if (!file) {
        return null;
      }

      const [contents] = await file.download();
      return contents;
    } catch (error) {
      console.error(`[ObjectStorage] Error downloading ${relativePath}:`, error);
      return null;
    }
  }

  /**
   * Check if an object exists at the given path (relative to public directory)
   */
  async checkObjectExists(relativePath: string): Promise<boolean> {
    try {
      const publicDir = this.getPublicObjectSearchPaths()[0];
      const fullPath = `${publicDir}/${relativePath}`;
      
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      console.error('Error checking object existence:', error);
      return false;
    }
  }

  /**
   * Upload a buffer to a relative path in public storage
   */
  async uploadBuffer(relativePath: string, buffer: Buffer, contentType: string): Promise<string> {
    return this.uploadPublicObject(relativePath, buffer, contentType);
  }

  /**
   * Delete an object from public storage
   * @param relativePath - Path relative to public directory (e.g., "podcasts/file.mp3")
   * @returns true if deleted, false if not found
   */
  async deletePublicObject(relativePath: string): Promise<boolean> {
    try {
      const publicDir = this.getPublicObjectSearchPaths()[0];
      const fullPath = `${publicDir}/${relativePath}`;
      
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (!exists) {
        return false;
      }

      await file.delete();
      console.log(`[ObjectStorage] Deleted: ${relativePath}`);
      return true;
    } catch (error) {
      console.error('Error deleting object:', error);
      return false;
    }
  }

  /**
   * Delete audio file from podcasts directory
   */
  async deleteAudioFile(filename: string): Promise<boolean> {
    return this.deletePublicObject(`podcasts/${filename}`);
  }

  /**
   * Delete cover image from covers directory
   */
  async deleteCoverImage(filename: string): Promise<boolean> {
    return this.deletePublicObject(`covers/${filename}`);
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}
