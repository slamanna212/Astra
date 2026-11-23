import { Menu, UnstyledButton } from '@mantine/core';
import { IconCheck, IconFilter } from '@tabler/icons-react';
import { useQueries } from '@tanstack/react-query';
import { useRef } from 'react';
import { queryKeys } from '../../api/queryKeys';
import { countSessions } from '../../api/sessions';
import type { SessionStatus } from '../../api/types';
import { formatCount } from '../../lib/format';
import { KNOWN_SOURCES, SOURCE_PRESETS, type SourcePreset, sourceColor } from '../../lib/sources';
import classes from './SessionList.module.css';

/** Chats / Automated / All. No segment is checked when the selection is a custom mix. */
export function PresetControl({
  preset,
  onSelect,
}: {
  preset: SourcePreset | null;
  onSelect: (sources: readonly string[]) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = SOURCE_PRESETS.findIndex((p) => p.value === preset);

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + SOURCE_PRESETS.length) % SOURCE_PRESETS.length;
    onSelect(SOURCE_PRESETS[next]!.sources);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Conversation types" className={classes.presets}>
      {SOURCE_PRESETS.map((p, index) => {
        const checked = p.value === preset;
        return (
          <UnstyledButton
            key={p.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            role="radio"
            aria-checked={checked}
            data-active={checked || undefined}
            // Roving tabindex: the checked segment, or the first one when no preset matches.
            tabIndex={index === (activeIndex < 0 ? 0 : activeIndex) ? 0 : -1}
            className={classes.preset}
            onClick={() => onSelect(p.sources)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {p.label}
          </UnstyledButton>
        );
      })}
    </div>
  );
}

/** Funnel button + per-type checkbox menu. Controlled so the "N hidden by type" link can open it too. */
export function TypeFilterMenu({
  sources,
  onChange,
  custom,
  status,
  opened,
  onOpenedChange,
}: {
  sources: string[];
  onChange: (next: readonly string[]) => void;
  custom: boolean;
  status: SessionStatus;
  opened: boolean;
  onOpenedChange: (opened: boolean) => void;
}) {
  // Per-type counts are only worth the requests while someone is looking at them.
  const counts = useQueries({
    queries: KNOWN_SOURCES.map((source) => ({
      queryKey: queryKeys.sessions.countBy(status, [source]),
      queryFn: ({ signal }: { signal: AbortSignal }) => countSessions(status, [source], signal),
      enabled: opened,
    })),
  });

  const toggle = (source: string) => {
    onChange(sources.includes(source) ? sources.filter((s) => s !== source) : [...sources, source]);
  };

  return (
    <Menu
      opened={opened}
      onChange={onOpenedChange}
      closeOnItemClick={false}
      position="bottom-end"
      width={248}
      classNames={{ dropdown: classes.typeMenu, label: classes.typeMenuLabel, item: classes.typeMenuItem, itemLabel: classes.typeMenuItemLabel, itemIndicator: classes.typeMenuIndicator }}
    >
      <Menu.Target>
        <UnstyledButton
          className={classes.iconButton}
          data-custom={custom || undefined}
          aria-label="Custom type filter"
          title="Custom type filter"
          aria-pressed={custom}
        >
          <IconFilter size={15} stroke={1.8} aria-hidden />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Custom</Menu.Label>
        {KNOWN_SOURCES.map((source, i) => {
          const checked = sources.includes(source);
          const count = counts[i]?.data;
          return (
            <Menu.CheckboxItem key={source} checked={checked} onChange={() => toggle(source)}>
              <span className={classes.typeCheck} aria-hidden>
                {checked && <IconCheck size={11} stroke={3.2} />}
              </span>
              <span className={classes.typeDot} style={{ background: `var(--mantine-color-${sourceColor(source)}-6)` }} aria-hidden />
              <span className={classes.typeName}>{source}</span>
              <span className={classes.typeCount}>{count === undefined ? '' : formatCount(count)}</span>
            </Menu.CheckboxItem>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );
}
