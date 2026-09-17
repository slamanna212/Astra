import { isLiveActivityEvent, MAX_LIVE_ACTIVITY_EVENTS, type LiveActivityEvent } from './liveActivity';

export const CHAT_RECOVERY_MAX_AGE_MS = 10 * 60 * 1000;
export const CHAT_RECONNECT_DELAYS_MS = [1_500, 3_000, 5_000, 8_000, 12_000, 20_000] as const;

const STORAGE_KEY = 'astra.chat.inflight.v1';
const MAX_SESSIONS = 8;

export interface ChatRecovery {
  updatedAt: number;
  lastEventId: number;
  streaming: string;
  reasoning: string;
  activity: string[];
  events: LiveActivityEvent[];
}

type RecoveryMap = Record<string, ChatRecovery>;

function readMap(): RecoveryMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, ChatRecovery] => {
        const value = entry[1];
        return value !== null && typeof value === 'object' && typeof (value as ChatRecovery).updatedAt === 'number';
      }),
    );
  } catch {
    return {};
  }
}

function writeMap(value: RecoveryMap) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (Object.keys(value).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Recovery is opportunistic; storage may be disabled or full.
  }
}

export function loadChatRecovery(sessionId: string, now = Date.now()): ChatRecovery | null {
  const all = readMap();
  const value = all[sessionId];
  if (
    !value ||
    typeof value.updatedAt !== 'number' ||
    now - value.updatedAt > CHAT_RECOVERY_MAX_AGE_MS ||
    now < value.updatedAt - 60_000
  ) {
    if (value) {
      delete all[sessionId];
      writeMap(all);
    }
    return null;
  }
  return {
    updatedAt: value.updatedAt,
    lastEventId: Number.isSafeInteger(value.lastEventId) && value.lastEventId >= 0 ? value.lastEventId : 0,
    streaming: typeof value.streaming === 'string' ? value.streaming : '',
    reasoning: typeof value.reasoning === 'string' ? value.reasoning : '',
    activity: Array.isArray(value.activity) ? value.activity.filter((item): item is string => typeof item === 'string').slice(-5) : [],
    events: Array.isArray(value.events) ? value.events.filter(isLiveActivityEvent).slice(-MAX_LIVE_ACTIVITY_EVENTS) : [],
  };
}

export function saveChatRecovery(sessionId: string, value: Omit<ChatRecovery, 'updatedAt'>, now = Date.now()) {
  if (!sessionId) return;
  const all = readMap();
  all[sessionId] = {
    updatedAt: now,
    lastEventId: Number.isSafeInteger(value.lastEventId) ? Math.max(0, value.lastEventId) : 0,
    streaming: value.streaming,
    reasoning: value.reasoning,
    activity: value.activity.slice(-5),
    events: value.events.slice(-MAX_LIVE_ACTIVITY_EVENTS),
  };
  const trimmed = Object.fromEntries(
    Object.entries(all)
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SESSIONS),
  );
  writeMap(trimmed);
}

export function clearChatRecovery(sessionId: string) {
  const all = readMap();
  if (!(sessionId in all)) return;
  delete all[sessionId];
  writeMap(all);
}
