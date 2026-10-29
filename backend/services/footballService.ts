import axios from 'axios';
import { MatchData, TeamStats } from '../../src/types/prediction';

const BSD_API_KEY =
  process.env.BSD_API_KEY ||
  process.env.BSD_FOOTBALL_API_KEY ||
  process.env.BZZOIRO_API_KEY ||
  '';
const rawBsdBase = (process.env.BSD_API_BASE || 'https://sports.bzzoiro.com/api/v2').replace(/\/+$/, '');
const BSD_API_BASE = /\/api$/.test(rawBsdBase) ? `${rawBsdBase}/v2` : rawBsdBase;
const BSD_HEADERS = BSD_API_KEY
  ? { Authorization: `Token ${BSD_API_KEY}`, Accept: 'application/json' }
  : { Accept: 'application/json' };

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// Match days are calendar days in MATCH_TIMEZONE, not UTC. Using UTC made
// "today" roll over at 03:00 in Addis Ababa and dropped same-day fixtures.
const MATCH_TIMEZONE = process.env.MATCH_TIMEZONE || 'Africa/Addis_Ababa';
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: MATCH_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getTodayDateString(offset = 0) {
  return dayFormatter.format(new Date(Date.now() + offset * 24 * 60 * 60 * 1000));
}

function safeIsoDate(value: any) {
  if (!value) return new Date().toISOString();
  const date = typeof value === 'number'
    ? new Date(value > 9999999999 ? value : value * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

async function bsdGet(path: string, params: Record<string, any> = {}, timeout = 12_000) {
  if (!BSD_API_KEY) {
    throw new Error('BSD_API_KEY is not configured');
  }
  const response = await axios.get(`${BSD_API_BASE}${path}`, {
    headers: BSD_HEADERS,
    params,
    timeout,
  });
  return response.data;
}

function bsdRows(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  const rows = payload?.results ?? payload?.events ?? payload?.data ?? [];
  return Array.isArray(rows) ? rows : [];
}

async function fetchBsdEvents(path: string, params: Record<string, any>, maxPages = 1): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const payload = await bsdGet(path, { ...params, limit: 200, offset });
    const batch = bsdRows(payload);
    rows.push(...batch);
    if (!payload?.next || batch.length === 0) break;
    offset += batch.length;
  }
  return rows;
}

let leagueCache: { data: Record<number, string>; timestamp: number } | null = null;
const LEAGUE_CACHE_TTL = 60 * 60 * 1000;

async function getBsdLeagueMap(): Promise<Record<number, string>> {
  if (leagueCache && Date.now() - leagueCache.timestamp < LEAGUE_CACHE_TTL) {
    return leagueCache.data;
  }

  const map: Record<number, string> = {};
  try {
    const payload = await bsdGet('/leagues/', { limit: 200 });
    for (const league of bsdRows(payload)) {
      const id = Number(league?.id);
      if (Number.isFinite(id) && league?.name) map[id] = String(league.name);
    }
  } catch (error: any) {
    console.warn('[BSD] Could not load league names:', error?.message || error);
  }
  leagueCache = { data: map, timestamp: Date.now() };
  return map;
}

function bsdStatus(event: any): { state: 'pre' | 'in' | 'post'; short: string } {
  const status = String(event?.status || '').toLowerCase();
  const period = String(event?.period || '').toLowerCase();

  if (status === 'notstarted') return { state: 'pre', short: 'NS' };
  if (status === 'delayed') return { state: 'pre', short: 'DLY' };
  if (status === 'postponed') return { state: 'post', short: 'PP' };
  if (status === 'cancelled') return { state: 'post', short: 'CANC' };
  if (status === 'unresolved') return { state: 'post', short: 'TBD' };
  if (status === 'finished') return { state: 'post', short: 'FT' };
  if (status === 'aet') return { state: 'post', short: 'AET' };
  if (status === 'halftime' || period === 'halftime') return { state: 'in', short: 'HT' };
  if (status === 'penalties' || period === 'penalties') return { state: 'in', short: 'PENS' };
  if (status === 'extratime' || period === 'extra_time') return { state: 'in', short: 'ET' };
  if (period === '1st_half') return { state: 'in', short: '1H' };
  if (period === '2nd_half') return { state: 'in', short: '2H' };
  return { state: 'in', short: 'LIVE' };
}

