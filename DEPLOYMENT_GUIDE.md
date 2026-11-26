# PodBrew Export & Self-Hosting Guide

## Quick Summary

Your app is a full-stack Node.js app with a React frontend, Express backend, Neon PostgreSQL database, and Google Cloud Storage. Replit's free tier does not support custom domains or permanent deployments. To keep `podbrew.pro` alive without paying Replit forever, you need to export and self-host.

## The Reality Check

| Platform | Cost | Sleeps? | Custom Domain | Best For |
|----------|------|---------|---------------|----------|
| **Hetzner VPS** | ~$5/mo | No | Yes | Best value, full control |
| **DigitalOcean Droplet** | ~$6/mo | No | Yes | Easy setup, good docs |
| **Fly.io** | Free tier + $2-5/mo | No (with credit) | Yes | Modern, Docker-native |
| **Render** | Free | After 15 min | Yes (paid) | Quick setup, sleeps |
| **Railway** | $5+/mo | No | Yes | Good DX, native Docker |
| **Vercel** | Free | No (frontend) | Yes | Frontend only; your backend won't fit well |

**Recommendation:** For a podcast generation app with file uploads, WebSockets (voice assistant), long-running generation tasks, and background scheduling, a **small VPS (Hetzner/DigitalOcean) at $5-6/mo** is the most reliable and cost-effective option. It is cheaper than Replit Core ($7/mo) and gives you full control.

---

## What You Need to Export

### 1. Source Code
Your project is already in this Repl. You can:
- **Download as ZIP**: Click the three dots menu on the file tree → "Download as ZIP"
- **Git push**: The project is already version-controlled → push to GitHub/GitLab

### 2. Database (PostgreSQL)
Your data lives in a Neon PostgreSQL database. Export:
```bash
# In Replit shell, dump your database
pg_dump $DATABASE_URL > podbrew_backup.sql
```
Then import into your new database host.

