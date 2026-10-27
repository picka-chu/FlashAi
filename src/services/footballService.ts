import axios from 'axios';
import { MatchData } from '../types/prediction';

const CACHE: Record<string, { data: any; timestamp: number }> = {};
const CACHE_DURATION = 2 * 60 * 1000;

function getFromCache(key: string) {
  const cached = CACHE[key];
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) return cached.data;
  return null;
}

function setCache(key: string, data: any) {
  CACHE[key] = { data, timestamp: Date.now() };
}

export async function searchMatches(query: string, initData = '') {
  if (!query.trim()) return [];
  const response = await fetch(`/api/football/search?q=${encodeURIComponent(query)}`, {
    headers: initData ? { 'X-TG-Init-Data': initData } : {},
  });
  if (!response.ok) throw new Error('Failed to search matches');
  return response.json();
}

export async function getMatchDetails(fixtureId: number | string, match?: any, initData = ''): Promise<MatchData> {
  const response = await fetch(`/api/football/details/${encodeURIComponent(String(fixtureId))}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(initData ? { 'X-TG-Init-Data': initData } : {}),
    },
    body: JSON.stringify({ match }),
  });

  if (!response.ok) throw new Error('Failed to fetch match details');
  return response.json();
}

export async function fetchMatchH2H(home: string, away: string, initData = '', fixtureId = '') {
  const params = new URLSearchParams({ home, away });
  if (fixtureId) params.set('fixtureId', String(fixtureId));
  const response = await fetch(`/api/football/h2h?${params.toString()}`, {
    headers: initData ? { 'X-TG-Init-Data': initData } : {},
  });
  if (!response.ok) return null;
  return response.json();
}

export async function getLiveMatches(initData = '') {
  const cacheKey = 'live_matches';
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const response = await fetch('/api/football/live', {
    headers: initData ? { 'X-TG-Init-Data': initData } : {},
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Live matches require an active paid subscription.');
    }
    throw new Error('Failed to load live matches.');
  }

  const data = await response.json();
  setCache(cacheKey, data);
  return data;
}

export async function getLiveMatchPreview(fixtureId: string, initData = '') {
  const response = await fetch(`/api/football/live/${encodeURIComponent(String(fixtureId))}/preview`, {
    headers: initData ? { 'X-TG-Init-Data': initData } : {},
  });
  if (!response.ok) throw new Error('Failed to fetch live match preview');
  return response.json();
}

export async function analyzeLiveMatch(payload: { fixtureId: string; liveSnapshot?: any }, initData = '') {
  const MAX_ATTEMPTS = 3;
  let lastError: Error = new Error('Live analysis failed');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 70_000);

    try {
      const response = await fetch('/api/analyze-live', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(initData ? { 'X-TG-Init-Data': initData } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
      clearTimeout(timeoutId);

      const data = await response.json().catch(() => ({}));

      if (response.ok) return data;

      // Non-retryable errors — surface immediately
      if (response.status === 401 || response.status === 403 || response.status === 402 || response.status === 400) {
        throw new Error(data?.error || 'Live analysis failed');
      }

      // Retryable (503, 500, network issues)
      lastError = new Error(data?.error || `Server error (${response.status})`);
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e?.name === 'AbortError') {
        lastError = new Error('Analysis is taking longer than expected. Retrying…');
      } else if (e?.message && (e.message.includes('401') || e.message.includes('403') || e.message.includes('402'))) {
        throw e; // don't retry auth/plan errors
      } else {
        lastError = e;
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, 2000 * attempt)); // 2s, 4s back-off
    }
  }

  throw lastError;
}

export interface FootballNewsArticle {
  id: string;
  headline: string;
  description: string | null;
  image: string | null;
  url: string;
  source: string;
  byline: string | null;
  published: string;
  leagueSlug: string;
  league: string;
}

export async function getFootballNews(limit = 12, league?: string): Promise<FootballNewsArticle[]> {
  const cacheKey = `news_${league || 'all'}_${limit}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ limit: String(limit) });
  if (league) params.set('league', league);

  try {
    const response = await fetch(`/api/football/news?${params.toString()}`);
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    setCache(cacheKey, data);
    return data;
  } catch {
    return [];
  }
}

export async function getUpcomingMatches(initData = '') {
  const cacheKey = `upcoming_matches_${initData ? 'auth' : 'anon'}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const response = await fetch('/api/football/upcoming', {
    headers: initData ? { 'X-TG-Init-Data': initData } : {},
  });
  if (!response.ok) return [];

  const data = await response.json();
  setCache(cacheKey, data);
  return data;
}

export async function recordMatchClick(matchId: string, teams: string) {
  try {
    await axios.post('/api/trending/click', { matchId, teams });
  } catch (e) {
    console.error('Failed to record click', e);
  }
}

export async function getTrendingPicks() {
  try {
    const res = await axios.get('/api/trending');
    return res.data;
  } catch (e) {
    console.error('Failed to fetch trending', e);
    return [];
  }
}
