/**
 * ESPN team statistics enrichment (fallback data source).
 *
 * BSD's free tier exposes events/odds/stats/h2h but no season or recent-form
 * data, which starved the Dixon-Coles model and (before this service) forced
 * fabricated fallbacks. ESPN's public site API provides, per team:
 *   - season record: gamesPlayed, goals for/against (pointsFor/pointsAgainst)
 *   - schedule with inline final scores → real last-5 form and goal rates
 *
 * Everything is cached and strictly time-boxed so /api/analyze stays fast:
 * a failed or slow lookup simply leaves the model on league priors.
 */

import axios from 'axios';
import type { MatchData } from '../../src/types/prediction';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const REQUEST_TIMEOUT_MS = 6_000;
const TEAM_LIST_TTL_MS = 6 * 60 * 60 * 1000;
const TEAM_FORM_TTL_MS = 30 * 60 * 1000;

/** BSD/display league name (normalised) → ESPN league slug. */
const LEAGUE_SLUGS: Record<string, string> = {
  'premier league': 'eng.1',
  'english premier league': 'eng.1',
  'epl': 'eng.1',
  'championship': 'eng.2',
  'la liga': 'esp.1',
  'laliga': 'esp.1',
  'la liga ea sports': 'esp.1',
  'primera division': 'esp.1',
  'serie a': 'ita.1',
  'italian serie a': 'ita.1',
  'bundesliga': 'ger.1',
  'german bundesliga': 'ger.1',
  'ligue 1': 'fra.1',
  'french ligue 1': 'fra.1',
  'ligue 1 mcdonalds': 'fra.1',
  'eredivisie': 'ned.1',
  'dutch eredivisie': 'ned.1',
  'primeira liga': 'por.1',
  'liga portugal': 'por.1',
  'jupiler pro league': 'bel.1',
  'pro league': 'bel.1',
  'super lig': 'tur.1',
  'turkish super lig': 'tur.1',
  'mls': 'usa.1',
  'major league soccer': 'usa.1',
  'liga mx': 'mex.1',
  'brasileirao': 'bra.1',
  'brasileirao serie a': 'bra.1',
  'liga profesional': 'arg.1',
  'liga profesional argentina': 'arg.1',
  'scottish premiership': 'sco.1',
  'champions league': 'uefa.champions',
  'uefa champions league': 'uefa.champions',
  'europa league': 'uefa.europa',
  'uefa europa league': 'uefa.europa',
  'conference league': 'uefa.europa.conf',
  'uefa europa conference league': 'uefa.europa.conf',
};

/** Token-level aliases used on both sides before comparing names. */
const TOKEN_ALIASES: Record<string, string> = {
  man: 'manchester',
  utd: 'united',
  intl: 'international',
  munchen: 'munich',
  monchengladbach: 'monchengladbach',
};

/** Full-name aliases (normalised) for nicknames ESPN spells out. */
const NAME_ALIASES: Record<string, string> = {
  psg: 'paris saint germain',
  'paris sg': 'paris saint germain',
  barca: 'barcelona',
  spurs: 'tottenham hotspur',
  wolves: 'wolverhampton wanderers',
  qpr: 'queens park rangers',
  bvb: 'borussia dortmund',
  juve: 'juventus',
  'inter milan': 'inter milan',
  inter: 'inter milan',
  gladbach: 'borussia monchengladbach',
  'atleti': 'atletico madrid',
  sevilla: 'sevilla',
  'sporting lisbon': 'sporting cp',
  'sporting': 'sporting cp',
  'porto': 'fc porto',
  'benfica': 'sl benfica',
};

/** Generic club/legal tokens that carry no identifying information. */
const STOPWORDS = new Set([
  'fc', 'cf', 'sc', 'ac', 'afc', 'as', 'ss', 'ssc', 'cd', 'ca', 'cp', 'ud', 'rc',
  'sd', 'sv', 'tsg', 'fsv', 'vfl', 'vfb', 'bk', 'sk', 'fk', 'if', 'club', 'the',
  'de', 'of', 'calcio', 'team',
]);

const normalise = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const expandTokens = (normalised: string): string[] =>
  normalised
    .split(' ')
    .map((token) => TOKEN_ALIASES[token] || token)
    .filter((token) => token && !STOPWORDS.has(token));

const aliasOf = (normalised: string): string => NAME_ALIASES[normalised] || normalised;

const tokenKey = (normalised: string): string =>
  expandTokens(aliasOf(normalised)).sort().join(' ');

type EspnTeamListEntry = {
  id: string;
  names: string[];
  normalisedNames: string[];
  tokenKeys: Set<string>;
};

type EspnTeamForm = {
  id: string;
  name: string;
  played: number;
  goalsScored: number;
  goalsConceded: number;
  last5: { results: string[]; goalsScored: number; goalsConceded: number };
  rank?: number;
};

