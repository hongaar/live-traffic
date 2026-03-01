# Deployment Guide

This guide covers deploying Live Traffic to **Railway**, a modern hosting platform with a generous free tier perfect for this project.

## Why Railway?

- ✅ **Generous Free Tier**: $5/month free credits, sufficient for this project
- ✅ **PostgreSQL Included**: Built-in Postgres with automatic backups
- ✅ **GitHub Integration**: Automatic deployments on push to main
- ✅ **Environment Variables**: Easy management via Railway dashboard
- ✅ **Nixpacks Support**: Zero-config builds for TypeScript/Bun
- ✅ **Monitoring**: Built-in logs, metrics, and error tracking
- ✅ **Custom Domains**: Free HTTPS with custom domain support

## Architecture

```
Your GitHub Repo
    ↓
[GitHub Actions CI]
  - Type check
  - Lint
  - Build
    ↓ (on main branch only)
[Railway Auto-Deploy]
  - Build Docker image
  - Run migrations
  - Deploy API service
  - Deploy Collector service
  - Start PostgreSQL
```

## Setup Steps

### 1. Create Railway Account

1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub (recommended for seamless integration)
3. Create a new project

### 2. Connect GitHub Repository

1. In Railway dashboard: **New Project → GitHub Repo**
2. Select your `live-traffic` repository
3. Grant Railway access to your repo

### 3. Configure Environment Variables

In Railway dashboard, go to project **Variables** and add:

```bash
# Database
DB_KIND=postgres
DATABASE_URL=postgresql://user:pass@localhost:5432/live_traffic
  → Railway auto-fills this from its PostgreSQL service

# API
PORT=3000
CORS_ORIGIN=https://your-domain.railway.app

# Web App
VITE_WS_URL=wss://your-domain.railway.app/ws
VITE_API_BASE=https://your-domain.railway.app

# NDW Adapter
NDW_USE_CACHE=true
LOG_LEVEL=info

# For Railway deployment
NODE_ENV=production
```

### 4. Add PostgreSQL Service

1. In Railway: **New → Database → PostgreSQL**
2. Railway automatically sets `DATABASE_URL` env var
3. Backup is automatic

### 5. Deploy

Option A: **Automatic (Recommended)**
- Push to `main` branch → Railway auto-deploys
- Monitor via Railway dashboard

Option B: **Manual Deploy**
- Railway dashboard → Deploy button
- View logs in real-time

## Scaling & Free Tier Limits

**What's included in free tier:**
- 500 hours compute/month per service = ~21 days continuous
- Perfect for running collector + API (2 services = 42 days continuous)
- Stop one service during off-hours to maximize time
- 1 PostgreSQL instance with auto-backups

**Recommended for heavy traffic:**
- Upgrade to paid plan ($5+/month) → unlimited compute
- Enable auto-scaling if needed

## Monitoring

**Railway Dashboard:**
- **Logs**: Real-time output from collector and API
- **Metrics**: CPU, memory, network usage
- **Deployments**: History and rollback

View logs:
```bash
# Via Railway CLI (optional)
railway login
railway logs --service api
railway logs --service collector
```

## Custom Domain

1. **Register domain** (GoDaddy, Namecheap, etc.)
2. **In Railway**: Settings → Custom Domain
3. **Add DNS records** as Railway instructs (usually a CNAME)
4. **HTTPS**: Automatic via Let's Encrypt

Example:
```
Domain: traffic.example.com
CNAME → traffic.railway.app
```

## Troubleshooting

### Deployment fails with "Build error"

Check `.github/workflows/deploy.yml` is properly configured and Railway token is set.

### Database connection errors

1. Verify `DATABASE_URL` is set in Railway Variables
2. Check PostgreSQL service is running
3. View logs: `railway logs --service api`

### Web app shows "Cannot connect to API"

1. Verify `VITE_WS_URL` and `VITE_API_BASE` are correct HTTPS URLs
2. Check CORS_ORIGIN matches your domain
3. Rebuild web app after changing env vars

### High memory usage

1. Check NDW cache size: `du -sh .ndw-cache/`
2. Reduce cache with `NDW_USE_CACHE=false` if needed
3. Implement data retention: increase TTL or decrease retention window

## Local Testing Before Deploy

Test production configuration locally:

```bash
# Test with PostgreSQL locally
export DB_KIND=postgres
export DATABASE_URL=postgresql://user:password@localhost:5432/live_traffic

# Start services (collector + API)
bun run dev
```

## Environment-Specific Settings

### Development (.env.local)
```bash
DB_KIND=sqlite
DB_PATH=./live-traffic.db
NDW_USE_CACHE=true
LOG_LEVEL=verbose
```

### Production (Railway Variables)
```bash
DB_KIND=postgres
DATABASE_URL=postgresql://...
NDW_USE_CACHE=true
LOG_LEVEL=info
PORT=3000
```

## Alternative Hosting Platforms

If Railway doesn't meet your needs:

| Platform | Free Tier | Pros | Cons |
|----------|-----------|------|------|
| **Railway** | $5/mo | Best free tier, Postgres included | Limited free compute |
| **Render** | Limited | Good free tier, auto-deploys | Slower free instances |
| **Fly.io** | $3/mo | Distributed, fast | More complex setup |
| **Vercel** | Free | Great for web app | Not ideal for backend |
| **Heroku** | ❌ Free tier ended | Was easy to use | Very expensive now |

**Recommendation:** Start with Railway, migrate if needed.

## Cost Breakdown (Monthly)

### Free Tier
- Compute: $0 (500 hrs included)
- PostgreSQL: $0 (included)
- **Total: $0/month** ✅

### Paid Tier ($5/mo)
- Compute: $5/mo (unlimited)
- PostgreSQL: $0 (included)
- **Total: $5/month**

## Next Steps

1. ✅ Create Railway account
2. ✅ Connect GitHub repo
3. ✅ Set environment variables
4. ✅ Push to `main` branch
5. ✅ Watch automatic deployment
6. ✅ Set up custom domain (optional)