function flattenBsdMarketPayload(odds: any): Record<string, number> {
  const out: Record<string, number> = {};
  const push = (key: any, value: any) => {
    if (key === undefined || key === null) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 1) return;
    out[String(key).trim()] = n;
  };
  const walk = (node: any, depth = 0) => {
    if (node === null || node === undefined || depth > 4) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === 'number') return;
    if (typeof node !== 'object') return;
    const name = node.market_name ?? node.market ?? node.name ?? node.title ?? node.type ?? node.league_name;
    const value = node.value ?? node.odd ?? node.odds ?? node.price;
    if (name !== undefined && value !== undefined) {
      push(`${name}`, value);
      push(`${name}_${node.selection ?? node.outcome ?? node.side ?? ''}`.replace(/_$/, ''), value);
    }
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') walk(v, depth + 1);
      else if (typeof v === 'number' || typeof v === 'string') push(k, v);
    }
  };
  walk(odds);
  return out;
}

function normaliseBsdOdds(odds: any) {
  if (!odds || typeof odds !== 'object') return null;
  const flat = flattenBsdMarketPayload(odds);
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = Number(odds[key] ?? flat[key]);
      if (Number.isFinite(value) && value > 1.01) return value;
    }
    return undefined;
  };

  const normalised = {
    home: pick('home_win', 'home', '1', 'match_winner_home'),
    draw: pick('draw', 'X', 'match_winner_draw'),
    away: pick('away_win', 'away', '2', 'match_winner_away'),
    dc1X: pick('double_chance_1x', 'dc_1x', '1x', 'double_chance_home_draw'),
    dcX2: pick('double_chance_x2', 'dc_x2', 'x2', 'double_chance_draw_away'),
    dc12: pick('double_chance_12', 'dc_12', '12', 'double_chance_home_away'),
    over15: pick('over_15_goals', 'over15', 'Over 1.5', 'total_goals_over_1.5'),
    under15: pick('under_15_goals', 'under15', 'Under 1.5', 'total_goals_under_1.5'),
    over25: pick('over_25_goals', 'over25', 'Over 2.5', 'total_goals_over_2.5'),
    under25: pick('under_25_goals', 'under25', 'Under 2.5', 'total_goals_under_2.5'),
    over35: pick('over_35_goals', 'over35', 'Over 3.5', 'total_goals_over_3.5'),
    under35: pick('under_35_goals', 'under35', 'Under 3.5', 'total_goals_under_3.5'),
    over45: pick('over_45_goals', 'over45', 'Over 4.5'),
    under45: pick('under_45_goals', 'under45', 'Under 4.5'),
    bttsYes: pick('btts_yes', 'bttsYes', 'BTTS Yes', 'both_teams_to_score_yes'),
    bttsNo: pick('btts_no', 'bttsNo', 'BTTS No', 'both_teams_to_score_no'),
    dnb1: pick('dnb_home', 'dnb1', 'draw_no_bet_home', 'dnb_1'),
    dnb2: pick('dnb_away', 'dnb2', 'draw_no_bet_away', 'dnb_2'),
    htFtHomeHome: pick('halftime_fulltime_home_home', 'ht_ft_hh', '1_1', 'halftime_fulltime_1_1'),
    htFtHomeDraw: pick('halftime_fulltime_home_draw', 'ht_ft_hd', '1_x'),
    htFtHomeAway: pick('halftime_fulltime_home_away', 'ht_ft_ha', '1_2'),
    htFtDrawHome: pick('halftime_fulltime_draw_home', 'ht_ft_dh', 'x_1'),
    htFtDrawDraw: pick('halftime_fulltime_draw_draw', 'ht_ft_dd', 'x_x'),
    htFtDrawAway: pick('halftime_fulltime_draw_away', 'ht_ft_da', 'x_2'),
    htFtAwayHome: pick('halftime_fulltime_away_home', 'ht_ft_ah', '2_1'),
    htFtAwayDraw: pick('halftime_fulltime_away_draw', 'ht_ft_ad', '2_x'),
    htFtAwayAway: pick('halftime_fulltime_away_away', 'ht_ft_aa', '2_2'),
    cornersOver85: pick('corners_over_8.5', 'corner_over_8.5', 'total_corners_over_8.5', 'over_8.5_corners'),
    cornersUnder85: pick('corners_under_8.5', 'corner_under_8.5', 'total_corners_under_8.5', 'under_8.5_corners'),
    cornersOver95: pick('corners_over_9.5', 'corner_over_9.5', 'total_corners_over_9.5', 'over_9.5_corners'),
    cornersUnder95: pick('corners_under_9.5', 'corner_under_9.5', 'total_corners_under_9.5', 'under_9.5_corners'),
    cornersOver105: pick('corners_over_10.5', 'corner_over_10.5', 'total_corners_over_10.5', 'over_10.5_corners'),
    cornersUnder105: pick('corners_under_10.5', 'corner_under_10.5', 'total_corners_under_10.5', 'under_10.5_corners'),
    cardsOver35: pick('cards_over_3.5', 'total_cards_over_3.5', 'over_3.5_cards', 'booking_over_3.5'),
    cardsUnder35: pick('cards_under_3.5', 'total_cards_under_3.5', 'under_3.5_cards', 'booking_under_3.5'),
    cardsOver45: pick('cards_over_4.5', 'total_cards_over_4.5', 'over_4.5_cards', 'booking_over_4.5'),
    cardsUnder45: pick('cards_under_4.5', 'total_cards_under_4.5', 'under_4.5_cards', 'booking_under_4.5'),
    yellowOver25: pick('yellow_cards_over_2.5', 'over_2.5_yellow_cards', 'yellow_over_2.5'),
    yellowUnder25: pick('yellow_cards_under_2.5', 'under_2.5_yellow_cards', 'yellow_under_2.5'),
    yellowOver35: pick('yellow_cards_over_3.5', 'over_3.5_yellow_cards', 'yellow_over_3.5'),
    yellowUnder35: pick('yellow_cards_under_3.5', 'under_3.5_yellow_cards', 'yellow_under_3.5'),
    cleanSheetHome: pick('clean_sheet_home', 'cs_home', 'home_clean_sheet'),
    cleanSheetAway: pick('clean_sheet_away', 'cs_away', 'away_clean_sheet'),
  };

  const present = Object.fromEntries(
    Object.entries(normalised).filter(([, v]) => typeof v === 'number'),
  );
  if (!Object.keys(present).length) return null;
  return { ...present, _raw: flat };
}

