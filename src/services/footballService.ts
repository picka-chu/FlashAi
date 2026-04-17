import axios from 'axios';
import { MatchData, TeamStats } from '../types/prediction';
import { fetchLiveMatchesFallback, getTopFixturesFromSearch } from './geminiService';

const API_KEY = 'cd225a94-3811-4d50-9f5d-0e1d458ddb0a';
const API_BASE = 'https://v2.football.sportsapipro.com/api';

const HEADERS = {
  'x-api-key': API_KEY
};

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

const POPULAR_LEAGUES = [
  "eng.1", "esp.1", "ita.1", "ger.1", "fra.1", 
  "uefa.champions", "uefa.europa", "uefa.europa.conf",
  "ned.1", "por.1", "usa.1", "mex.1", "bra.1", "arg.1"
];

const CACHE: Record<string, { data: any, timestamp: number }> = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getFromCache(key: string) {
  const cached = CACHE[key];
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  return null;
}

function setCache(key: string, data: any) {
  CACHE[key] = { data, timestamp: Date.now() };
}

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
  'eng.2': 25,
  'esp.2': 20,
  'ger.2': 15,
  'ita.2': 10,
  'fra.2': 5,
};

const BIG_TEAMS = [
  'Real Madrid', 'Barcelona', 'Manchester City', 'Liverpool', 'Arsenal', 
  'Bayern Munich', 'PSG', 'Inter Milan', 'AC Milan', 'Juventus', 
  'Manchester United', 'Chelsea', 'Tottenham', 'Atletico Madrid', 'Dortmund'
];

function extractLeague(e: any) {
  if (!e) return null;
  return e.competitions?.[0]?.league || e.league || e.season?.type || null;
}

function getLeaguePriority(e: any): number {
  const league = extractLeague(e);
  if (!league) return 0;
  
  const slug = league.slug || '';
  const name = (league.name || league.displayName || '').toLowerCase();
  
  if (slug === 'uefa.champions' || name.includes('uefa champions league')) return LEAGUE_PRIORITY['uefa.champions'];
  if (LEAGUE_PRIORITY[slug]) return LEAGUE_PRIORITY[slug];
  
  if (name.includes('premier league') || name.includes('england premier')) return LEAGUE_PRIORITY['eng.1'];
  if (name.includes('la liga') || name.includes('spanish primera')) return LEAGUE_PRIORITY['esp.1'];
  if (name.includes('bundesliga') || name.includes('german bundesliga')) return LEAGUE_PRIORITY['ger.1'];
  if (name.includes('serie a') || name.includes('italian serie a')) return LEAGUE_PRIORITY['ita.1'];
  if (name.includes('ligue 1') || name.includes('french ligue 1')) return LEAGUE_PRIORITY['fra.1'];
  if (name.includes('europa league') || name.includes('uefa europa')) return LEAGUE_PRIORITY['uefa.europa'];
  if (name.includes('eredivisie')) return LEAGUE_PRIORITY['ned.1'];
  if (name.includes('primeira liga')) return LEAGUE_PRIORITY['por.1'];
  if (name.includes('super lig')) return LEAGUE_PRIORITY['tur.1'];
  if (name.includes('major league soccer') || name === 'mls') return LEAGUE_PRIORITY['usa.1'];
  if (name.includes('liga mx')) return LEAGUE_PRIORITY['mex.1'];
  if (name.includes('serie a') && name.includes('brazil')) return LEAGUE_PRIORITY['bra.1'];
  if (name.includes('primera division') && name.includes('argentina')) return LEAGUE_PRIORITY['arg.1'];
  
  return 0;
}

