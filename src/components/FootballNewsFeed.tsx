import React from 'react';
import { Clock, ExternalLink, Newspaper } from 'lucide-react';
import type { FootballNewsArticle } from '../services/footballService';

interface FootballNewsFeedProps {
  articles: FootballNewsArticle[];
  loading?: boolean;
  onOpen: (url: string) => void;
}

function formatRelativeTime(date: string) {
  const then = new Date(date).getTime();
  if (!Number.isFinite(then)) return '';

  const diff = Math.max(0, Date.now() - then);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

const NewsSkeleton: React.FC = () => (
  <div className="shrink-0 w-[280px] rounded-[22px] border border-white/[0.06] bg-[#141414] overflow-hidden animate-pulse">
    <div className="h-[150px] bg-zinc-800/60" />
    <div className="p-3.5 space-y-2">
      <div className="h-3 w-20 bg-zinc-800 rounded" />
      <div className="h-4 w-full bg-zinc-800 rounded" />
      <div className="h-4 w-3/4 bg-zinc-800 rounded" />
    </div>
  </div>
);

export const FootballNewsFeed: React.FC<FootballNewsFeedProps> = ({ articles, loading, onOpen }) => {
  if (!loading && articles.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x pb-2">
      {loading
        ? [1, 2, 3].map((i) => <NewsSkeleton key={i} />)
        : articles.map((article) => (
            <button
              key={article.id}
              type="button"
              onClick={() => onOpen(article.url)}
              className="shrink-0 w-[280px] snap-center rounded-[22px] overflow-hidden border border-white/10 bg-[#141414] text-left active:scale-[0.98] transition-transform cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <div className="relative h-[150px] bg-zinc-900 overflow-hidden">
                {article.image ? (
                  <img
                    src={article.image}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                    <Newspaper className="w-8 h-8 text-zinc-600" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

                <div className="absolute top-3 left-3 flex items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-wider text-black bg-[#ccff00] px-2 py-1 rounded-full">
                    {article.league}
                  </span>
                </div>

                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[9px] font-bold text-zinc-300">
                    <Clock className="w-3 h-3" />
                    {formatRelativeTime(article.published)}
                  </div>
                  <div className="flex items-center gap-1 text-[9px] font-black text-white/80 uppercase tracking-wider">
                    {article.source}
                    <ExternalLink className="w-3 h-3" />
                  </div>
                </div>
              </div>

              <div className="p-3.5">
                <h4 className="text-[13px] font-black text-white leading-snug line-clamp-2">
                  {article.headline}
                </h4>
                {article.description ? (
                  <p className="mt-1.5 text-[10px] text-zinc-500 leading-relaxed line-clamp-2">
                    {article.description}
                  </p>
                ) : null}
              </div>
            </button>
          ))}
    </div>
  );
};
