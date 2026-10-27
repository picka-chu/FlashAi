const ESPN_TEAM_SEARCH = 'https://site.api.espn.com/apis/common/v3/search';

export interface TeamLogoInfo {
  logo: string | null;
  color: string | null;
}

const TEAM_ALIASES: Record<string, string[]> = {
  inter: ['Internazionale'],
  'inter milan': ['Internazionale'],
  'inter milano': ['Internazionale'],
  'internazionale milano': ['Internazionale'],
  'bayern munich': ['Bayern München'],
  psg: ['Paris Saint-Germain'],
  'man city': ['Manchester City'],
  'man utd': ['Manchester United'],
  'man united': ['Manchester United'],
  spurs: ['Tottenham Hotspur'],
  juve: ['Juventus'],
  barca: ['Barcelona'],
  dortmund: ['Borussia Dortmund'],
};

const cache = new Map<string, TeamLogoInfo>();
const pending = new Map<string, Promise<TeamLogoInfo>>();

const normalize = (value: string) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const canonical = (value: string) => {
  const words = normalize(value).split(' ').filter(Boolean);
  const noise = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'club', 'the', 'de', 'cd', 'ud', 'sv', 'fk', 'bk']);
  const cleaned = words.filter((word) => !noise.has(word));
  return (cleaned.length ? cleaned : words).join(' ');
};

export const teamInitials = (name: string) => {
  const words = canonical(name).split(' ').filter(Boolean);
  if (!words.length) return 'FC';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
};

export const teamFallbackColor = (name: string) => {
  const palette = ['#38bdf8', '#a78bfa', '#fb7185', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#2dd4bf'];
  let hash = 0;
  for (const char of String(name || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
};

const editDistance = (left: string, right: string) => {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[left.length][right.length];
};

const tokensSimilar = (left: string, right: string) => {
  if (left === right) return true;
  return editDistance(left, right) <= Math.max(1, Math.ceil(Math.max(left.length, right.length) * 0.45));
};

const pickLogo = (name: string, items: any[]): TeamLogoInfo => {
  const wanted = canonical(name);
  const variants = [
    wanted,
    ...(TEAM_ALIASES[normalize(name)] || []).map(canonical),
  ].filter(Boolean);
  const teams = (items || []).filter(
    (item) => item?.type === 'team' && item?.sport === 'soccer' && Array.isArray(item?.logos) && item.logos.length,
  );

  const exact = teams.find((item) => {
    const display = canonical(item.displayName || item.name || '');
    const short = canonical(item.shortName || item.abbreviation || '');
    return variants.includes(display) || variants.includes(short);
  });

  const variantTokens = variants.map((variant) => variant.split(' ').filter(Boolean));
  const fuzzy = exact || teams.find((item) => {
    const displayTokens = canonical(item.displayName || item.name || '').split(' ').filter(Boolean);
    return variantTokens.some((tokens) =>
      displayTokens.length === tokens.length &&
      displayTokens.every((token, index) => tokensSimilar(token, tokens[index])),
    );
  });

  const partial = fuzzy || (wanted.length >= 6 ? teams.find((item) => {
    const display = canonical(item.displayName || item.name || '');
    const shorter = Math.min(display.length, wanted.length);
    return shorter >= 6 && (display.includes(wanted) || wanted.includes(display));
  }) : undefined);

  if (!partial) return { logo: null, color: null };

  const logo = partial.logos.find((entry: any) => entry?.rel?.includes?.('dark'))?.href ||
    partial.logos.find((entry: any) => entry?.rel?.includes?.('default'))?.href ||
    partial.logos[0]?.href || null;
  const rawColor = String(partial.color || '').replace(/^#/, '');
  const color = /^[0-9a-f]{6}$/i.test(rawColor) ? `#${rawColor}` : null;
  return { logo, color };
};

export async function resolveTeamLogo(name: string): Promise<TeamLogoInfo> {
  const key = canonical(name);
  if (!key) return { logo: null, color: null };
  if (cache.has(key)) return cache.get(key)!;
  if (pending.has(key)) return pending.get(key)!;

  const request = (async () => {
    try {
      const url = `${ESPN_TEAM_SEARCH}?query=${encodeURIComponent(name)}&limit=8&type=team`;
      const response = await fetch(url);
      if (!response.ok) return { logo: null, color: null };
      const data = await response.json();
      const result = pickLogo(name, data?.items || []);
      cache.set(key, result);
      return result;
    } catch {
      return { logo: null, color: null };
    } finally {
      pending.delete(key);
    }
  })();

  pending.set(key, request);
  return request;
}
