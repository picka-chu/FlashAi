const MATCH_TIMEZONE = 'Africa/Addis_Ababa';

export const localDateKey = (value?: Date | string | number | null) => {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MATCH_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const dateFromKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const formatMatch = (m: any) => {
  if (!m) return null;
  const elapsed = Number(m?.fixture?.status?.elapsed || 0);
  const statusShort = String(m?.fixture?.status?.short || '').toUpperCase();
  let displayMinute = m?.fixture?.status?.short || m?.minute || '--';
  if (elapsed > 0 && !['FT', 'AET', 'PEN', 'HT', 'BT', 'P', 'SUSP', 'INT'].includes(statusShort)) {
    const extra = Number(m?.fixture?.status?.extra || 0);
    displayMinute = extra > 0 ? `${elapsed}+${extra}'` : `${elapsed}'`;
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
    // Prefer the provider's original calendar key when available. This avoids
    // re-deriving a fixture day from a normalized ISO timestamp.
    dateKey: typeof m?.fixture?.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.fixture.dateKey)
      ? m.fixture.dateKey
      : localDateKey(matchDate),
    time: matchDate.toLocaleTimeString('en-GB', { timeZone: MATCH_TIMEZONE, hour: '2-digit', minute: '2-digit' }),
    date: (() => {
      const todayKey = localDateKey(new Date());
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowKey = localDateKey(tomorrow);
      const fixtureKey = localDateKey(matchDate);
      if (fixtureKey === todayKey) return 'Today';
      if (fixtureKey === tomorrowKey) return 'Tomorrow';
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: MATCH_TIMEZONE,
        day: '2-digit',
        month: 'short',
      }).format(matchDate);
    })(),
    status: m?.fixture?.status?.state === 'pre' ? 'Upcoming' : (m?.fixture?.status?.long || m?.status || 'Live'),
  };
};
