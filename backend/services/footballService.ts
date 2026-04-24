import axios from 'axios';
import { MatchData, TeamStats } from '../../src/types/prediction';

const API_KEY = process.env.SPORTS_API_KEY || '';
const API_BASE = 'https://v2.football.sportsapipro.com/api';
const HEADERS = API_KEY ? { 'x-api-key': API_KEY } : {};

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

function mapSportsApiEvent(e: any) {
  return {
    fixture: { id: `sportsapi_${e.id}`, date: new Date(e.startTimestamp * 1000).toISOString(), status: { short: e.status, elapsed: 0, state: e.status === 'Not started' ? 'pre' : 'in' } },
    teams: { home: { name: e.homeTeam, id: e.homeTeam, logo: null }, away: { name: e.awayTeam, id: e.awayTeam, logo: null } },
    league: { name: e.tournament || 'Leagues', id: e.tournament, slug: e.tournament },
    goals: { home: e.homeScore, away: e.awayScore },
    stats: { possession: { home: '50%', away: '50%' }, shotsOnTarget: { home: '0', away: '0' }, shots: { home: '0', away: '0' }, corners: { home: '0', away: '0' } },
  };
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
  const parts = idStr.startsWith('espn_') ? idStr.split('_') : [];
  const eventId = parts[1] || idStr;
  const leagueSlug = parts[2] || 'eng.1';

  const homeStats: TeamStats = { id: 1, name: match?.home || 'Home', last5: { goalsScored: 0, goalsConceded: 0, results: [] }, season: { played: 0, goalsScored: 0, goalsConceded: 0 } };
  const awayStats: TeamStats = { id: 2, name: match?.away || 'Away', last5: { goalsScored: 0, goalsConceded: 0, results: [] }, season: { played: 0, goalsScored: 0, goalsConceded: 0 } };

  const deepContext: any = {};
  if (idStr.startsWith('espn_')) {
    const summaryRes = await axios.get(`${ESPN_BASE}/${leagueSlug}/summary?event=${eventId}`).catch(() => null);
    const standingsRes = await axios.get(`${ESPN_BASE}/${leagueSlug}/standings`).catch(() => null);
    if (summaryRes?.data) deepContext.summary = summaryRes.data;
    if (summaryRes?.data?.injuries) deepContext.injuries = summaryRes.data.injuries;
    if (standingsRes?.data) deepContext.standings = standingsRes.data;
  }

  return {
    id: idStr,
    home: homeStats,
    away: awayStats,
    leagueAvgGoals: 2.6,
    odds: { home: 2.1, draw: 3.3, away: 3.4, over25: 1.9, under25: 1.9, bttsYes: 1.8, dc1X: 1.3, dcX2: 1.7 },
    deepContext,
  };
}

export async function getLiveMatches() {
  const today = getTodayDateString();
  const promises = POPULAR_LEAGUES.map((league) =>
    axios.get(`${ESPN_BASE}/${league}/scoreboard?dates=${today}`).then((res) => (res.data.events || []).map((e: any) => ({ ...e, _leagueSlug: league }))).catch(() => []),
  );
  const events = (await Promise.all(promises)).flat();
  const liveEvents = events.filter((e: any) => (e.status?.type?.state || e.competitions?.[0]?.status?.type?.state) === 'in');
  const mapped = liveEvents.map((e: any) => mapESPNEvent(e, e._leagueSlug || 'soccer')).filter(Boolean);

  if (mapped.length < 5 && API_KEY) {
    const sportsApiRes = await axios.get(`${API_BASE}/live`, { headers: HEADERS }).catch(() => ({ data: { events: [] } }));
    const mappedSports = (sportsApiRes.data.events || []).map(mapSportsApiEvent);
    const existingTeams = new Set(mapped.map((m: any) => `${m.teams.home.name}-${m.teams.away.name}`));
    for (const item of mappedSports) {
      const key = `${item.teams.home.name}-${item.teams.away.name}`;
      if (!existingTeams.has(key)) mapped.push(item);
    }
  }

  return mapped;
}

const UPCOMING_CACHE: Record<string, { data: any[]; timestamp: number }> = {};
const UPCOMING_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getUpcomingMatches(topFixtures: string[] = []) {
  const startDate = getTodayDateString();
  const cacheKey = `upcoming_${startDate}`;
  
  const cached = UPCOMING_CACHE[cacheKey];
  if (cached && Date.now() - cached.timestamp < UPCOMING_CACHE_TTL) {
    return sortAndFilterUpcoming(cached.data, topFixtures);
  }

  const priorityLeagues = POPULAR_LEAGUES.slice(0, 15);
  const remainingLeagues = POPULAR_LEAGUES.slice(15);

  const fetchLeagues = async (leagues: string[]) => {
    const promises = leagues.map((league) =>
      axios.get(`${ESPN_BASE}/${league}/scoreboard?dates=${startDate}`, { timeout: 5000 })
        .then((res) => (res.data.events || []).map((e: any) => ({ ...e, _leagueSlug: league })))
        .catch(() => [])
    );
    return (await Promise.all(promises)).flat();
  };

  const priorityEvents = await fetchLeagues(priorityLeagues);
  UPCOMING_CACHE[cacheKey] = { data: priorityEvents, timestamp: Date.now() };

  fetchLeagues(remainingLeagues).then(remainingEvents => {
    if (remainingEvents.length > 0) {
      UPCOMING_CACHE[cacheKey].data = [...UPCOMING_CACHE[cacheKey].data, ...remainingEvents];
    }
  });

  return sortAndFilterUpcoming(priorityEvents, topFixtures);
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