/** Best-effort view of every distinct market BSD exposed for this event. */
export function summariseBsdMarkets(odds: any): { name: string; odds: Record<string, number> }[] {
  const flat = flattenBsdMarketPayload(odds);
  const buckets = new Map<string, Record<string, number>>();
  for (const [key, value] of Object.entries(flat)) {
    const match = key.match(/^(.*?)[_-]?(home|away|draw|yes|no|1x|x2|12|over|under|1|2|x)$/i);
    const groupName = match ? match[1] : key;
    const bucket = buckets.get(groupName) || {};
    bucket[key] = value;
    buckets.set(groupName, bucket);
  }
  return Array.from(buckets.entries()).map(([name, o]) => ({ name, odds: o })).slice(0, 60);
}

function mapBsdStats(payload: any) {
  const stats = payload?.stats || payload;
  const home = stats?.home;
  const away = stats?.away;
  if (!home && !away) return null;

  const value = (side: any, ...keys: string[]) => {
    for (const key of keys) {
      if (side?.[key] !== undefined && side?.[key] !== null) return side[key];
    }
    return 0;
  };
  const pct = (input: any) => {
    const text = String(input ?? '50').replace('%', '');
    return `${Number(text) || 0}%`;
  };

  return {
    possession: {
      home: pct(value(home, 'ball_possession', 'possession')),
      away: pct(value(away, 'ball_possession', 'possession')),
    },
    shotsOnTarget: {
      home: String(value(home, 'shots_on_target', 'shotsOnTarget')),
      away: String(value(away, 'shots_on_target', 'shotsOnTarget')),
    },
    shots: {
      home: String(value(home, 'total_shots', 'shots')),
      away: String(value(away, 'total_shots', 'shots')),
    },
    corners: {
      home: String(value(home, 'corner_kicks', 'corners')),
      away: String(value(away, 'corner_kicks', 'corners')),
    },
    yellowCards: {
      home: String(value(home, 'yellow_cards', 'yellowcards', 'bookings')),
      away: String(value(away, 'yellow_cards', 'yellowcards', 'bookings')),
    },
    redCards: {
      home: String(value(home, 'red_cards', 'redcards')),
      away: String(value(away, 'red_cards', 'redcards')),
    },
    fouls: {
      home: String(value(home, 'fouls', 'fouls_committed')),
      away: String(value(away, 'fouls', 'fouls_committed')),
    },
    offsides: {
      home: String(value(home, 'offsides', 'offside')),
      away: String(value(away, 'offsides', 'offside')),
    },
    assists: {
      home: String(value(home, 'assists')),
      away: String(value(away, 'assists')),
    },
    saves: {
      home: String(value(home, 'saves', 'goalkeeper_saves')),
      away: String(value(away, 'saves', 'goalkeeper_saves')),
    },
  };
}

