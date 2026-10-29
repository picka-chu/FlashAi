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
  // Derive the calendar date in the configured match timezone first, then
  // apply day offsets in UTC calendar space. Adding 24 hours to the current
  // instant can otherwise skip/repeat a date around timezone/DST transitions.
  const parts = dayFormatter.formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  const year = Number(part('year'));
  const month = Number(part('month'));
  const day = Number(part('day'));
  const calendarDate = new Date(Date.UTC(year, month - 1, day + offset));
  return [
    calendarDate.getUTCFullYear(),
    String(calendarDate.getUTCMonth() + 1).padStart(2, '0'),
    String(calendarDate.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function safeIsoDate(value: any) {
  if (!value) return '';
  // Preserve date-only provider values as a stable instant inside that
  // calendar day. UTC midnight can render as the previous day in negative
  // offsets, while local midnight can shift in deployments with another TZ.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00.000Z`).toISOString();
  }
  const date = typeof value === 'number'
    ? new Date(value > 9999999999 ? value : value * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function fixtureCalendarKey(value: any) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = typeof value === 'number'
    ? new Date(value > 9999999999 ? value : value * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dayFormatter.format(date);
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

function normaliseBsdOdds(payload: any) {
  if (!payload || typeof payload !== 'object') return null;
  // Providers vary in naming and sometimes wrap prices under an "odds" key.
  // Flatten numeric leaves without inventing prices or treating market labels as odds.
  const source = payload.odds && typeof payload.odds === 'object' ? payload.odds : payload;
  const flattened: Record<string, number> = {};
  const normaliseKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const visit = (value: any, prefix = '') => {
    if (!value || typeof value !== 'object') return;
    for (const [rawKey, child] of Object.entries(value)) {
      const key = normaliseKey(rawKey);
      const fullKey = prefix ? `${prefix}_${key}` : key;
      if (typeof child === 'number' || (typeof child === 'string' && child.trim() !== '')) {
        const price = Number(child);
        if (Number.isFinite(price) && price > 1.01 && price <= 100) {
          flattened[fullKey] = price;
          if (!(key in flattened)) flattened[key] = price;
        }
      } else if (child && typeof child === 'object' && !Array.isArray(child)) {
        visit(child, fullKey);
      }
    }
  };
  visit(source);
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = Number(source[key] ?? flattened[normaliseKey(key)]);
      if (Number.isFinite(value) && value > 1.01 && value <= 100) return value;
    }
    return undefined;
  };

  const mapped: Record<string, number> = { ...flattened };
  const aliases: Record<string, string[]> = {
    home: ['home_win', 'home', '1'],
    draw: ['draw', 'x'],
    away: ['away_win', 'away', '2'],
    over05: ['over_05_goals', 'over05', 'over_0_5'],
    under05: ['under_05_goals', 'under05', 'under_0_5'],
    over15: ['over_15_goals', 'over15', 'over_1_5'],
    under15: ['under_15_goals', 'under15', 'under_1_5'],
    over25: ['over_25_goals', 'over25', 'over_2_5'],
    under25: ['under_25_goals', 'under25', 'under_2_5'],
    over35: ['over_35_goals', 'over35', 'over_3_5'],
    under35: ['under_35_goals', 'under35', 'under_3_5'],
    over45: ['over_45_goals', 'over45', 'over_4_5'],
    under45: ['under_45_goals', 'under45', 'under_4_5'],
    over55: ['over_55_goals', 'over55', 'over_5_5'],
    under55: ['under_55_goals', 'under55', 'under_5_5'],
    bttsYes: ['btts_yes', 'bttsyes', 'both_teams_to_score_yes'],
    bttsNo: ['btts_no', 'bttsno', 'both_teams_to_score_no'],
    dc1X: ['double_chance_1x', 'dc1x', '1x'],
    dcX2: ['double_chance_x2', 'dcx2', 'x2'],
    dc12: ['double_chance_12', 'dc12', '12'],
    dnb1: ['draw_no_bet_home', 'dnb1'],
    dnb2: ['draw_no_bet_away', 'dnb2'],
    homeScores: ['home_team_to_score', 'home_to_score', 'home_team_over_05'],
    awayScores: ['away_team_to_score', 'away_to_score', 'away_team_over_05'],
  };
  for (const [market, keys] of Object.entries(aliases)) {
    const price = pick(...keys);
    if (price !== undefined) mapped[market] = price;
  }
  return Object.keys(mapped).length ? mapped : null;
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
      dateKey: fixtureCalendarKey(event?.event_date || event?.date || event?.kickoff),
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
    },
    xG: mappedXg || { home: 0, away: 0 },
    statsAvailable: Boolean(mappedStats),
    xGAvailable: Boolean(mappedXg),
    oddsAvailable: Boolean(odds && Object.keys(odds).length),
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

// Competition priority keeps high-interest fixtures prominent in featured
// picks and feeds. Match names are provider-dependent, so use normalized
// league-name patterns rather than provider-specific numeric IDs.
const LEAGUE_PRIORITY: Array<{ weight: number; patterns: RegExp[] }> = [
  { weight: 100, patterns: [/\buefa champions league\b/i, /\bchampions league\b/i] },
  { weight: 96, patterns: [/\bpremier league\b/i, /\benglish premier league\b/i] },
  { weight: 94, patterns: [/\blaliga\b/i, /\bla liga\b/i, /\bprimera division\b/i] },
  { weight: 92, patterns: [/\bserie a\b/i, /\bitalian serie a\b/i] },
  { weight: 90, patterns: [/\bbundesliga\b/i] },
  { weight: 88, patterns: [/\bligue 1\b/i] },
  { weight: 86, patterns: [/\beuropa league\b/i, /\buefa europa\b/i] },
  { weight: 82, patterns: [/\bfa cup\b/i, /\bcopa del rey\b/i, /\bcoppa italia\b/i, /\bdfb pokal\b/i, /\bdfl cup\b/i] },
  { weight: 80, patterns: [/\bconference league\b/i, /\buefa conference\b/i] },
  { weight: 78, patterns: [/\bworld cup\b/i, /\beuro\b/i, /\bcopa america\b/i, /\bnations league\b/i] },
  { weight: 76, patterns: [/\bmls\b/i, /\bmajor league soccer\b/i] },
  { weight: 74, patterns: [/\bprimeira liga\b/i, /\bliga portugal\b/i, /\beredivisie\b/i, /\bscottish premiership\b/i] },
];

function getLeagueWeight(leagueName: unknown): number {
  const name = String(leagueName || '').trim();
  if (!name) return 0;
  const match = LEAGUE_PRIORITY.find(({ patterns }) => patterns.some((pattern) => pattern.test(name)));
  return match?.weight ?? 10;
}

function compareFixturesByLeaguePriority(a: any, b: any): number {
  const weightDifference = getLeagueWeight(b?.league?.name) - getLeagueWeight(a?.league?.name);
  if (weightDifference !== 0) return weightDifference;
  return new Date(a?.fixture?.date).getTime() - new Date(b?.fixture?.date).getTime();
}

export async function getUpcomingMatches(_topFixtures: string[] = []) {
  if (!BSD_API_KEY) return [];
  const cacheKey = `upcoming_${getTodayDateString()}`;
  const cached = UPCOMING_CACHE[cacheKey];
  if (cached && Date.now() - cached.timestamp < UPCOMING_CACHE_TTL) {
    return cached.data;
  }

  try {
    const [events, leagues] = await Promise.all([
      // Some providers only return complete event sets when the range begins
      // on the previous day. Keep that wider fetch, then filter to today's
      // calendar date in MATCH_TIMEZONE below so yesterday never leaks into
      // the client-facing "upcoming" feed.
      fetchBsdEvents('/events/', {
        date_from: getTodayDateString(-1),
        date_to: getTodayDateString(7),
      }, 4),
      getBsdLeagueMap().catch(() => ({} as Record<number, string>)),
    ]);

    const todayKey = getTodayDateString();
    const seen = new Set<string>();
    const matches = events
      .map((event: any) => mapBSDEvent(event, leagues[Number(event?.league_id)]))
      .filter((match: any) => {
        const fixtureDate = new Date(match?.fixture?.date);
        const fixtureKey = String(match?.fixture?.dateKey || (Number.isNaN(fixtureDate.getTime()) ? '' : dayFormatter.format(fixtureDate)));
        if (!fixtureKey) return false;
        // The provider range intentionally starts yesterday, but the public
        // upcoming feed must never include a fixture from a prior calendar day.
        if (fixtureKey < todayKey) return false;
        const id = String(match?.fixture?.id ?? '');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort(compareFixturesByLeaguePriority);

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
    // Fetch independent provider resources concurrently to keep match analysis
    // fast while still enriching it with prices, in-play statistics and H2H.
    const [event, oddsResult, statsResult, h2h, leagues] = await Promise.all([
      fetchBsdEventDetail(normalizedId),
      bsdGet(`/events/${normalizedId}/odds/`).catch(() => null),
      bsdGet(`/events/${normalizedId}/stats/`).catch(() => null),
      getBsdH2H(normalizedId).catch(() => null),
      getBsdLeagueMap().catch(() => ({} as Record<number, string>)),
    ]);
    if (!event || typeof event !== 'object') return null;

    const mapped: any = mapBSDEvent(event, leagues[Number(event?.league_id)]);
    const odds = normaliseBsdOdds(oddsResult?.odds);
    if (odds) mapped.odds = odds;

    const stats = mapBsdStats(statsResult);
    if (stats) mapped.stats = stats;
    const xg = mapBsdXg(statsResult);
    if (xg) mapped.xG = xg;
    if (h2h) mapped.h2h = h2h;
    mapped.statsAvailable = Boolean(stats);
    mapped.xGAvailable = Boolean(xg);
    mapped.oddsAvailable = Boolean(odds && Object.keys(odds).length);

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
  // Never synthesize bookmaker prices: missing odds must remain missing so
  // the value engine cannot mistake assumptions for a real market quote.
  const noOdds: Record<string, number> = {};

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
        odds: { ...(bsdMatch.odds || {}) },
        deepContext: {
          bsd: bsdMatch,
          xG: bsdMatch.xG,
          liveStats: bsdMatch.stats,
          score: `${bsdMatch.goals?.home ?? 0}-${bsdMatch.goals?.away ?? 0}`,
          elapsed: Math.floor(Number(bsdMatch.fixture?.status?.elapsed || 0) / 60),
          league: bsdMatch.league?.name,
          round: bsdMatch.round,
          h2h: bsdMatch.h2h ?? null,
          dataSource: 'bsd',
          oddsAvailable: Boolean(bsdMatch.oddsAvailable && bsdMatch.odds && Object.keys(bsdMatch.odds).length),
          statsAvailable: Boolean(bsdMatch.statsAvailable),
          xGAvailable: Boolean(bsdMatch.xGAvailable),
          h2hAvailable: Boolean(bsdMatch.h2h),
          fetchedAt: new Date().toISOString(),
          dataQualityWarning: !bsdMatch.odds || !Object.keys(bsdMatch.odds).length
            ? 'No bookmaker odds returned by the provider; value bets are unavailable for unpriced markets.'
            : undefined,
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
    odds: noOdds,
    deepContext: {
      dataQualityWarning: 'Official match data unavailable; team statistics and bookmaker odds were not verified.',
      dataSource: 'unavailable',
      oddsAvailable: false,
      statsAvailable: false,
      fetchedAt: new Date().toISOString(),
    },
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
