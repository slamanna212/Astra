const STORAGE_KEY = 'astra.chat.busy-turn-queues.v1';
const MAX_SESSIONS = 50;
const MAX_MESSAGES_PER_SESSION = 20;

export interface QueuedTurnMessage {
  id: string;
  text: string;
  createdAt: number;
}

type QueueMap = Record<string, QueuedTurnMessage[]>;

function readQueues(): QueueMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([sessionId, value]) => {
      if (!Array.isArray(value)) return [];
      const messages = value.filter((item): item is QueuedTurnMessage => item !== null
        && typeof item === 'object'
        && typeof (item as QueuedTurnMessage).id === 'string'
        && typeof (item as QueuedTurnMessage).text === 'string'
        && typeof (item as QueuedTurnMessage).createdAt === 'number');
      return messages.length > 0 ? [[sessionId, messages]] : [];
    }));
  } catch {
    return {};
  }
}

function writeQueues(queues: QueueMap) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (Object.keys(queues).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(queues));
  } catch {
    // Pending messages are best-effort when browser storage is unavailable or full.
  }
}

export function loadBusyTurnQueue(sessionId: string): QueuedTurnMessage[] {
  return sessionId ? (readQueues()[sessionId] ?? []) : [];
}

export function enqueueBusyTurnMessage(
  sessionId: string,
  text: string,
  { now = Date.now(), front = false }: { now?: number; front?: boolean } = {},
): QueuedTurnMessage[] {
  if (!sessionId || !text.trim()) return loadBusyTurnQueue(sessionId);
  const queues = readQueues();
  const message = {
    id: `${now}-${Math.random().toString(36).slice(2)}`,
    text: text.trim(),
    createdAt: now,
  };
  const existing = queues[sessionId] ?? [];
  queues[sessionId] = front
    ? [message, ...existing].slice(0, MAX_MESSAGES_PER_SESSION)
    : [...existing, message].slice(-MAX_MESSAGES_PER_SESSION);
  const limited = Object.fromEntries(
    Object.entries(queues)
      .sort(([, left], [, right]) => Math.max(...right.map((item) => item.createdAt)) - Math.max(...left.map((item) => item.createdAt)))
      .slice(0, MAX_SESSIONS),
  );
  writeQueues(limited);
  return limited[sessionId] ?? [];
}

export function removeBusyTurnMessage(sessionId: string, messageId: string): QueuedTurnMessage[] {
  const queues = readQueues();
  const next = (queues[sessionId] ?? []).filter((item) => item.id !== messageId);
  if (next.length > 0) queues[sessionId] = next;
  else delete queues[sessionId];
  writeQueues(queues);
  return next;
}

export function clearBusyTurnQueue(sessionId: string) {
  const queues = readQueues();
  delete queues[sessionId];
  writeQueues(queues);
}