function mapBsdXg(payload: any) {
  const stats = payload?.stats || payload;
  if (!stats?.home && !stats?.away) return null;
  const xg = (side: any) => Number(side?.xg?.actual ?? side?.expected_goals ?? side?.xg ?? 0) || 0;
  return { home: xg(stats.home), away: xg(stats.away) };
}

function mapBSDEvent(event: any, leagueName?: string) {
  const status = bsdStatus(event);
  const currentMinute = Number(event?.current_minute ?? event?.minute ?? 0);
  const teamName = (...values: any[]) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (value && typeof value?.name === 'string' && value.name.trim()) return value.name.trim();
    }
    return '';
  };
  const homeName = teamName(
    event?.home_team_name,
    event?.home_team,
    event?.homeTeam,
    event?.home,
    event?.teams?.home,
  ) || 'Home';
  const awayName = teamName(
    event?.away_team_name,
    event?.away_team,
    event?.awayTeam,
    event?.away,
    event?.teams?.away,
  ) || 'Away';
  const id = event?.id ?? event?.event_id ?? `${homeName}-${awayName}-${event?.event_date || Date.now()}`;
  const homeGoals = status.state === 'pre'
    ? null
    : Number(event?.home_score ?? event?.goals?.home ?? 0);
  const awayGoals = status.state === 'pre'
    ? null
    : Number(event?.away_score ?? event?.goals?.away ?? 0);
  const league = leagueName || event?.league_name || event?.league?.name ||
    (typeof event?.league === 'string' ? event.league : '') || 'Football';
  const odds = normaliseBsdOdds(event?.odds);
  const mappedStats = mapBsdStats(event);
  const mappedXg = mapBsdXg(event);

  return {
    fixture: {
      id: `bsd_${id}`,
      date: safeIsoDate(event?.event_date || event?.date || event?.kickoff),
      status: {
        short: status.short,
        elapsed: Number.isFinite(currentMinute) && currentMinute > 0 ? currentMinute * 60 : 0,
        state: status.state,
      },
    },
    teams: {
      home: { name: homeName, id: event?.home_team_id ?? homeName, logo: event?.home_team_logo || null },
      away: { name: awayName, id: event?.away_team_id ?? awayName, logo: event?.away_team_logo || null },
    },
    league: { name: league, id: event?.league_id ?? league },
    round: event?.round_label || event?.round_name || null,
    goals: { home: homeGoals, away: awayGoals },
    stats: mappedStats || {
      possession: { home: '50%', away: '50%' },
      shotsOnTarget: { home: '0', away: '0' },
      shots: { home: '0', away: '0' },
      corners: { home: '0', away: '0' },
      yellowCards: { home: '0', away: '0' },
      redCards: { home: '0', away: '0' },
      fouls: { home: '0', away: '0' },
      offsides: { home: '0', away: '0' },
      assists: { home: '0', away: '0' },
      saves: { home: '0', away: '0' },
    },
    xG: mappedXg || { home: 0, away: 0 },
    ...(odds ? { odds } : {}),
    provider: 'bsd',
  };
}

const LIVE_CACHE_TTL = 20 * 1000;
let liveCache: { data: any[]; timestamp: number } | null = null;

export async function getLiveMatches() {
  if (!BSD_API_KEY) return [];
  if (liveCache && Date.now() - liveCache.timestamp < LIVE_CACHE_TTL) {
    return liveCache.data;
  }

  try {
    const [events, leagues] = await Promise.all([
      fetchBsdEvents('/events/live/', {}, 1),
      getBsdLeagueMap().catch(() => ({} as Record<number, string>)),
    ]);
    const matches = events
      .map((event: any) => mapBSDEvent(
        event,
        event?.league_name || leagues[Number(event?.league_id)],
      ))
      .filter((match: any) => match?.fixture?.status?.state === 'in');

    liveCache = { data: matches, timestamp: Date.now() };
    return matches;
  } catch (error: any) {
    console.warn('[BSD] Live matches failed:', error?.message || error);
    return liveCache?.data || [];
  }
}

