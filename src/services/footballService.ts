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

export async function searchMatches(query: string) {
  if (!query.trim()) return [];
  const response = await fetch(`/api/football/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error('Failed to search matches');
  return response.json();
}

export async function getMatchDetails(fixtureId: number | string, match?: any): Promise<MatchData> {
  const response = await fetch(`/api/football/details/${encodeURIComponent(String(fixtureId))}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ match }),
  });

  if (!response.ok) throw new Error('Failed to fetch match details');
  return response.json();
}

export async function getLiveMatches() {
  const cacheKey = 'live_matches';
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const response = await fetch('/api/football/live');
  if (!response.ok) {
    const backup = await fetch('/api/common/cache?key=live').then((r) => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] }));
    return backup.data || [];
  }

  const data = await response.json();
  setCache(cacheKey, data);
  return data;
}

export async function getUpcomingMatches() {
  const cacheKey = 'upcoming_matches';
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const response = await fetch('/api/football/upcoming');
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