function getTodayDateString(offset = 0) {
  const date = new Date();
  if (offset !== 0) date.setDate(date.getDate() + offset);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function calculateXG(stats: any) {
  const shotsOnTarget = parseInt(stats.shotsOnTarget || '0');
  const shots = parseInt(stats.shots || '0');
  const corners = parseInt(stats.corners || '0');
  
  // Basic xG estimation algorithm
  // Shots on target are weighted higher
  // Corners provide a small boost
  let xG = (shotsOnTarget * 0.3) + ((shots - shotsOnTarget) * 0.05) + (corners * 0.02);
  return parseFloat(xG.toFixed(2));
}

function mapESPNEvent(e: any, leagueSlug: string) {
  const comp = e.competitions[0];
  const home = comp.competitors.find((c: any) => c.homeAway === 'home');
  const away = comp.competitors.find((c: any) => c.homeAway === 'away');
  const leagueObj = extractLeague(e);
  
  const homeStats = home.statistics || [];
  const awayStats = away.statistics || [];
  
  const getStat = (stats: any[], name: string) => stats.find((s: any) => s.name === name)?.displayValue || '0';

  const stats = {
    possession: {
      home: getStat(homeStats, 'possessionPct'),
      away: getStat(awayStats, 'possessionPct')
    },
    shotsOnTarget: {
      home: getStat(homeStats, 'shotsOnTarget'),
      away: getStat(awayStats, 'shotsOnTarget')
    },
    shots: {
      home: getStat(homeStats, 'totalShots'),
      away: getStat(awayStats, 'totalShots')
    },
    corners: {
      home: getStat(homeStats, 'cornerKicks'),
      away: getStat(awayStats, 'cornerKicks')
    }
  };

  return {
    fixture: {
      id: `espn_${e.id}_${leagueSlug}`,
      date: e.date,
      status: { 
        short: comp.status.type.shortDetail,
        elapsed: comp.status.clock || 0,
        state: comp.status.type.state
      }
    },
    teams: {
      home: { name: home.team.displayName, id: home.team.id, logo: home.team.logo },
      away: { name: away.team.displayName, id: away.team.id, logo: away.team.logo }
    },
    league: { 
      name: leagueObj?.name || leagueObj?.displayName || 'Leagues', 
      id: leagueObj?.id, 
      slug: leagueObj?.slug || leagueSlug 
    },
    goals: { 
      home: home.score ? parseInt(home.score) : null, 
      away: away.score ? parseInt(away.score) : null 
    },
    stats,
    xG: {
      home: calculateXG({ shotsOnTarget: stats.shotsOnTarget.home, shots: stats.shots.home, corners: stats.corners.home }),
      away: calculateXG({ shotsOnTarget: stats.shotsOnTarget.away, shots: stats.shots.away, corners: stats.corners.away })
    }
  };
}

function mapSportsApiEvent(e: any) {
  return {
    fixture: {
      id: `sportsapi_${e.id}`,
      date: new Date(e.startTimestamp * 1000).toISOString(),
      status: { 
        short: e.status,
        elapsed: e.status === '1st half' || e.status === '2nd half' ? 45 : 0,
        state: e.status === 'Not started' ? 'pre' : 'in'
      }
    },
    teams: {
      home: { name: e.homeTeam, id: e.homeTeam, logo: null },
      away: { name: e.awayTeam, id: e.awayTeam, logo: null }
    },
    league: { 
      name: e.tournament || 'Leagues', 
      id: e.tournament, 
      slug: e.tournament 
    },
    goals: { 
      home: e.homeScore, 
      away: e.awayScore 
    },
    stats: {
      possession: { home: '50%', away: '50%' },
      shotsOnTarget: { home: '0', away: '0' },
      shots: { home: '0', away: '0' },
      corners: { home: '0', away: '0' }
    }
  };
}

export async function searchMatches(query: string) {
  const today = getTodayDateString();
  try {
    const promises = POPULAR_LEAGUES.map(league => 
      axios.get(`${ESPN_BASE}/${league}/scoreboard?dates=${today}`)
        .then(res => (res.data.events || []).map((e: any) => ({ ...e, _leagueSlug: league })))
        .catch(() => [])
    );
    
    const results = await Promise.all(promises);
    const events = results.flat();

    const filtered = events.filter((e: any) => 
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      e.competitions[0].competitors.some((c: any) => c.team.displayName.toLowerCase().includes(query.toLowerCase()))
    );

    return filtered.map((e: any) => mapESPNEvent(e, e._leagueSlug || 'eng.1'));
  } catch (e) {
    console.error("ESPN search failed:", e);
    return [];
  }
}

export async function getMatchDetails(fixtureId: number | string, match?: any): Promise<MatchData> {
  let idStr = fixtureId.toString();
  let eventId = idStr;
  let leagueSlug = 'eng.1';

  if (idStr.startsWith('espn_')) {
    const parts = idStr.split('_');
    eventId = parts[1];
    leagueSlug = parts[2] || 'eng.1';
  }

  let homeStats: TeamStats = { id: 1, name: match?.home || "Home", last5: { goalsScored: 0, goalsConceded: 0, results: [] }, season: { played: 0, goalsScored: 0, goalsConceded: 0 } };
  let awayStats: TeamStats = { id: 2, name: match?.away || "Away", last5: { goalsScored: 0, goalsConceded: 0, results: [] }, season: { played: 0, goalsScored: 0, goalsConceded: 0 } };
  
  let deepContext: any = {};

  if (idStr.startsWith('espn_')) {
    try {
      // STEP 3: Get match intelligence (Summary)
      const summaryRes = await axios.get(`${ESPN_BASE}/${leagueSlug}/summary?event=${eventId}`);
      deepContext.summary = summaryRes.data;

      // Extract injuries if available
      if (summaryRes.data.injuries) {
        deepContext.injuries = summaryRes.data.injuries;
      }

      // STEP 5: Get standings context
      const standingsRes = await axios.get(`${ESPN_BASE}/${leagueSlug}/standings`).catch(() => null);
      if (standingsRes?.data) {
        deepContext.standings = standingsRes.data;
      }

    } catch (e) {
      console.warn("Failed to fetch deep ESPN context", e);
    }
  }

  // Fallback to sportsapipro if needed
  let sportsApiId = idStr;
  if (sportsApiId.startsWith('espn_') && match) {
    try {
      const dateStr = new Date(match.fixture?.date || Date.now()).toISOString().split('T')[0];
      const res = await axios.get(`${API_BASE}/matches`, {
        headers: HEADERS,
        params: { date: dateStr }
      });
      const events = res.data.events || [];
      const found = events.find((e: any) => 
        (e.homeTeam.toLowerCase().includes(match.home.toLowerCase()) || match.home.toLowerCase().includes(e.homeTeam.toLowerCase())) &&
        (e.awayTeam.toLowerCase().includes(match.away.toLowerCase()) || match.away.toLowerCase().includes(e.awayTeam.toLowerCase()))
      );
      if (found) {
        sportsApiId = found.id.toString();
      }
    } catch (e: any) {
      // Ignore
    }
  }

  if (sportsApiId.startsWith('sportsapi_')) {
    sportsApiId = sportsApiId.replace('sportsapi_', '');
  }

  if (!sportsApiId.startsWith('espn_')) {
    try {
      const statsRes = await axios.get(`${API_BASE}/match/${sportsApiId}/statistics`, { headers: HEADERS }).catch(() => null);
      const h2hRes = await axios.get(`${API_BASE}/match/${sportsApiId}/h2h`, { headers: HEADERS }).catch(() => null);
      
      if (h2hRes?.data?.data?.teamDuel) {
        const duel = h2hRes.data.data.teamDuel;
        homeStats.last5.results = Array(duel.homeWins).fill('W').concat(Array(duel.draws).fill('D')).concat(Array(duel.awayWins).fill('L'));
        awayStats.last5.results = Array(duel.awayWins).fill('W').concat(Array(duel.draws).fill('D')).concat(Array(duel.homeWins).fill('L'));
      }
      
      if (statsRes?.data?.data?.statistics) {
        const stats = statsRes.data.data.statistics[0]?.groups?.[0]?.statisticsItems || [];
        const possession = stats.find((s: any) => s.key === 'ballPossession');
        if (possession) {
          homeStats.season.played = 10;
          awayStats.season.played = 10;
        }
      }
    } catch (e: any) {
      // Ignore
    }
  }

  return {
    id: idStr,
    home: homeStats,
    away: awayStats,
    leagueAvgGoals: 2.6,
    odds: {
      home: 2.1,
      draw: 3.3,
      away: 3.4,
      over25: 1.9,
      under25: 1.9,
      bttsYes: 1.8,
      dc1X: 1.3,
      dcX2: 1.7
    },
    deepContext
  };
}

export async function getLiveMatches() {
  const cacheKey = 'live_matches';
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const today = getTodayDateString();
    
    const promises = POPULAR_LEAGUES.map(league => 
      axios.get(`${ESPN_BASE}/${league}/scoreboard?dates=${today}`)
        .then(res => (res.data.events || []).map((e: any) => ({ ...e, _leagueSlug: league })))
        .catch(() => [])
    );
    
    const results = await Promise.all(promises);
    const events = results.flat();
    
    // Filter for live matches
    const liveEvents = events.filter((e: any) => {
      const state = e.status?.type?.state || e.competitions?.[0]?.status?.type?.state;
      return state === 'in';
    });

    let mapped: any[] = [];
    if (liveEvents.length > 0) {
      mapped = liveEvents.map((e: any) => mapESPNEvent(e, e._leagueSlug || 'soccer'));
    }

    // If ESPN is thin, fallback to SportsAPIPro
    if (mapped.length < 5) {
      const sportsApiRes = await axios.get(`${API_BASE}/live`, { headers: HEADERS }).catch(() => ({ data: { events: [] } }));
      const sportsEvents = sportsApiRes.data.events || [];
      const mappedSports = sportsEvents.map(mapSportsApiEvent);
      
      // Merge and remove duplicates by team names
      const existingTeams = new Set(mapped.map(m => `${m.teams.home.name}-${m.teams.away.name}`));
      mappedSports.forEach(m => {
        const key = `${m.teams.home.name}-${m.teams.away.name}`;
        if (!existingTeams.has(key)) {
          mapped.push(m);
        }
      });
    }

    if (mapped.length > 0) {
      setCache(cacheKey, mapped);
      return mapped;
    }

    // Final fallback: fetch our auto-cached Supabase data instead of hitting Gemini directly from client
    const customApiRes = await fetch('/api/common/cache?key=live');
    if (customApiRes.ok) {
       const { data } = await customApiRes.json();
       if (data && data.length > 0) {
         setCache(cacheKey, data);
         return data;
       }
    }
    
    return [];
  } catch (e) {
    console.warn("Live matches failed, trying backend cache...");
    try {
      const customApiRes = await fetch('/api/common/cache?key=live');
      if (customApiRes.ok) {
         const { data } = await customApiRes.json();
         if (data) return data;
      }
    } catch(err) {
      // ignore
    }
    return [];
  }
}

