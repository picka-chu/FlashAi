import axios from 'axios';
import { MatchData, TeamStats } from '../../src/types/prediction';

const API_KEY = process.env.SPORTS_API_KEY || process.env.FOOTBALL_API_KEY || '';
const API_BASE = 'https://v2.football.sportsapipro.com/api';
const HEADERS = API_KEY ? { 'x-api-key': API_KEY } : {};
const BSD_API_KEY = process.env.BSD_API_KEY || process.env.BSD_FOOTBALL_API_KEY || '';
const BSD_API_BASE = process.env.BSD_API_BASE || 'https://sports.bzzoiro.com/api';
const BSD_HEADERS = BSD_API_KEY ? { 'x-api-key': BSD_API_KEY, authorization: `Bearer ${BSD_API_KEY}` } : {};

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

const POPULAR_LEAGUES = [
  'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1',
  'uefa.champions', 'uefa.europa', 'uefa.europa.conf',
  'ned.1', 'por.1', 'usa.1', 'mex.1', 'bra.1', 'arg.1',
  'eng.2', 'eng.3', 'eng.4', 'eng.5', 'eng.w.1',
  'esp.2', 'ita.2', 'ger.2', 'fra.2',
  'uefa.nations', 'uefa.super_cup',
  'tur.1', 'bel.1', 'sco.1', 'aut.1', 'sui.1',
  'den.1', 'swe.1', 'nor.1', 'pol.1', 'cze.1',
  'gre.1', 'rus.1', 'ukr.1', 'rou.1', 'hun.1', 'srb.1', 'cro.1',
  'irl.1', 'wal.1',
  'jpn.1', 'kor.1', 'chn.1', 'aus.1',
  'ksa.1', 'qat.1', 'uae.1',
  'arg.2', 'bra.2', 'chi.1', 'col.1', 'uru.1', 'per.1', 'par.1',
  'usa.2', 'usa.open',
  'fifa.world', 'fifa.worldq', 'concacaf.champions', 'conmebol.libertadores', 'conmebol.sudamericana'
];

const LEAGUE_PRIORITY: Record<string, number> = {
  'uefa.champions': 1000,
  'eng.1': 100,
  'esp.1': 90,
  'ger.1': 85,
  'ita.1': 80,
  'fra.1': 75,
  'uefa.europa': 70,
  'uefa.europa.conf': 65,
  'ned.1': 60,
  'por.1': 55,
  'tur.1': 50,
  'usa.1': 45,
  'mex.1': 40,
  'bra.1': 35,
  'arg.1': 30,
};

const BIG_TEAMS = [
  'Real Madrid', 'Barcelona', 'Manchester City', 'Liverpool', 'Arsenal',
  'Bayern Munich', 'PSG', 'Inter Milan', 'AC Milan', 'Juventus',
  'Manchester United', 'Chelsea', 'Tottenham', 'Atletico Madrid', 'Dortmund'
];

