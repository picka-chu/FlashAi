import React, { useEffect, useRef, useState } from 'react';
import { resolveTeamLogo, teamFallbackColor, teamInitials } from '../lib/teamLogo';

interface TeamLogoProps {
  name: string;
  logo?: string | null;
  className?: string;
  textClassName?: string;
}

export const TeamLogo: React.FC<TeamLogoProps> = ({
  name,
  logo,
  className = '',
  textClassName = 'text-sm',
}) => {
  const holderRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(logo || null);
  const [color, setColor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSrc(logo || null);
    setFailed(false);
    setReady(false);
    setColor(null);
  }, [logo, name]);

  useEffect(() => {
    if (logo || src) return;
    let cancelled = false;
    let observer: IntersectionObserver | null = null;

    const load = () => {
      resolveTeamLogo(name).then((result) => {
        if (cancelled) return;
        if (result.logo) setSrc(result.logo);
        if (result.color) setColor(result.color);
      });
    };

    const element = holderRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      load();
    } else {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          load();
        }
      }, { rootMargin: '240px' });
      observer.observe(element);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [logo, name, src]);

  const showImage = Boolean(src) && !failed;
  const fallbackColor = color || teamFallbackColor(name);

  return (
    <div ref={holderRef} className={`relative w-full h-full flex items-center justify-center overflow-hidden ${className}`}>
      <div
        className="absolute inset-0"
        style={{ background: `linear-gradient(145deg, ${fallbackColor}4d 0%, rgba(24,24,27,0.96) 78%)` }}
      />
      <div
        className="absolute inset-0 opacity-30"
        style={{ background: 'radial-gradient(circle at 72% 18%, rgba(255,255,255,0.7) 0%, transparent 42%)' }}
      />
      <span className={`relative z-10 font-black tracking-[-0.06em] text-white/90 ${textClassName}`}>
        {teamInitials(name)}
      </span>
      {showImage && (
        <img
          src={src || ''}
          alt={name}
          className={`absolute inset-0 z-20 w-full h-full object-contain transition-opacity duration-200 ${ready ? 'opacity-100' : 'opacity-0'}`}
          referrerPolicy="no-referrer"
          loading="eager"
          onLoad={() => setReady(true)}
          onError={() => {
            setFailed(true);
            setReady(false);
          }}
        />
      )}
    </div>
  );
};