const UPCOMING_CACHE: Record<string, { data: any[]; timestamp: number }> = {};
const UPCOMING_CACHE_TTL = 5 * 60 * 1000;

export async function getUpcomingMatches(_topFixtures: string[] = []) {
  if (!BSD_API_KEY) return [];
  const cacheKey = `upcoming_${getTodayDateString()}`;
  const cached = UPCOMING_CACHE[cacheKey];
  if (cached && Date.now() - cached.timestamp < UPCOMING_CACHE_TTL) {
    return cached.data;
  }

  try {
    const [events, leagues] = await Promise.all([
      // Window starts yesterday so users in any timezone near the day boundary
      // still see their full "today", and includes matches already in play or
      // finished. Filtering to status=notstarted hid today's games entirely.
      fetchBsdEvents('/events/', {
        date_from: getTodayDateString(-1),
        date_to: getTodayDateString(7),
      }, 4),
      getBsdLeagueMap().catch(() => ({} as Record<number, string>)),
    ]);

    const seen = new Set<string>();
    const matches = events
      .map((event: any) => mapBSDEvent(event, leagues[Number(event?.league_id)]))
      .filter((match: any) => {
        if (seen.has(match.fixture.id)) return false;
        seen.add(match.fixture.id);
        return true;
      })
      .sort(
        (a: any, b: any) =>
          new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime(),
      );

    UPCOMING_CACHE[cacheKey] = { data: matches, timestamp: Date.now() };
    return matches;
  } catch (error: any) {
    console.warn('[BSD] Upcoming matches failed:', error?.message || error);
    return cached?.data || [];
  }
}

export async function searchMatches(query: string) {
  if (!BSD_API_KEY) return [];
  const clean = query.trim();
  if (clean.length < 2) return [];

  try {
    const [events, leagues] = await Promise.all([
      fetchBsdEvents('/events/', {
        team_name: clean,
        date_from: getTodayDateString(-30),
        date_to: getTodayDateString(60),
      }, 1),
      getBsdLeagueMap().catch(() => ({} as Record<number, string>)),
    ]);
    const needle = clean.toLowerCase();
    return events
      .map((event: any) => mapBSDEvent(event, leagues[Number(event?.league_id)]))
      .filter((match: any) =>
        String(match?.teams?.home?.name || '').toLowerCase().includes(needle) ||
        String(match?.teams?.away?.name || '').toLowerCase().includes(needle),
      )
      .sort(
        (a: any, b: any) =>
          new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime(),
      )
      .slice(0, 30);
  } catch (error: any) {
    console.warn('[BSD] Search failed:', error?.message || error);
    return [];
  }
}

async function fetchBsdEventDetail(id: string) {
  const event = await bsdGet(`/events/${encodeURIComponent(id)}/`);
  return event?.event || event?.data || event;
}

export async function getBsdH2H(fixtureId: string, homeName = '', awayName = '') {
  const normalizedId = String(fixtureId || '').replace(/^bsd_/, '').trim();
  if (!/^\d+$/.test(normalizedId) || !BSD_API_KEY) return null;

  try {
    const payload = await bsdGet(`/events/${normalizedId}/h2h/`);
    const rows: any[] = Array.isArray(payload?.recent_matches) ? payload.recent_matches : [];
    const normalizedHome = String(homeName || '').trim().toLowerCase();

    const last5 = rows.slice(0, 5).map((row: any) => {
      const rowHome = String(row?.home || '').trim().toLowerCase();
      const homeIsCurrentHome = !normalizedHome || rowHome === normalizedHome;
      const currentHomeScore = Number(
        homeIsCurrentHome ? row?.home_score : row?.away_score,
      );
      const currentAwayScore = Number(
        homeIsCurrentHome ? row?.away_score : row?.home_score,
      );
      if (!Number.isFinite(currentHomeScore) || !Number.isFinite(currentAwayScore)) return 'D';
      if (currentHomeScore > currentAwayScore) return 'W';
      if (currentHomeScore < currentAwayScore) return 'L';
      return 'D';
    });

    const wins = last5.filter((result: string) => result === 'W').length;
    const draws = last5.filter((result: string) => result === 'D').length;
    const losses = last5.filter((result: string) => result === 'L').length;

    return {
      last5,
      summary: `${wins}W - ${draws}D - ${losses}L`,
      avgGoals: Number(payload?.avg_total_goals ?? 0) || 0,
      totalMatches: Number(payload?.total_matches ?? rows.length) || rows.length,
      homeWins: Number(payload?.home_wins ?? 0) || 0,
      draws: Number(payload?.draws ?? 0) || 0,
      awayWins: Number(payload?.away_wins ?? 0) || 0,
      hypeScore: 70,
      hypeLevel: 'MEDIUM',
      source: 'bsd',
    };
  } catch (error: any) {
    console.warn('[BSD] H2H failed:', error?.message || error);
    return null;
  }
}

