import { useState } from 'react';
import { avatarSrc, initialsOf, type ProfileSummary } from '../api/profiles';
import classes from './BotAvatar.module.css';

/** Stable per-bot accent so a bot without a photo still reads as the same bot everywhere. */
export function hueFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return hash;
}

interface BotAvatarProps {
  profile: Pick<ProfileSummary, 'name' | 'title' | 'avatar_url' | 'updated_at'>;
  size?: number;
  /** Dot in the corner: a turn is running. */
  busy?: boolean;
  className?: string;
}

export function BotAvatar({ profile, size = 40, busy = false, className }: BotAvatarProps) {
  const [failed, setFailed] = useState(false);
  const src = avatarSrc(profile);
  const hue = hueFor(profile.name);
  const style = {
    width: size,
    height: size,
    fontSize: Math.max(11, Math.round(size * 0.38)),
    '--bot-hue': String(hue),
  } as React.CSSProperties;

  return (
    <span
      className={`${classes.avatar} ${className ?? ''}`}
      style={style}
      data-bot={profile.name}
      aria-hidden="true"
    >
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className={classes.initials}>{initialsOf(profile)}</span>
      )}
      {busy && <span className={classes.busy} />}
    </span>
  );
}
