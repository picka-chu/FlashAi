export const localDateKey = (value?: Date | string | number | null) => {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const dateFromKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const formatMatch = (m: any) => {
  if (!m) return null;
  const elapsed = Number(m?.fixture?.status?.elapsed || 0);
  const statusShort = String(m?.fixture?.status?.short || '');
  const statusState = m?.fixture?.status?.state;
  // Non-clock states show their label (HT, FT, ET, PENS…); running states show
  // a proper match clock in whole minutes — BSD minute precision has no seconds.
  const HOLDING_SHORTS = new Set(['HT', 'FT', 'AET', 'PENS', 'ET', 'CANC', 'PP', 'TBD', 'ABAN', 'SUSP', 'PST']);
  let displayMinute = statusShort || '--';
  if (statusState === 'in' && !HOLDING_SHORTS.has(statusShort) && elapsed > 0) {
    // BSD stores elapsed as minutes × 60 (i.e. seconds); tolerate feeds that
    // already send seconds or whole minutes, and never render absurd values.
    let minutes = elapsed >= 60 ? Math.round(elapsed / 60) : Math.round(elapsed);
    if (minutes > 135) minutes = Math.round(minutes / 60);
    displayMinute = `${Math.max(1, minutes)}'`;
  }

  const rawFixtureDate = m?.fixture?.date ?? m?.fixtureDate ?? m?.dateISO ?? null;
  const parsedFixtureDate = rawFixtureDate ? new Date(rawFixtureDate) : new Date();
  const matchDate = Number.isNaN(parsedFixtureDate.getTime()) ? new Date() : parsedFixtureDate;

  const leagueName =
    typeof m.league === 'string'
      ? m.league
      : m.league?.name || m.league?.displayName || m.competition?.name || 'Football';

  return {
    ...m,
    id: m?.fixture?.id ?? m?.fixture_id ?? m?.id,
    home: m?.teams?.home?.name || m?.home || 'Home',
    away: m?.teams?.away?.name || m?.away || 'Away',
    homeShort: (m?.teams?.home?.name || m?.home || 'HOM').substring(0, 3).toUpperCase(),
    awayShort: (m?.teams?.away?.name || m?.away || 'AWY').substring(0, 3).toUpperCase(),
    homeLogo: m?.teams?.home?.logo || m?.homeLogo || '',
    awayLogo: m?.teams?.away?.logo || m?.awayLogo || '',
    score: m.goals?.home !== null && m.goals?.away !== null && m.goals?.home !== undefined && m.goals?.away !== undefined
      ? `${m.goals.home}-${m.goals.away}` 
      : (typeof m.score === 'string' ? m.score : null),
    minute: displayMinute,
    league: leagueName,
    fixtureDate: matchDate.toISOString(),
    dateKey: localDateKey(matchDate),
    time: matchDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    date: (() => {
      const today = new Date();
      const tomorrow = new Date();
      tomorrow.setDate(today.getDate() + 1);

      const matchDateStr = matchDate.toDateString();
      if (matchDateStr === today.toDateString()) return 'Today';
      if (matchDateStr === tomorrow.toDateString()) return 'Tomorrow';

      return matchDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    })(),
    status: m?.fixture?.status?.state === 'pre' ? 'Upcoming' : (m?.status || 'Live'),
  };
};