const teamListCache = new Map<string, { at: number; teams: EspnTeamListEntry[] }>();
const teamFormCache = new Map<string, { at: number; form: EspnTeamForm }>();

async function espnGet<T = any>(path: string): Promise<T | null> {
  try {
    const response = await axios.get(`${ESPN_BASE}${path}`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { accept: 'application/json' },
    });
    return response.data as T;
  } catch {
    return null;
  }
}

export function resolveEspnLeagueSlug(leagueName: string | null | undefined): string | null {
  const normalised = normalise(String(leagueName || ''))
    .replace(/\b(19|20)\d{2}( \d{2})?\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalised) return null;
  if (LEAGUE_SLUGS[normalised]) return LEAGUE_SLUGS[normalised];
  const compact = normalised.replace(/\s+/g, '');
  for (const [key, slug] of Object.entries(LEAGUE_SLUGS)) {
    if (key.replace(/\s+/g, '') === compact) return slug;
  }
  for (const [key, slug] of Object.entries(LEAGUE_SLUGS)) {
    if (normalised.includes(key)) return slug;
  }
  return null;
}

async function getLeagueTeams(slug: string): Promise<EspnTeamListEntry[]> {
  const cached = teamListCache.get(slug);
  if (cached && Date.now() - cached.at < TEAM_LIST_TTL_MS) return cached.teams;

  const payload = await espnGet<any>(`/${slug}/teams`);
  const rawTeams = payload?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const teams: EspnTeamListEntry[] = [];
  for (const entry of rawTeams) {
    const team = entry?.team;
    if (!team?.id) continue;
    const names = [team.displayName, team.name, team.shortDisplayName, team.location, team.slug]
      .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(normalise);
    const uniqueNames = [...new Set(names)];
    teams.push({
      id: String(team.id),
      names: uniqueNames,
      normalisedNames: uniqueNames,
      tokenKeys: new Set(uniqueNames.map(tokenKey)),
    });
  }
  if (teams.length) teamListCache.set(slug, { at: Date.now(), teams });
  return teams;
}

/**
 * Name matcher: exact → alias → token-set → containment. Containment requires
 * a reasonably distinctive fragment so "United" or "City" alone never match.
 */
function findTeamByName(teams: EspnTeamListEntry[], rawName: string): EspnTeamListEntry | null {
  const normalised = normalise(rawName);
  if (!normalised) return null;
  const aliased = aliasOf(normalised);
  const tokens = tokenKey(normalised);

  const exact = teams.filter((team) => team.normalisedNames.includes(normalised));
  if (exact.length === 1) return exact[0];

  const aliasedExact = teams.filter(
    (team) => team.normalisedNames.includes(aliased) || team.normalisedNames.includes(aliasOf(normalised)),
  );
  if (aliasedExact.length === 1) return aliasedExact[0];

  const byTokens = teams.filter((team) => team.tokenKeys.has(tokens));
  if (byTokens.length === 1) return byTokens[0];

  const candidates: { team: EspnTeamListEntry; score: number }[] = [];
  for (const team of teams) {
    let best = 0;
    for (const candidateName of team.normalisedNames) {
      const candidateTokens = tokenKey(candidateName);
      if (candidateTokens === tokens) best = Math.max(best, 100);
      else if (candidateName === aliased) best = Math.max(best, 95);
      else {
        const shorter = Math.min(candidateName.length, aliased.length);
        const longer = Math.max(candidateName.length, aliased.length);
        if (
          shorter >= 6 &&
          longer - shorter <= 12 &&
          (candidateName.includes(aliased) || aliased.includes(candidateName))
        ) {
          best = Math.max(best, 80);
        }
      }
    }
    if (best > 0) candidates.push({ team, score: best });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) return null;
  return candidates[0].team;
}

