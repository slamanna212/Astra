import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import { IconPlugConnected, IconRefresh, IconX } from '@tabler/icons-react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TERMINAL_CLOSE, terminalSocketUrl } from '../../api/terminal';
import classes from './TerminalPanel.module.css';

type Status = 'connecting' | 'connected' | 'exited' | 'disconnected';

const STATUS_LABEL: Record<Status, string> = {
  connecting: 'connecting…',
  connected: 'connected',
  exited: 'exited',
  disconnected: 'disconnected',
};

// Terminals stay dark in both color schemes: ANSI palettes assume a dark ground.
const THEME = {
  background: '#0E1013',
  foreground: '#E7EAEE',
  cursor: '#2BB6C4',
  cursorAccent: '#0E1013',
  selectionBackground: 'rgba(43,182,196,.35)',
};

function closeMessage(code: number): string {
  if (code === TERMINAL_CLOSE.disabled) return 'The terminal is disabled on the server.';
  if (code === TERMINAL_CLOSE.unavailable) return 'The shell could not be started (is the workspace mounted?).';
  if (code === TERMINAL_CLOSE.policy) return 'Session expired or not allowed — sign in again.';
  return 'Connection lost.';
}

/**
 * The shared workspace shell (backend/src/astra/terminal.py). The shell lives on the server and
 * outlives this panel: hiding it or leaving the page only detaches, and re-opening replays recent
 * output. "Restart" is the only thing that kills it.
 */
export default function TerminalPanel({ onClose }: { onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [detail, setDetail] = useState<string | null>(null);

  const send = useCallback((message: object) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const connect = useCallback(
    (restart = false) => {
      const term = termRef.current;
      if (!term) return;
      const previous = socketRef.current;
      socketRef.current = null;
      previous?.close();
      term.reset();
      setStatus('connecting');
      setDetail(null);

      const socket = new WebSocket(terminalSocketUrl({ rows: term.rows, cols: term.cols, restart }));
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;
      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        setStatus('connected');
        term.focus();
      };
      socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
        if (socketRef.current !== socket) return;
        if (typeof event.data !== 'string') {
          term.write(new Uint8Array(event.data));
          return;
        }
        try {
          const msg = JSON.parse(event.data) as { type?: string; code?: number | null };
          if (msg.type === 'exit') {
            setStatus('exited');
            setDetail(msg.code === null || msg.code === undefined ? null : `exit code ${msg.code}`);
            term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
          }
        } catch {
          // ignore malformed control frames
        }
      };
      socket.onclose = (event) => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        setStatus((current) => (current === 'exited' ? current : 'disconnected'));
        setDetail((current) => current ?? (event.code === 1000 ? null : closeMessage(event.code)));
      };
    },
    [],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      theme: THEME,
      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    try {
      fit.fit();
    } catch {
      // not laid out yet; the ResizeObserver below fits once it is
    }

    const input = term.onData((data) => send({ type: 'input', data }));
    const resize = term.onResize(({ rows, cols }) => send({ type: 'resize', rows, cols }));

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          // host hidden (e.g. mobile layout); nothing to fit
        }
      });
    });
    observer.observe(host);

    connect();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      input.dispose();
      resize.dispose();
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
      term.dispose();
      termRef.current = null;
    };
  }, [connect, send]);

  const live = status === 'connected' || status === 'connecting';

  return (
    <div className={classes.root}>
      <Group className={classes.header} gap="xs" wrap="nowrap">
        <Text size="xs" fw={600}>
          Terminal
        </Text>
        <Text className={classes.meta} data-status={status} truncate="end" style={{ flex: 1, minWidth: 0 }} title={detail ?? undefined}>
          {STATUS_LABEL[status]}
          {detail ? ` · ${detail}` : ''}
        </Text>
        {!live && (
          <Tooltip label="Reconnect (starts a shell if none is running)">
            <ActionIcon variant="subtle" size="sm" aria-label="Reconnect terminal" onClick={() => connect()}>
              <IconPlugConnected size={16} stroke={1.5} />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip label="Restart shell">
          <ActionIcon variant="subtle" size="sm" aria-label="Restart shell" onClick={() => connect(true)}>
            <IconRefresh size={16} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Hide terminal (the shell keeps running)">
          <ActionIcon variant="subtle" size="sm" aria-label="Hide terminal" onClick={onClose}>
            <IconX size={16} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <div ref={hostRef} className={classes.host} data-testid="terminal-host" />
    </div>
  );
}