function getTodayDateString(offset = 0) {
  const date = new Date();
  if (offset !== 0) date.setDate(date.getDate() + offset);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function extractLeague(e: any) {
  return e?.competitions?.[0]?.league || e?.competitions?.[0]?.competition || e?.league || e?.season?.type || null;
}

function getLeaguePriority(e: any): number {
  const league = extractLeague(e);
  if (!league) return 0;
  const slug = league.slug || '';
  const name = (league.name || league.displayName || '').toLowerCase();

  if (slug === 'uefa.champions' || name.includes('uefa champions league')) return LEAGUE_PRIORITY['uefa.champions'];
  if (LEAGUE_PRIORITY[slug]) return LEAGUE_PRIORITY[slug];
  if (name.includes('premier league')) return LEAGUE_PRIORITY['eng.1'];
  if (name.includes('la liga')) return LEAGUE_PRIORITY['esp.1'];
  if (name.includes('bundesliga')) return LEAGUE_PRIORITY['ger.1'];
  if (name.includes('serie a') && !name.includes('brazil')) return LEAGUE_PRIORITY['ita.1'];
  if (name.includes('ligue 1')) return LEAGUE_PRIORITY['fra.1'];
  return 0;
}

function calculateXG(stats: any) {
  const shotsOnTarget = parseInt(stats.shotsOnTarget || '0', 10);
  const shots = parseInt(stats.shots || '0', 10);
  const corners = parseInt(stats.corners || '0', 10);
  return parseFloat(((shotsOnTarget * 0.3) + ((shots - shotsOnTarget) * 0.05) + (corners * 0.02)).toFixed(2));
}

function mapESPNEvent(e: any, leagueSlug: string) {
  const comp = e.competitions?.[0];
  if (!comp) return null;

  const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
  const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
  if (!home || !away) return null;

  const leagueObj = extractLeague(e);
  const homeStats = home.statistics || [];
  const awayStats = away.statistics || [];
  const getStat = (stats: any[], name: string) => stats.find((s: any) => s.name === name)?.displayValue || '0';

  const stats = {
    possession: { home: getStat(homeStats, 'possessionPct'), away: getStat(awayStats, 'possessionPct') },
    shotsOnTarget: { home: getStat(homeStats, 'shotsOnTarget'), away: getStat(awayStats, 'shotsOnTarget') },
    shots: { home: getStat(homeStats, 'totalShots'), away: getStat(awayStats, 'totalShots') },
    corners: { home: getStat(homeStats, 'cornerKicks'), away: getStat(awayStats, 'cornerKicks') },
  };

  return {
    fixture: {
      id: `espn_${e.id}_${leagueSlug}`,
      date: e.date,
      status: {
        short: comp.status?.type?.shortDetail || 'N/A',
        elapsed: comp.status?.clock || 0,
        state: comp.status?.type?.state || 'pre',
      },
    },
    teams: {
      home: { name: home.team?.displayName, id: home.team?.id, logo: home.team?.logo },
      away: { name: away.team?.displayName, id: away.team?.id, logo: away.team?.logo },
    },
    league: { name: leagueObj?.name || leagueObj?.displayName || 'Leagues', id: leagueObj?.id, slug: leagueObj?.slug || leagueSlug },
    goals: { home: home.score ? parseInt(home.score, 10) : null, away: away.score ? parseInt(away.score, 10) : null },
    stats,
    xG: {
      home: calculateXG({ shotsOnTarget: stats.shotsOnTarget.home, shots: stats.shots.home, corners: stats.corners.home }),
      away: calculateXG({ shotsOnTarget: stats.shotsOnTarget.away, shots: stats.shots.away, corners: stats.corners.away }),
    },
  };
}

function safeIsoDate(value: any) {
  if (!value) return new Date().toISOString();
  const date = typeof value === 'number'
    ? new Date(value > 9999999999 ? value : value * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function mapSportsApiEvent(e: any) {
  const status = String(e?.status || e?.fixture?.status?.short || '').toLowerCase();
  const isPre = status.includes('not started') || status === 'ns' || status === 'pre' || status === 'scheduled';
  const start = e?.startTimestamp || e?.startTime || e?.date || e?.fixture?.date || e?.timestamp;
  const homeName = e?.homeTeam?.name || e?.homeTeam || e?.teams?.home?.name || 'Home';
  const awayName = e?.awayTeam?.name || e?.awayTeam || e?.teams?.away?.name || 'Away';

  return {
    fixture: {
      id: `sportsapi_${e?.id || e?.eventId || e?.matchId || `${homeName}-${awayName}-${start || Date.now()}`}`,
      date: safeIsoDate(start),
      status: { short: e?.status || (isPre ? 'NS' : 'LIVE'), elapsed: 0, state: isPre ? 'pre' : 'in' }
    },
    teams: { home: { name: homeName, id: e?.homeTeam?.id || homeName, logo: e?.homeTeam?.logo || null }, away: { name: awayName, id: e?.awayTeam?.id || awayName, logo: e?.awayTeam?.logo || null } },
    league: { name: e?.tournament?.name || e?.tournament || e?.league?.name || 'Leagues', id: e?.tournament?.id || e?.tournament || e?.league?.id, slug: e?.tournament?.slug || e?.league?.slug },
    goals: { home: Number(e?.homeScore ?? e?.goals?.home ?? 0), away: Number(e?.awayScore ?? e?.goals?.away ?? 0) },
    stats: { possession: { home: '50%', away: '50%' }, shotsOnTarget: { home: '0', away: '0' }, shots: { home: '0', away: '0' }, corners: { home: '0', away: '0' } },
    provider: 'sportsapi',
  };
}

function mapBSDEvent(e: any) {
  const homeName = e?.homeTeam?.name || e?.home?.name || e?.homeTeam || e?.teams?.home?.name || 'Home';
  const awayName = e?.awayTeam?.name || e?.away?.name || e?.awayTeam || e?.teams?.away?.name || 'Away';
  const homeGoals = Number(e?.score?.home ?? e?.homeScore ?? e?.goals?.home ?? 0);
  const awayGoals = Number(e?.score?.away ?? e?.awayScore ?? e?.goals?.away ?? 0);
  const elapsed = Number(e?.status?.elapsed ?? e?.elapsed ?? e?.minute ?? 0);
  const possessionHome = String(e?.stats?.possession?.home ?? e?.statistics?.possession?.home ?? '50%');
  const possessionAway = String(e?.stats?.possession?.away ?? e?.statistics?.possession?.away ?? '50%');
  const shotsOnTargetHome = String(e?.stats?.shotsOnTarget?.home ?? e?.statistics?.shotsOnTarget?.home ?? '0');
  const shotsOnTargetAway = String(e?.stats?.shotsOnTarget?.away ?? e?.statistics?.shotsOnTarget?.away ?? '0');
  const shotsHome = String(e?.stats?.shots?.home ?? e?.statistics?.shots?.home ?? '0');
  const shotsAway = String(e?.stats?.shots?.away ?? e?.statistics?.shots?.away ?? '0');
  const cornersHome = String(e?.stats?.corners?.home ?? e?.statistics?.corners?.home ?? '0');
  const cornersAway = String(e?.stats?.corners?.away ?? e?.statistics?.corners?.away ?? '0');
  const startAt = e?.startTime || e?.date || e?.kickoff || e?.timestamp || Date.now();
  const startIso = safeIsoDate(startAt);
  const id = e?.id || e?.eventId || e?.matchId || `${homeName}-${awayName}-${startIso}`;
  const leagueName = e?.league?.name || e?.competition?.name || e?.tournament?.name || e?.league || 'Live Football';
  const state = String(e?.status?.state || e?.status?.short || e?.status || 'in').toLowerCase().includes('pre') ? 'pre' : 'in';

  return {
    fixture: {
      id: `bsd_${id}`,
      date: startIso,
      status: {
        short: e?.status?.short || e?.status?.label || 'LIVE',
        elapsed: Number.isFinite(elapsed) ? elapsed : 0,
        state,
      },
    },
    teams: {
      home: { name: homeName, id: e?.homeTeam?.id || homeName, logo: e?.homeTeam?.logo || e?.teams?.home?.logo || null },
      away: { name: awayName, id: e?.awayTeam?.id || awayName, logo: e?.awayTeam?.logo || e?.teams?.away?.logo || null },
    },
    league: { name: leagueName, id: e?.league?.id || leagueName, slug: e?.league?.slug || leagueName },
    goals: { home: homeGoals, away: awayGoals },
    stats: {
      possession: { home: possessionHome, away: possessionAway },
      shotsOnTarget: { home: shotsOnTargetHome, away: shotsOnTargetAway },
      shots: { home: shotsHome, away: shotsAway },
      corners: { home: cornersHome, away: cornersAway },
    },
    xG: {
      home: Number(e?.xg?.home ?? e?.stats?.xg?.home ?? 0),
      away: Number(e?.xg?.away ?? e?.stats?.xg?.away ?? 0),
    },
    odds: e?.odds || e?.markets || null,
    provider: "bsd",
  };
}

async function fetchBsdLiveEvents() {
  if (!BSD_API_KEY) return [];
  const urls = [`${BSD_API_BASE}/live/`, `${BSD_API_BASE}/live`];
  for (const url of urls) {
    try {
      const res = await axios.get(url, { headers: BSD_HEADERS, timeout: 8000 });
      const events = res.data?.events || res.data?.matches || res.data?.data || [];
      if (Array.isArray(events) && events.length > 0) return events;
    } catch {
      // try next url
    }
  }
  return [];
}

async function fetchBsdUpcomingEvents() {
  if (!BSD_API_KEY) return [];
  const urls = [`${BSD_API_BASE}/upcoming/`, `${BSD_API_BASE}/upcoming`, `${BSD_API_BASE}/fixtures`, `${BSD_API_BASE}/matches`];
  for (const url of urls) {
    try {
      const res = await axios.get(url, { headers: BSD_HEADERS, timeout: 8000 });
      const events = res.data?.events || res.data?.matches || res.data?.data || [];
      if (Array.isArray(events) && events.length > 0) return events;
    } catch {
      // try next url
    }
  }
  return [];
}

async function fetchSportsApiEvents(path: 'live' | 'matches') {
  if (!API_KEY) return [];
  try {
    const res = await axios.get(`${API_BASE}/${path}`, { headers: HEADERS, timeout: 8000 });
    return res.data?.events || res.data?.matches || res.data?.data || [];
  } catch {
    return [];
  }
}

function normalizeMatchName(value: any) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchDedupeKey(match: any) {
  const home = normalizeMatchName(match?.teams?.home?.name);
  const away = normalizeMatchName(match?.teams?.away?.name);
  const date = match?.fixture?.date ? new Date(match.fixture.date).toISOString().slice(0, 10) : getTodayDateString();
  return `${home}|${away}|${date}`;
}

function mergeMatches(...groups: any[][]) {
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const group of groups) {
    for (const match of group.filter(Boolean)) {
      const key = matchDedupeKey(match);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(match);
      }
    }
  }
  return merged;
}

export async function getLiveMatchPreview(fixtureId: string) {
  const normalizedId = String(fixtureId || "").replace(/^bsd_/, "").trim();
  if (!normalizedId || !BSD_API_KEY) return null;
  const urls = [
    `${BSD_API_BASE}/events/${encodeURIComponent(normalizedId)}/`,
    `${BSD_API_BASE}/events/${encodeURIComponent(normalizedId)}`,
    `${BSD_API_BASE}/matches/${encodeURIComponent(normalizedId)}/`,
    `${BSD_API_BASE}/matches/${encodeURIComponent(normalizedId)}`
  ];
  for (const url of urls) {
    try {
      const res = await axios.get(url, { headers: BSD_HEADERS, timeout: 8000 });
      const event = res.data?.event || res.data?.data || res.data;
      if (event && typeof event === "object") return mapBSDEvent(event);
    } catch {
      // try next url
    }
  }
  return null;
}

/**
 * Fetch rich BSD match stats for a named match (used by prediction pipeline when no fixture ID).
 * Searches BSD live events by team names to find the match.
 */
export async function fetchBsdMatchStatsByName(homeName: string, awayName: string): Promise<any | null> {
  if (!BSD_API_KEY) return null;
  try {
    const liveEvents = await fetchBsdLiveEvents();
    const homeNameLower = homeName.toLowerCase();
    const awayNameLower = awayName.toLowerCase();

    const match = liveEvents.find((e: any) => {
      const h = (e?.homeTeam?.name || e?.home?.name || e?.homeTeam || '').toLowerCase();
      const a = (e?.awayTeam?.name || e?.away?.name || e?.awayTeam || '').toLowerCase();
      return (
        (h.includes(homeNameLower) || homeNameLower.includes(h)) &&
        (a.includes(awayNameLower) || awayNameLower.includes(a))
      );
    });

    if (!match) {
      // Try upcoming matches too
      const upcomingUrls = [`${BSD_API_BASE}/upcoming/`, `${BSD_API_BASE}/upcoming`, `${BSD_API_BASE}/fixtures`];
      for (const url of upcomingUrls) {
        try {
          const res = await axios.get(url, { headers: BSD_HEADERS, timeout: 8000 });
          const events = res.data?.events || res.data?.matches || res.data?.data || [];
          if (Array.isArray(events)) {
            const found = events.find((e: any) => {
              const h = (e?.homeTeam?.name || e?.home?.name || e?.homeTeam || '').toLowerCase();
              const a = (e?.awayTeam?.name || e?.away?.name || e?.awayTeam || '').toLowerCase();
              return (
                (h.includes(homeNameLower) || homeNameLower.includes(h)) &&
                (a.includes(awayNameLower) || awayNameLower.includes(a))
              );
            });
            if (found) return mapBSDEvent(found);
          }
        } catch { continue; }
      }
      return null;
    }

    return mapBSDEvent(match);
  } catch (e) {
    console.warn('[footballService] fetchBsdMatchStatsByName failed:', e);
    return null;
  }
}

export async function searchMatches(query: string) {
  const today = getTodayDateString();
  const promises = POPULAR_LEAGUES.map((league) =>
    axios.get(`${ESPN_BASE}/${league}/scoreboard?dates=${today}`).then((res) => (res.data.events || []).map((e: any) => ({ ...e, _leagueSlug: league }))).catch(() => []),
  );
  const events = (await Promise.all(promises)).flat();
  return events
    .filter((e: any) => e?.name?.toLowerCase().includes(query.toLowerCase()) || e?.competitions?.[0]?.competitors?.some((c: any) => c.team.displayName.toLowerCase().includes(query.toLowerCase())))
    .map((e: any) => mapESPNEvent(e, e._leagueSlug || 'eng.1'))
    .filter(Boolean);
}

export async function getMatchDetails(fixtureId: number | string, match?: any): Promise<MatchData> {
  const idStr = fixtureId.toString();
  const isBSD = idStr.startsWith('bsd_');
  const isESPN = idStr.startsWith('espn_');
  const parts = isESPN ? idStr.split('_') : [];
  const eventId = parts[1] || idStr.replace(/^bsd_/, '');
  const leagueSlug = parts[2] || 'eng.1';

  const homeStats: TeamStats = { id: 1, name: match?.home || 'Home', last5: { goalsScored: 0, goalsConceded: 0, results: [] }, season: { played: 0, goalsScored: 0, goalsConceded: 0 } };
  const awayStats: TeamStats = { id: 2, name: match?.away || 'Away', last5: { goalsScored: 0, goalsConceded: 0, results: [] }, season: { played: 0, goalsScored: 0, goalsConceded: 0 } };

  const deepContext: any = {};

  // 1. Try BSD first for live xG, odds, and stats
  if ((isBSD || BSD_API_KEY) && (match?.home || match?.away)) {
    try {
      const bsdMatch = await fetchBsdMatchStatsByName(match.home, match.away);
      if (bsdMatch) {
        deepContext.bsd = bsdMatch;
        deepContext.xG = bsdMatch.xG;
        deepContext.liveStats = bsdMatch.stats;
        deepContext.score = `${bsdMatch.goals?.home || 0}-${bsdMatch.goals?.away || 0}`;
        deepContext.elapsed = bsdMatch.fixture?.status?.elapsed || 0;
        // Pull BSD odds into base odds structure
        if (bsdMatch.odds) {
          const o = bsdMatch.odds;
          return {
            id: idStr,
            home: homeStats,
            away: awayStats,
            leagueAvgGoals: 2.6,
            odds: {
              home: o['1'] || o.home || 2.10,
              draw: o['X'] || o.draw || 3.30,
              away: o['2'] || o.away || 3.40,
              over25: o.over25 || o['Over 2.5'] || 1.90,
              under25: o.under25 || o['Under 2.5'] || 1.90,
              bttsYes: o.bttsYes || o['BTTS Yes'] || 1.80,
              dc1X: o.dc1X || o['1X'] || 1.30,
              dcX2: o.dcX2 || o['X2'] || 1.70,
              over15: o.over15 || o['Over 1.5'] || 1.30,
              over35: o.over35 || o['Over 3.5'] || 3.20,
            },
            deepContext,
          };
        }
      }
    } catch (e) {
      console.warn('[getMatchDetails] BSD enrichment failed:', e);
    }
  }

  // 2. ESPN detailed summary as fallback
  if (isESPN) {
    try {
      const summaryRes = await axios.get(`${ESPN_BASE}/${leagueSlug}/summary?event=${eventId}`).catch(() => null);
      const standingsRes = await axios.get(`${ESPN_BASE}/${leagueSlug}/standings`).catch(() => null);
      if (summaryRes?.data) deepContext.summary = summaryRes.data;
      if (summaryRes?.data?.injuries) deepContext.injuries = summaryRes.data.injuries;
      if (standingsRes?.data) deepContext.standings = standingsRes.data;
    } catch (e) {
      console.warn('[getMatchDetails] ESPN enrichment failed:', e);
    }
  }

  return {
    id: idStr,
    home: homeStats,
    away: awayStats,
    leagueAvgGoals: 2.6,
    odds: { home: 2.1, draw: 3.3, away: 3.4, over25: 1.9, under25: 1.9, bttsYes: 1.8, dc1X: 1.3, dcX2: 1.7, over15: 1.3, over35: 3.2 },
    deepContext,
  };
}

export async function getLiveMatches() {
  const today = getTodayDateString();
  const [bsdEvents, espnEvents, sportsEvents] = await Promise.all([
    fetchBsdLiveEvents(),
    Promise.all(POPULAR_LEAGUES.map((league) =>
      axios.get(`${ESPN_BASE}/${league}/scoreboard?dates=${today}`, { timeout: 5000 })
        .then((res) => (res.data.events || []).map((e: any) => ({ ...e, _leagueSlug: league })))
        .catch(() => []),
    )).then((groups) => groups.flat()),
    fetchSportsApiEvents('live'),
  ]);

  const bsdMapped = bsdEvents.map(mapBSDEvent).filter(Boolean);
  const espnMapped = espnEvents
    .filter((e: any) => (e.status?.type?.state || e.competitions?.[0]?.status?.type?.state) === 'in')
    .map((e: any) => mapESPNEvent(e, e._leagueSlug || 'soccer'))
    .filter(Boolean);
  const sportsMapped = sportsEvents.map(mapSportsApiEvent).filter((m: any) => m?.fixture?.status?.state === 'in');

  return mergeMatches(bsdMapped, espnMapped, sportsMapped);
}

const UPCOMING_CACHE: Record<string, { data: any[]; timestamp: number }> = {};
const UPCOMING_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getUpcomingMatches(topFixtures: string[] = []) {
  const startDate = getTodayDateString();
  const cacheKey = `upcoming_${startDate}`;
  
  const cached = UPCOMING_CACHE[cacheKey];
  if (cached && Date.now() - cached.timestamp < UPCOMING_CACHE_TTL) {
    return cached.data;
  }

  const fetchLeagues = async (leagues: string[]) => {
    const promises = leagues.map((league) =>
      axios.get(`${ESPN_BASE}/${league}/scoreboard?dates=${startDate}`, { timeout: 5000 })
        .then((res) => (res.data.events || []).map((e: any) => ({ ...e, _leagueSlug: league })))
        .catch(() => [])
    );
    return (await Promise.all(promises)).flat();
  };

  const [espnEvents, bsdEvents, sportsEvents] = await Promise.all([
    fetchLeagues(POPULAR_LEAGUES),
    fetchBsdUpcomingEvents(),
    fetchSportsApiEvents('matches'),
  ]);

  const espnMapped = sortAndFilterUpcoming(espnEvents, topFixtures);
  const bsdMapped = bsdEvents
    .map(mapBSDEvent)
    .filter((m: any) => m?.fixture?.status?.state === 'pre');
  const sportsMapped = sportsEvents
    .map(mapSportsApiEvent)
    .filter((m: any) => m?.fixture?.status?.state === 'pre');

  const merged = mergeMatches(espnMapped, bsdMapped, sportsMapped).sort((a, b) => {
    const dateA = new Date(a?.fixture?.date || 0).getTime();
    const dateB = new Date(b?.fixture?.date || 0).getTime();
    return dateA - dateB;
  });
  UPCOMING_CACHE[cacheKey] = { data: merged, timestamp: Date.now() };

  return merged;
}

function sortAndFilterUpcoming(events: any[], topFixtures: string[]) {
  const upcoming = events.filter((e: any) => (e.status?.type?.state || e.competitions?.[0]?.status?.type?.state) === 'pre');

  upcoming.sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();

    if (topFixtures.length > 0) {
      const indexA = topFixtures.findIndex((f) => nameA.includes(f.toLowerCase().split(' vs ')[0] || ''));
      const indexB = topFixtures.findIndex((f) => nameB.includes(f.toLowerCase().split(' vs ')[0] || ''));
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
    }

    const isBigA = BIG_TEAMS.some((t) => nameA.includes(t.toLowerCase()));
    const isBigB = BIG_TEAMS.some((t) => nameB.includes(t.toLowerCase()));
    if (isBigA && !isBigB) return -1;
    if (!isBigA && isBigB) return 1;

    const prioA = getLeaguePriority(a);
    const prioB = getLeaguePriority(b);
    if (prioA !== prioB) return prioB - prioA;

    return dateA - dateB;
  });

  return upcoming.map((e: any) => mapESPNEvent(e, e._leagueSlug || 'soccer')).filter(Boolean);
}