function readScore(competitor: any): number | null {
  const raw = competitor?.score;
  const value = typeof raw === 'object' && raw !== null ? raw.value ?? raw.displayValue : raw;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function fetchTeamForm(slug: string, teamId: string, teamName: string): Promise<EspnTeamForm | null> {
  const cacheKey = `${slug}:${teamId}`;
  const cached = teamFormCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TEAM_FORM_TTL_MS) return cached.form;

  const [detail, schedule] = await Promise.all([
    espnGet<any>(`/${slug}/teams/${teamId}`),
    espnGet<any>(`/${slug}/teams/${teamId}/schedule`),
  ]);

  const recordStats: any[] = detail?.team?.record?.items?.[0]?.stats ?? [];
  const stat = (name: string): number | null => {
    const found = recordStats.find((entry) => entry?.name === name);
    const value = Number(found?.value);
    return Number.isFinite(value) ? value : null;
  };

  const events: any[] = Array.isArray(schedule?.events) ? schedule.events : [];
  const played: { date: number; scored: number; conceded: number; result: string }[] = [];
  for (const event of events) {
    const competition = event?.competitions?.[0];
    const competitors: any[] = Array.isArray(competition?.competitors) ? competition.competitors : [];
    const self = competitors.find((competitor) => String(competitor?.team?.id) === String(teamId));
    const opponent = competitors.find((competitor) => String(competitor?.team?.id) !== String(teamId));
    const completed =
      competition?.status?.type?.completed === true ||
      event?.status?.type?.completed === true ||
      competition?.status?.type?.name === 'STATUS_FULL_TIME';
    if (!self || !opponent || !completed) continue;
    const ownScore = readScore(self);
    const opponentScore = readScore(opponent);
    if (ownScore === null || opponentScore === null) continue;
    const date = new Date(event?.date || competition?.date || 0).getTime();
    played.push({
      date: Number.isFinite(date) ? date : 0,
      scored: ownScore,
      conceded: opponentScore,
      result: ownScore > opponentScore ? 'W' : ownScore < opponentScore ? 'L' : 'D',
    });
  }
  played.sort((a, b) => b.date - a.date);
  const recent = played.slice(0, 5);

  const gamesFromSchedule = played.length;
  const playedCount = stat('gamesPlayed') ?? gamesFromSchedule;
  const goalsFromSchedule = played.reduce((sum, game) => sum + game.scored, 0);
  const concededFromSchedule = played.reduce((sum, game) => sum + game.conceded, 0);
  const goalsScored = stat('pointsFor') ?? goalsFromSchedule;
  const goalsConceded = stat('pointsAgainst') ?? concededFromSchedule;

  if (playedCount < 1 && recent.length < 1) return null;

  const form: EspnTeamForm = {
    id: String(teamId),
    name: teamName,
    played: Math.max(0, playedCount),
    goalsScored: Math.max(0, goalsScored),
    goalsConceded: Math.max(0, goalsConceded),
    last5: {
      results: recent.map((game) => game.result),
      goalsScored: recent.reduce((sum, game) => sum + game.scored, 0),
      goalsConceded: recent.reduce((sum, game) => sum + game.conceded, 0),
    },
    rank: stat('rank') ?? undefined,
  };
  teamFormCache.set(cacheKey, { at: Date.now(), form });
  return form;
}

export async function getEspnTeamForm(
  teamName: string,
  leagueName: string | null | undefined,
): Promise<EspnTeamForm | null> {
  const slug = resolveEspnLeagueSlug(leagueName);
  if (!slug || !String(teamName || '').trim()) return null;
  const teams = await getLeagueTeams(slug);
  if (!teams.length) return null;
  const match = findTeamByName(teams, teamName);
  if (!match) return null;
  return fetchTeamForm(slug, match.id, match.normalisedNames[0] || teamName);
}

/**
 * Fills MatchData season/last5 from ESPN when BSD supplied no team statistics.
 * Returns true only when BOTH teams were enriched (symmetric inputs).
 */
export async function enrichMatchDataWithEspnTeamStats(
  matchData: MatchData,
  options: { leagueName?: string | null; homeName?: string | null; awayName?: string | null },
): Promise<boolean> {
  const homeName = options.homeName || matchData?.home?.name;
  const awayName = options.awayName || matchData?.away?.name;
  const leagueName = options.leagueName;
  if (!homeName || !awayName || !leagueName) return false;

  const hasRealData = (team: any) =>
    Number(team?.season?.played || 0) >= 3 && Array.isArray(team?.last5?.results) && team.last5.results.length >= 3;
  if (hasRealData(matchData.home) && hasRealData(matchData.away)) return false;

  const [homeForm, awayForm] = await Promise.all([
    getEspnTeamForm(homeName, leagueName).catch(() => null),
    getEspnTeamForm(awayName, leagueName).catch(() => null),
  ]);
  if (!homeForm || !awayForm) return false;

  matchData.home.season = {
    played: homeForm.played,
    goalsScored: homeForm.goalsScored,
    goalsConceded: homeForm.goalsConceded,
  };
  matchData.home.last5 = {
    results: homeForm.last5.results as any,
    goalsScored: homeForm.last5.goalsScored,
    goalsConceded: homeForm.last5.goalsConceded,
  };
  matchData.away.season = {
    played: awayForm.played,
    goalsScored: awayForm.goalsScored,
    goalsConceded: awayForm.goalsConceded,
  };
  matchData.away.last5 = {
    results: awayForm.last5.results as any,
    goalsScored: awayForm.last5.goalsScored,
    goalsConceded: awayForm.last5.goalsConceded,
  };
  matchData.deepContext = {
    ...(matchData.deepContext as any),
    teamStatsSource: 'espn',
    espnRanks: { home: homeForm.rank ?? null, away: awayForm.rank ?? null },
  } as any;
  return true;
}