export async function getLiveMatchPreview(fixtureId: string) {
  const normalizedId = String(fixtureId || '').replace(/^bsd_/, '').trim();
  if (!/^\d+$/.test(normalizedId) || !BSD_API_KEY) return null;

  try {
    const [event, oddsResult, statsResult, leagues] = await Promise.all([
      fetchBsdEventDetail(normalizedId),
      bsdGet(`/events/${normalizedId}/odds/`).catch(() => null),
      bsdGet(`/events/${normalizedId}/stats/`).catch(() => null),
      getBsdLeagueMap().catch(() => ({} as Record<number, string>)),
    ]);
    if (!event || typeof event !== 'object') return null;

    const mapped: any = mapBSDEvent(event, leagues[Number(event?.league_id)]);
    const odds = normaliseBsdOdds(oddsResult?.odds ?? oddsResult);
    if (odds) mapped.odds = odds;
    const marketSummary = summariseBsdMarkets(oddsResult?.odds ?? oddsResult);
    if (marketSummary.length) mapped.marketBoard = marketSummary;

    const stats = mapBsdStats(statsResult);
    if (stats) mapped.stats = stats;
    const xg = mapBsdXg(statsResult);
    if (xg) mapped.xG = xg;

    return mapped;
  } catch (error: any) {
    console.warn(`[BSD] Match ${normalizedId} detail failed:`, error?.message || error);
    return null;
  }
}

