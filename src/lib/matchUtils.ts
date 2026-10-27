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
  let displayMinute = m?.fixture?.status?.short || '--';
  if (elapsed > 0) {
    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60);
    displayMinute = `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  const rawFixtureDate = m?.fixture?.date ?? m?.fixtureDate ?? m?.dateISO ?? null;
  // Date-only values are calendar dates, not UTC instants. Parsing YYYY-MM-DD
  // with new Date() can move the fixture to the previous day in some timezones.
  let parsedFixtureDate: Date;
  if (typeof rawFixtureDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawFixtureDate)) {
    const [year, month, day] = rawFixtureDate.split('-').map(Number);
    parsedFixtureDate = new Date(year, month - 1, day);
  } else {
    parsedFixtureDate = rawFixtureDate ? new Date(rawFixtureDate) : new Date(Number.NaN);
  }
  // Never silently turn a malformed fixture date into "today".
  if (Number.isNaN(parsedFixtureDate.getTime())) return null;
  const matchDate = parsedFixtureDate;

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
