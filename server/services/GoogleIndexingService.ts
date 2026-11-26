import { GoogleAuth } from 'google-auth-library';
import { logger } from '../utils/logger';

const INDEXING_API_URL = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const BASE_URL = 'https://podbrew.pro';

interface IndexingResponse {
  urlNotificationMetadata?: {
    url: string;
    latestUpdate?: {
      type: string;
      notifyTime: string;
    };
  };
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

class GoogleIndexingService {
  private auth: GoogleAuth | null = null;
  private isConfigured: boolean = false;

  constructor() {
    this.initializeAuth();
  }

  private initializeAuth(): void {
    const serviceAccountJson = process.env.GOOGLE_INDEXING_SERVICE_ACCOUNT;
    
    if (!serviceAccountJson) {
      logger.info('Google Indexing API not configured - GOOGLE_INDEXING_SERVICE_ACCOUNT not set');
      this.isConfigured = false;
      return;
    }

    try {
      const credentials = JSON.parse(serviceAccountJson);
      this.auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/indexing'],
      });
      this.isConfigured = true;
      logger.info('Google Indexing API configured successfully');
    } catch (error) {
      logger.error('Failed to initialize Google Indexing API', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.isConfigured = false;
    }
  }

  async notifyUrlUpdated(podcastId: string): Promise<boolean> {
    if (!this.isConfigured || !this.auth) {
      logger.debug('Google Indexing API not configured, skipping notification');
      return false;
    }

    const url = `${BASE_URL}/podcast/${podcastId}`;

    try {
      const client = await this.auth.getClient();
      const accessToken = await client.getAccessToken();

      if (!accessToken.token) {
        logger.error('Failed to get access token for Google Indexing API');
        return false;
      }

      const response = await fetch(INDEXING_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.token}`,
        },
        body: JSON.stringify({
          url: url,
          type: 'URL_UPDATED',
        }),
      });

      const data = await response.json() as IndexingResponse;

      if (!response.ok || data.error) {
        logger.error('Google Indexing API error:', {
          status: response.status,
          error: data.error,
          url,
        });
        return false;
      }

      logger.info('Successfully notified Google Indexing API', {
        url,
        notifyTime: data.urlNotificationMetadata?.latestUpdate?.notifyTime,
      });
      return true;
    } catch (error) {
      logger.error('Failed to notify Google Indexing API:', {
        error: error instanceof Error ? error.message : String(error),
        url,
      });
      return false;
    }
  }

  async notifyUrlDeleted(podcastId: string): Promise<boolean> {
    if (!this.isConfigured || !this.auth) {
      return false;
    }

    const url = `${BASE_URL}/podcast/${podcastId}`;

    try {
      const client = await this.auth.getClient();
      const accessToken = await client.getAccessToken();

      if (!accessToken.token) {
        return false;
      }

      const response = await fetch(INDEXING_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.token}`,
        },
        body: JSON.stringify({
          url: url,
          type: 'URL_DELETED',
        }),
      });

      const data = await response.json() as IndexingResponse;

      if (!response.ok || data.error) {
        logger.error('Google Indexing API delete error:', {
          status: response.status,
          error: data.error,
        });
        return false;
      }

      logger.info('Successfully notified Google Indexing API of URL deletion', { url });
      return true;
    } catch (error) {
      logger.error('Failed to notify Google Indexing API of deletion', {
        error: error instanceof Error ? error.message : String(error),
        url,
      });
      return false;
    }
  }

  isAvailable(): boolean {
    return this.isConfigured;
  }
}

export const googleIndexingService = new GoogleIndexingService();
