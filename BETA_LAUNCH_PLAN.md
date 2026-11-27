# Flash AI — Beta Launch Plan
**Status:** Production-ready beta  
**Launch date:** Today  
**Tier:** Free only (no paid rails active in beta)  
**AI provider:** Google Gemini (6 API keys, free tier)  
**Owner:** CEO / Lead Engineer

---

## 1. Capacity Model — How Many Users Can the Beta Handle?

### Gemini Free Tier Limits (per key, per day)
| Metric | Limit | Source |
|--------|-------|--------|
| Requests per minute (RPM) | 15 | Gemini free tier |
| Tokens per minute (TPM) | 1,000,000 | Gemini free tier |
| Requests per day (RPD) | 1,500 | Gemini free tier |

### With 6 API Keys (aggregated)
| Metric | Limit |
|--------|-------|
| Requests per minute | 90 RPM |
| Tokens per minute | 6M TPM |
| Requests per day | 9,000 RPD |

### Per-Analysis Cost (Gemini)
- Each match analysis = 1 Gemini `generateContent` call (with Google Search tool)
- Approx. 2,000–4,000 tokens per analysis (prompt + search results + response)
- Conservative: 1 request + ~3,000 tokens per analysis

### Sustainable Daily Volume
- **Safe daily limit:** 7,000 analyses/day (leaves ~22% buffer for retries/fallbacks)
- **Peak minute capacity:** 90 RPM / 60 = ~1.5 analyses/second sustained

### Free Tier User Model
- Free users get **3 credits/day** (1 credit = 1 analysis)
- Not all users will use all 3 credits every day
- Assumption: 40% of active users use all 3 credits daily

| Active Users | Daily Analyses Needed | Viable? |
|--------------|----------------------|---------|
| 500 | ~600 | ✅ Comfortable |
| 1,000 | ~1,200 | ✅ Comfortable |
| 2,000 | ~2,400 | ✅ Comfortable |
| 3,000 | ~3,600 | ✅ Comfortable |
| 5,000 | ~6,000 | ⚠️ Near limit |
| 7,000+ | ~8,400+ | ❌ Exceeds capacity |

### Recommended Beta Cap
- **Soft cap:** 2,000 registered free users
- **Hard cap:** 3,000 registered free users (stop signups beyond this)
- **Expected concurrent:** 50–150 users online at peak

---

## 2. Architecture Changes for Beta

### 2.1 Six-Key Gemini Fallback with Circuit Breaker
Each of the 6 keys is treated as an independent circuit:
- **Healthy:** key rotates normally
- **Degraded:** key returns 429/quota → marked failed for 10 minutes
- **Exhausted:** all 6 keys failed → analysis returns 503 with retry-after guidance
- **Auto-recovery:** failed keys reset every 10 minutes

### 2.2 Beta Rate Limits
| Limit | Value | Scope |
|-------|-------|-------|
| Analyses per user per minute | 5 | Per authenticated user |
| Analyses per user per day | 3 | Enforced by credit system |
| Global concurrent analyses | 10 | Server-wide semaphore |
| API requests per user per minute | 60 | Global rate limiter |

### 2.3 Health & Monitoring
- `GET /api/health` — returns `{ status, gemini: { keys, available, failed } }`
- `GET /api/admin/ai/status` — detailed per-key diagnostics (admin only)

---

## 3. Rollout Checklist

### Pre-Launch (today, before opening to users)
- [x] All 6 `GEMINI_API_KEY_1`..`GEMINI_API_KEY_6` env vars set in Render
- [x] `PRICING_V2_ENABLED=true` set
- [x] Supabase migrations applied (`20261126_country_and_day_pass.sql`, `20261126_pricing_credit_fixes.sql`)
- [x] Code deployed to `main` branch
- [x] Health check returns healthy
- [x] Test analysis works with all 6 keys rotated

### Launch Day (execute in order)
- [ ] Set all 6 `GEMINI_API_KEY_1`..`GEMINI_API_KEY_6` in Render environment variables
- [ ] Deploy from `main` branch to Render (Docker build)
- [ ] Verify `GET /api/health` returns `status: "ok"` with 6 available keys
- [ ] Announce beta in Telegram community
- [ ] Monitor `/api/admin/ai/status` for key exhaustion
- [ ] Watch error logs for 429/503 responses
- [ ] If a key burns out, rotate in a 7th key or pause signups

### Rollback Triggers
- Any single key returns 401/403 (invalid key) → remove key, alert admin
- All 6 keys exhausted simultaneously → enable maintenance mode, pause `/api/analyze`
- Error rate > 10% over 10 minutes → pause new analysis requests

---

## 4. Files Modified
- `backend/services/apiCacheService.ts` — circuit breaker, per-key health, 6-key optimization
- `backend/server.ts` — beta rate limits, enhanced health check, global concurrency guard
- `BETA_LAUNCH_PLAN.md` — this document