function normaliseName(value: any) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sameTeam(a: string, b: string) {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * Find a BSD match by team names. Used when analysis is started from a
 * historical/legacy match object that does not carry a BSD fixture id.
 */
export async function fetchBsdMatchStatsByName(homeName: string, awayName: string): Promise<any | null> {
  if (!BSD_API_KEY) return null;

  try {
    const events = await fetchBsdEvents('/events/', {
      team_name: homeName,
      date_from: getTodayDateString(-3),
      date_to: getTodayDateString(7),
    }, 1);
    const found = events.find((event: any) =>
      sameTeam(event?.home_team_name || event?.home_team || event?.homeTeam?.name, homeName) &&
      sameTeam(event?.away_team_name || event?.away_team || event?.awayTeam?.name, awayName),
    );
    if (!found?.id) return null;
    return await getLiveMatchPreview(String(found.id));
  } catch (error: any) {
    console.warn('[BSD] Team lookup failed:', error?.message || error);
    return null;
  }
}

export async function getMatchDetails(fixtureId: number | string, match?: any): Promise<MatchData> {
  const idStr = String(fixtureId);
  const homeName = match?.home || match?.homeTeam || 'Home';
  const awayName = match?.away || match?.awayTeam || 'Away';

  const homeStats: TeamStats = {
    id: 1,
    name: homeName,
    last5: { goalsScored: 0, goalsConceded: 0, results: [] },
    season: { played: 0, goalsScored: 0, goalsConceded: 0 },
  };
  const awayStats: TeamStats = {
    id: 2,
    name: awayName,
    last5: { goalsScored: 0, goalsConceded: 0, results: [] },
    season: { played: 0, goalsScored: 0, goalsConceded: 0 },
  };
  const defaultOdds = {
    home: 2.1,
    draw: 3.3,
    away: 3.4,
    over25: 1.9,
    under25: 1.9,
    bttsYes: 1.8,
    dc1X: 1.3,
    dcX2: 1.7,
    over15: 1.3,
    over35: 3.2,
  };

  try {
    const bsdMatch = /^bsd_\d+$/.test(idStr) || /^\d+$/.test(idStr)
      ? await getLiveMatchPreview(idStr)
      : await fetchBsdMatchStatsByName(homeName, awayName);

    if (bsdMatch) {
      return {
        id: idStr,
        home: { ...homeStats, name: bsdMatch?.teams?.home?.name || homeName },
        away: { ...awayStats, name: bsdMatch?.teams?.away?.name || awayName },
        leagueAvgGoals: 2.6,
        odds: {
          ...defaultOdds,
          ...(bsdMatch.odds || {}),
        },
        deepContext: {
          bsd: bsdMatch,
          xG: bsdMatch.xG,
          liveStats: bsdMatch.stats,
          score: `${bsdMatch.goals?.home ?? 0}-${bsdMatch.goals?.away ?? 0}`,
          elapsed: Math.floor(Number(bsdMatch.fixture?.status?.elapsed || 0) / 60),
          league: bsdMatch.league?.name,
          round: bsdMatch.round,
        },
      };
    }
  } catch (error: any) {
    console.warn('[BSD] Match details failed:', error?.message || error);
  }

  return {
    id: idStr,
    home: homeStats,
    away: awayStats,
    leagueAvgGoals: 2.6,
    odds: defaultOdds,
    deepContext: {},
  };
}

const NEWS_LEAGUES = [
  'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1',
  'uefa.champions', 'uefa.europa', 'usa.1',
];
const NEWS_LEAGUE_LABELS: Record<string, string> = {
  'eng.1': 'Premier League',
  'esp.1': 'LaLiga',
  'ita.1': 'Serie A',
  'ger.1': 'Bundesliga',
  'fra.1': 'Ligue 1',
  'uefa.champions': 'Champions League',
  'uefa.europa': 'Europa League',
  'usa.1': 'MLS',
};
const NEWS_CACHE_TTL = 5 * 60 * 1000;
let newsCache: { data: any[]; timestamp: number } | null = null;

function mapESPNNews(article: any, leagueSlug: string) {
  const headline = String(article?.headline || '').trim();
  const url = article?.links?.web?.href || article?.links?.mobile?.href || null;
  if (!headline || !url) return null;

  const image =
    article?.images?.find((img: any) => img?.url)?.url ||
    article?.images?.[0]?.url ||
    null;

  return {
    id: `espn_news_${article?.id || headline}`,
    headline,
    description: String(article?.description || '').trim() || null,
    image,
    url,
    source: 'ESPN',
    byline: article?.byline || null,
    published: article?.published || article?.lastModified || new Date().toISOString(),
    leagueSlug,
    league: NEWS_LEAGUE_LABELS[leagueSlug] || 'Football',
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function getFootballNews(limit = 20, league?: string) {
  const now = Date.now();
  if (!newsCache || now - newsCache.timestamp >= NEWS_CACHE_TTL) {
    const groups = await mapWithConcurrency(NEWS_LEAGUES, 4, (leagueSlug) =>
      axios
        .get(`${ESPN_BASE}/${leagueSlug}/news?limit=8`, { timeout: 6000 })
        .then((res) =>
          (res.data?.articles || [])
            .map((article: any) => mapESPNNews(article, leagueSlug))
            .filter(Boolean),
        )
        .catch((err) => {
          console.warn(`[footballService] ESPN news failed for ${leagueSlug}:`, err?.message || err);
          return [];
        }),
    );

    const seen = new Set<string>();
    const merged = groups.flat().filter((article: any) => {
      const key = String(article.headline).toLowerCase().replace(/\s+/g, ' ').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    merged.sort(
      (a: any, b: any) => new Date(b.published).getTime() - new Date(a.published).getTime(),
    );

    const buckets = new Map<string, any[]>();
    for (const article of merged) {
      const bucket = buckets.get(article.leagueSlug) || [];
      bucket.push(article);
      buckets.set(article.leagueSlug, bucket);
    }
    const interleaved: any[] = [];
    for (let index = 0; interleaved.length < merged.length; index++) {
      let added = false;
      for (const bucket of buckets.values()) {
        if (bucket[index]) {
          interleaved.push(bucket[index]);
          added = true;
        }
      }
      if (!added) break;
    }

    newsCache = { data: interleaved, timestamp: now };
  }

  const articles = league
    ? newsCache.data.filter((article) => article.leagueSlug === league)
    : newsCache.data;
  return articles.slice(0, Math.min(Math.max(limit, 1), 30));
}
