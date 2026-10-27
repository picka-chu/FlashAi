/**
 * League priority for ordering fixtures and choosing the featured match.
 * Weights mirror backend/services/footballService.ts (LEAGUE_PRIORITY). Keep
 * the two lists in sync when a competition is added.
 */

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

/** Leagues at or above this weight count as major. Unknown competitions sit below it. */
export const MAJOR_LEAGUE_MIN_WEIGHT = 74;

export const getLeagueWeight = (leagueName?: string | null): number => {
  const name = String(leagueName || '').trim();
  if (!name) return 0;
  const match = LEAGUE_PRIORITY.find(({ patterns }) => patterns.some((p) => p.test(name)));
  return match?.weight ?? 10;
};

export const isMajorLeague = (match: { league?: string | null }) =>
  getLeagueWeight(match?.league) >= MAJOR_LEAGUE_MIN_WEIGHT;

/** Higher-weight leagues first; within a league, earlier kick-off first. */
export const compareByPriority = (a: any, b: any): number => {
  const weight = getLeagueWeight(b?.league) - getLeagueWeight(a?.league);
  if (weight !== 0) return weight;
  const ta = new Date(a?.fixtureDate || 0).getTime();
  const tb = new Date(b?.fixtureDate || 0).getTime();
  return ta - tb;
};
