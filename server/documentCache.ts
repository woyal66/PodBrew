import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 12);

interface CachedDocument {
  documentId: string;
  text: string;
  fileName: string;
  fileSize: number;
  wordCount: number;
  uploadedAt: Date;
}

const documentCache = new Map<string, CachedDocument>();

const CACHE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function cleanupExpiredDocuments() {
  const now = new Date();
  const expired: string[] = [];
  
  for (const [id, doc] of Array.from(documentCache.entries())) {
    if (now.getTime() - doc.uploadedAt.getTime() > CACHE_EXPIRY_MS) {
      expired.push(id);
    }
  }
  
  expired.forEach(id => documentCache.delete(id));
  
  if (expired.length > 0) {
    console.log(`[DocumentCache] Cleaned up ${expired.length} expired documents`);
  }
}

setInterval(cleanupExpiredDocuments, 15 * 60 * 1000); // Check every 15 minutes

export function storeDocument(text: string, fileName: string, fileSize: number): CachedDocument {
  const documentId = nanoid();
  const words = text.trim().split(/\s+/);
  const wordCount = words.length;
  
  const cached: CachedDocument = {
    documentId,
    text,
    fileName,
    fileSize,
    wordCount,
    uploadedAt: new Date(),
  };
  
  documentCache.set(documentId, cached);
  console.log(`[DocumentCache] Stored document ${documentId} (${wordCount} words)`);
  
  return cached;
}

export function getDocument(documentId: string): CachedDocument | null {
  return documentCache.get(documentId) || null;
}

export function deleteDocument(documentId: string): boolean {
  const deleted = documentCache.delete(documentId);
  if (deleted) {
    console.log(`[DocumentCache] Deleted document ${documentId}`);
  }
  return deleted;
}

export function getCacheStats() {
  return {
    totalDocuments: documentCache.size,
    documents: Array.from(documentCache.values()).map(doc => ({
      documentId: doc.documentId,
      fileName: doc.fileName,
      wordCount: doc.wordCount,
      uploadedAt: doc.uploadedAt,
    })),
  };
}
