# NotebookLM "Conversational Deep Dive" — Operator Setup Guide

This document explains how to enable the **Deep Dive** template in PodBrew, which calls Google's NotebookLM Podcast API to generate conversational two-host podcast episodes.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Google Cloud project | Billing must be enabled |
| NotebookLM Podcast API access | Your project must be allowlisted — see Step 0 below |
| Discovery Engine API | Must be enabled for your project |
| Authentication | API key **or** service account (ADC) |

---

## Step 0 — Request API access (allowlist)

The NotebookLM Podcast API (`discoveryengine.googleapis.com` — `podcasts:generate`) is in **limited preview** and requires your GCP project to be allowlisted by Google before you can call it.

1. Visit the [NotebookLM for Enterprises & Developers page](https://notebooklm.google.com/developers) and request access, **or**
2. Contact your Google Cloud account team to request allowlisting for `roles/discoveryengine.podcastApiUser` on your project.

> Until your project is allowlisted, API calls will return a `403 PERMISSION_DENIED` error even with valid credentials.

---

## Step 1 — Enable the Discovery Engine API

```bash
gcloud services enable discoveryengine.googleapis.com --project=YOUR_PROJECT_ID
```

---

## Step 2 — Grant the Podcast API IAM role

The service account (or the identity making API calls) must have the `roles/discoveryengine.podcastApiUser` role:

```bash
# For a service account
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_SA@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/discoveryengine.podcastApiUser"

# For your own user account (API key auth uses project-level permissions)
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="user:you@example.com" \
  --role="roles/discoveryengine.podcastApiUser"
```

> Without this role, even an allowlisted project will receive `403` errors.

---

## Step 3 — Choose an authentication method

### Option A — API Key (simpler, recommended for Replit)

1. Go to **Google Cloud Console → APIs & Services → Credentials**
2. Click **Create Credentials → API key**
3. Restrict it to the Discovery Engine API for security
4. Copy the key

Set this environment variable in Replit:
```
GOOGLE_CLOUD_API_KEY=AIza...
```

### Option B — Service Account (ADC)

1. Create a service account and grant it `roles/discoveryengine.podcastApiUser` (see Step 2)
2. Download the JSON key file
3. Set the path:

```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

---

## Step 4 — Set required environment variables

In Replit **Secrets**, add:

| Variable | Value | Notes |
|---|---|---|
| `NOTEBOOKLM_API_ENABLED` | `true` | Enables the feature flag |
| `NOTEBOOKLM_PROJECT_ID` | `your-gcp-project-id` | Your GCP project ID (not number) |
| `GOOGLE_CLOUD_API_KEY` | `AIza...` | **If using Option A** |
| `GOOGLE_APPLICATION_CREDENTIALS` | `/path/to/key.json` | **If using Option B** |

---

## Step 5 — Verify

Once the variables are set, restart the application. The **Deep Dive** template chip will appear in the Create page template picker.

You can also check the features endpoint:

```
GET /api/features
→ { "deepDiveAvailable": true }
```

---

## How it works

1. The user enters a topic (and optionally a source URL or uploaded document) in the Deep Dive form
2. The backend calls `POST https://discoveryengine.googleapis.com/v1/projects/{project}/locations/global/podcasts:generate`
3. The API returns a Long-Running Operation (LRO)
4. PodBrew polls the LRO every few seconds until the MP3 is ready (typically 1–3 minutes)
5. The audio is uploaded to Replit Object Storage and saved as a podcast in the library
6. 2 credits are deducted from the user's account; credits are automatically refunded if generation, upload, or DB save fails

---

## Credit cost

Deep Dive episodes cost a **flat 2 credits**, regardless of length (duration is determined by NotebookLM and is typically 5–15 minutes).

---

## Troubleshooting

| Error | Likely cause |
|---|---|
| `NOTEBOOKLM_PROJECT_ID is not configured` | Missing env var |
| `NotebookLM API error (403)` | Project not allowlisted, API key lacks permissions, or `roles/discoveryengine.podcastApiUser` not granted |
| `NotebookLM generation timed out` | LRO took > 5 minutes; increase `DEFAULT_POLL_TIMEOUT_MS` in `server/services/NotebookLMPodcast.ts` |
| `No valid Google auth found` | Neither `GOOGLE_CLOUD_API_KEY` nor ADC is configured |
| Template chip not visible in UI | `NOTEBOOKLM_API_ENABLED` is not `"true"` or `/api/features` returns `deepDiveAvailable: false` |
| `Deep Dive upload failed` | Object Storage misconfigured; check `OBJECT_STORAGE_*` env vars |
| Credits not refunded after failure | Check server logs for `deep-dive-refund` — credits are refunded on generation, upload, and DB-insert failures |

---

## Security notes

- The Deep Dive route (`POST /api/generate/deep-dive`) requires a logged-in user
- Standard credit checks and tier restrictions apply
- Content moderation runs before calling the NotebookLM API
- Source URLs are passed directly to Google; avoid allowing user-supplied URLs without validation in high-trust environments
- Uploaded documents are extracted server-side and passed as inline text — they are never stored permanently
