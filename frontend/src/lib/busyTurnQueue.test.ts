import { beforeEach, describe, expect, it } from 'vitest';
import { clearBusyTurnQueue, enqueueBusyTurnMessage, loadBusyTurnQueue, removeBusyTurnMessage } from './busyTurnQueue';

describe('busy turn queue', () => {
  beforeEach(() => localStorage.clear());

  it('persists messages per session and removes only the completed message', () => {
    const first = enqueueBusyTurnMessage('session-a', 'first', { now: 10 })[0]!;
    enqueueBusyTurnMessage('session-a', 'second', { now: 20 });
    enqueueBusyTurnMessage('session-b', 'other session', { now: 30 });

    expect(loadBusyTurnQueue('session-a').map((item) => item.text)).toEqual(['first', 'second']);
    expect(removeBusyTurnMessage('session-a', first.id).map((item) => item.text)).toEqual(['second']);
    expect(loadBusyTurnQueue('session-b').map((item) => item.text)).toEqual(['other session']);

    clearBusyTurnQueue('session-a');
    expect(loadBusyTurnQueue('session-a')).toEqual([]);
  });

  it('puts an interrupt replacement ahead of ordinary follow-ups', () => {
    enqueueBusyTurnMessage('session-a', 'later');
    enqueueBusyTurnMessage('session-a', 'use this now', { front: true });

    expect(loadBusyTurnQueue('session-a').map((item) => item.text)).toEqual(['use this now', 'later']);
  });

  it('ignores malformed browser storage', () => {
    localStorage.setItem('astra.chat.busy-turn-queues.v1', '{bad json');
    expect(loadBusyTurnQueue('session-a')).toEqual([]);
  });
});
