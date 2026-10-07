import { useEffect, useState } from 'react';
import type { LandmarkSession } from './session';
export function LandmarkPhoto({ id, session, eager = false, compact = false }: { id: string; session: LandmarkSession; eager?: boolean; compact?: boolean }) {
  const media = session.image(id);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id, media?.url]);
  if (!media || failed) return null;
  return <div className="landmark-photo"><img src={media.url} alt="랜드마크 사진" loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer"
    onLoad={() => session.imageRendered(id, true)} onError={() => { setFailed(true); session.imageRendered(id, false); }} />
    {!compact && <a href={media.source} target="_blank" rel="noreferrer">사진 출처·이용 조건{media.author ? ` · ${media.author}` : ''}{media.license ? ` · ${media.license}` : ''}</a>}
  </div>;
}
