export const formatMatch = (m: any) => {
  if (!m) return null;
  const elapsed = Number(m?.fixture?.status?.elapsed || 0);
  let displayMinute = m?.fixture?.status?.short || '--';
  if (elapsed > 0) {
    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60);
    displayMinute = `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  // Ensure league is always a string for the UI
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
    time: new Date(m?.fixture?.date || m?.date || Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    date: (() => {
      const matchDate = new Date(m?.fixture?.date || m?.date || Date.now());
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