### 3. Object Storage (Audio Files)
Generated podcast audio files are stored in Google Cloud Storage via Replit Object Storage. You can either:
- Keep using the same GCS bucket (it's independent of Replit subscription)
- Or migrate files to a new bucket

### 4. Environment Variables
These secrets need to be reconfigured on your new host:

```
DATABASE_URL              # Your PostgreSQL connection string
GOOGLE_CLOUD_API_KEY      # Gemini / NotebookLM
GOOGLE_APPLICATION_CREDENTIALS  # GCP service account (for TTS, storage)
OPENAI_API_KEY            # GPT-4o
XAI_API_KEY               # Grok
PERPLEXITY_API_KEY        # Research
NOTEBOOKLM_PROJECT_ID     # Deep Dive template
NOTEBOOKLM_API_ENABLED    # true/false
STRIPE_SECRET_KEY         # Payments
STRIPE_PUBLISHABLE_KEY    # Payments
STRIPE_WEBHOOK_SECRET     # Payments
SESSION_SECRET            # Auth sessions
GOOGLE_CLIENT_ID          # OAuth
GOOGLE_CLIENT_SECRET      # OAuth
REPLIT_APP_URL            # Your production domain (e.g. https://podbrew.pro)
PORT                      # 5000
```

### 5. Custom Domain (`podbrew.pro`)
You own the domain. You just need to point its DNS A record at your new server's IP address.

---

## Option A: Hetzner VPS ($5/mo) — Recommended

### Step 1: Create a Server
1. Go to [hetzner.com/cloud](https://www.hetzner.com/cloud/)
2. Create a CX11 instance (1 vCPU, 2GB RAM, ~$5/mo)
3. Choose Ubuntu 24.04
4. Add your SSH key

### Step 2: Install Dependencies
```bash
# SSH into your server
ssh root@YOUR_SERVER_IP

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install PostgreSQL
apt-get install -y postgresql postgresql-contrib

# Install Git
apt-get install -y git

# Install PM2 (process manager)
npm install -g pm2
```

### Step 3: Set Up the Database
```bash
# Create database and user
sudo -u postgres psql -c "CREATE USER podbrew WITH PASSWORD 'your_secure_password';"
sudo -u postgres psql -c "CREATE DATABASE podbrew OWNER podbrew;"

# Get connection string
# DATABASE_URL=postgresql://podbrew:your_secure_password@localhost:5432/podbrew
```

### Step 4: Clone and Build
```bash
git clone https://github.com/YOUR_USERNAME/podbrew.git /opt/podbrew
cd /opt/podbrew
npm install
npm run build
```

### Step 5: Configure Environment
```bash
# Create .env file
nano /opt/podbrew/.env

# Add all your secrets (see list above)
```

### Step 6: Run with PM2
```bash
cd /opt/podbrew
pm2 start npm --name "podbrew" -- run start
pm2 startup
pm2 save
```

### Step 7: Custom Domain
1. Go to your domain registrar (where you bought `podbrew.pro`)
2. Create an **A record**: `podbrew.pro` → `YOUR_SERVER_IP`
3. Optionally: `www.podbrew.pro` → `YOUR_SERVER_IP`
4. Wait 5-60 minutes for DNS to propagate

### Step 8: SSL (HTTPS) with Let's Encrypt
```bash
apt-get install -y certbot
# Use a reverse proxy like Nginx or Caddy
# Caddy is easiest — auto HTTPS:
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

# Create Caddyfile
nano /etc/caddy/Caddyfile
# Add:
# podbrew.pro {
#     reverse_proxy localhost:5000
# }

systemctl restart caddy
```

---

## Option B: Fly.io (Free Tier + Small Credit)

Fly.io gives you a $5/mo free credit. A small app runs on this for free.

### Step 1: Install Fly CLI
```bash
curl -L https://fly.io/install.sh | sh
```

### Step 2: Create a Dockerfile in your project
Create `Dockerfile` in your project root:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000
CMD ["node", "dist/index.js"]
```

### Step 3: Deploy
```bash
fly launch
fly secrets set DATABASE_URL="..."
# Set all other secrets similarly
fly deploy
```

### Step 4: Custom Domain
```bash
fly certs create podbrew.pro
# Then point your DNS A/AAAA records at the IPs Fly gives you
```

---

## Option C: Railway ($5+/mo)

Railway is the easiest managed platform.

1. Go to [railway.app](https://railway.app)
2. Create a new project → Deploy from GitHub repo
3. Add a PostgreSQL service (managed)
4. Add environment variables in the Railway dashboard
5. Railway auto-builds and deploys
6. Add custom domain in Settings → Domains

---

## Database Migration Checklist

If you want to keep your existing data (users, podcasts, settings):

1. **Export from Replit Neon:**
   ```bash
   pg_dump $DATABASE_URL > podbrew_backup.sql
   ```

2. **Import to new database:**
   ```bash
   psql YOUR_NEW_DATABASE_URL < podbrew_backup.sql
   ```

3. **Verify:** Check that users, podcasts, and credits data migrated correctly.

---

## Object Storage (Audio Files)

Your audio files are in a Google Cloud Storage bucket managed by Replit. The good news: **GCS is independent of Replit**. The bucket is yours.

- The bucket ID is in your `.replit` file under `[objectStorage]`
- You can access it via Google Cloud Console
- If you want to migrate, download files with `gsutil` or the GCP console

Your new server just needs `GOOGLE_APPLICATION_CREDENTIALS` to point to the same bucket.

---

## Important Notes

1. **Capacitor mobile builds** — If you want to keep building the Android/iOS app, you'll need Capacitor CLI on your local machine or CI pipeline. The Replit-specific Capacitor setup won't work elsewhere.

2. **Stripe webhooks** — Update your Stripe dashboard webhook endpoint from `https://podbrew.pro/api/stripe/webhook` to your new domain.

3. **Google OAuth** — Update the authorized redirect URIs in Google Cloud Console to your new domain.

4. **Replit Auth** — Replit Auth only works on Replit. If users logged in via Replit Auth, they'll need to use email/password or Google OAuth on your new deployment.

5. **Replit Object Storage** — If your free Replit Object Storage quota gets restricted, migrate to a standalone GCS bucket. GCS has a generous free tier (5GB).

---

## My Recommendation

For **$5-6/month** (less than a coffee), get a **Hetzner CX11 VPS**. It stays online 24/7, you own the server, SSL is free, and you can run any software. It's cheaper than Replit Core ($7/mo) and gives you far more control.

If you want **zero server management**, use **Railway at ~$5+/mo** — it's managed, auto-scales, and you just push code.

**Bottom line:** You do not need to keep paying Replit to keep `podbrew.pro` alive. A small VPS is cheaper and better for a production podcast app.