export async function getUpcomingMatches() {
  const cacheKey = 'upcoming_matches';
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const startDate = getTodayDateString();
  const endDate = getTodayDateString(14);
  const dateRange = `${startDate}-${endDate}`;

  try {
    const promises = [];
    for (const league of POPULAR_LEAGUES) {
      promises.push(
        axios.get(`${ESPN_BASE}/${league}/scoreboard?dates=${dateRange}`)
          .then(res => (res.data.events || []).map((e: any) => ({ ...e, _leagueSlug: league })))
          .catch(() => [])
      );
    }
    
    const results = await Promise.all(promises);
    const flattened = results.flat();

    const upcoming = flattened.filter((e: any) => {
      const state = e.status?.type?.state || e.competitions?.[0]?.status?.type?.state;
      return state === 'pre';
    });

    const topFixtures = await getTopFixturesFromSearch();

    upcoming.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const startOfToday = today.getTime();
      const startOfTomorrow = startOfToday + 86400000;

      // Check if matches are on different days
      const isDateA_Today = dateA >= startOfToday && dateA < startOfTomorrow;
      const isDateB_Today = dateB >= startOfToday && dateB < startOfTomorrow;

      if (isDateA_Today && !isDateB_Today) return -1;
      if (!isDateA_Today && isDateB_Today) return 1;

      // If they are on the same day (or both NOT today), use the other criteria
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();

      if (topFixtures.length > 0) {
        const findIndex = (matchName: string) => {
          return topFixtures.findIndex(f => {
            const parts = f.toLowerCase().split(' vs ');
            if (parts.length !== 2) return false;
            const [h, v] = parts;
            
            const hTokens = h.split(' ').filter(t => t.length > 2);
            const vTokens = v.split(' ').filter(t => t.length > 2);
            
            const hMatch = hTokens.every(t => matchName.includes(t)) || matchName.includes(h);
            const vMatch = vTokens.every(t => matchName.includes(t)) || matchName.includes(v);
            
            return hMatch && vMatch;
          });
        };

        const indexA = findIndex(nameA);
        const indexB = findIndex(nameB);

        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
      }

      const isBigA = BIG_TEAMS.some(t => nameA.includes(t.toLowerCase()));
      const isBigB = BIG_TEAMS.some(t => nameB.includes(t.toLowerCase()));
      if (isBigA && !isBigB) return -1;
      if (!isBigA && isBigB) return 1;

      const prioA = getLeaguePriority(a);
      const prioB = getLeaguePriority(b);
      if (prioA !== prioB) return prioB - prioA;
      
      return dateA - dateB;
    });

    const mapped = upcoming.map((e: any) => {
      return mapESPNEvent(e, e._leagueSlug || 'soccer');
    });

    setCache(cacheKey, mapped);
    return mapped;
  } catch (e) {
    console.warn("ESPN upcoming matches failed, trying Gemini...");
    const fallback = await fetchLiveMatchesFallback();
    setCache(cacheKey, fallback);
    return fallback;
  }
}

export async function recordMatchClick(matchId: string, teams: string) {
  try {
    await axios.post('/api/trending/click', { matchId, teams });
  } catch (e) {
    console.error("Failed to record click", e);
  }
}

export async function getTrendingPicks() {
  try {
    const res = await axios.get('/api/trending');
    return res.data;
  } catch (e) {
    console.error("Failed to fetch trending", e);
    return [];
  }
}
