import { Badge, Box, Collapse, Loader, Text, Tooltip, UnstyledButton, VisuallyHidden } from '@mantine/core';
import {
  IconAlertTriangle,
  IconBookmark,
  IconBulb,
  IconChevronRight,
  IconEdit,
  IconFile,
  IconPlugConnected,
  IconRobot,
  IconSearch,
  IconTerminal2,
  IconTool,
  IconWorld,
} from '@tabler/icons-react';
import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { ChildSession } from '../../../api/types';
import { useNow } from '../../../hooks/useNow';
import { useRememberedDisclosure } from '../../../lib/disclosureMemory';
import {
  firstLine,
  formatToolDuration,
  shortTarget,
  toolArgumentPreview,
  toolCategory,
  toolTitle,
} from '../../../lib/toolDisplay';
import { effectiveStatus, type ActivityBlock, type ActivityItem, type NoticeItem, type ThoughtItem, type ToolItem, type ToolStatus } from '../../../lib/turnBlocks';
import { ToolResultView } from './ToolResultView';
import classes from './Transcript.module.css';

const ICON = { size: 15, stroke: 1.8 };

function ToolIcon({ name }: { name: string | null }) {
  switch (toolCategory(name)) {
    case 'command': return <IconTerminal2 {...ICON} />;
    case 'read': return <IconFile {...ICON} />;
    case 'edit': return <IconEdit {...ICON} />;
    case 'search': return <IconSearch {...ICON} />;
    case 'web':
    case 'browser': return <IconWorld {...ICON} />;
    case 'delegate': return <IconRobot {...ICON} />;
    case 'mcp': return <IconPlugConnected {...ICON} />;
    case 'memory': return <IconBookmark {...ICON} />;
    default: return <IconTool {...ICON} />;
  }
}

/** Colour carries status on screen; screen readers get it as words. */
const STATUS_LABEL: Record<ToolStatus, string> = {
  running: 'Running',
  done: 'Done',
  error: 'Failed',
  pending: 'No result',
};

// Rows already shown once. Virtualization remounts rows as they scroll back into view, and only a
// row appearing for the first time while the turn runs should animate in.
const seenRows = new Set<string>();
// When each running call was first seen, so its elapsed time survives a remount.
const runningSince = new Map<string, number>();

/** True only for a row that first appears while the turn is live; saved history never animates. */
function useEntering(key: string, live: boolean): boolean {
  const [entering] = useState(() => live && !seenRows.has(key));
  seenRows.add(key);
  return entering;
}

function LiveElapsed({ itemKey }: { itemKey: string }) {
  const now = useNow(100);
  const [since] = useState(() => {
    const known = runningSince.get(itemKey);
    if (known !== undefined) return known;
    const started = Date.now();
    runningSince.set(itemKey, started);
    return started;
  });
  return <span className={classes.toolDuration}>{(Math.max(0, now - since) / 1000).toFixed(1)}s</span>;
}

export const ToolRow = memo(function ToolRow({
  item,
  status,
  childSessions,
  live = false,
}: {
  item: ToolItem;
  status: ToolStatus;
  childSessions: ChildSession[];
  /** The row belongs to a turn that is still running. */
  live?: boolean;
}) {
  // Failed calls start collapsed like every other step; the red pill already flags them.
  const [open, toggle] = useRememberedDisclosure(`tool:${item.key}`, false);
  const entering = useEntering(`tool:${item.key}`, live);
  const running = status === 'running';
  const target = shortTarget(item);
  const full = item.preview || toolArgumentPreview(item.arguments);
  const duration = formatToolDuration(item.duration);
  const runningChildren = item.subagents.filter((agent) => agent.status === 'running').length;
  if (!running) runningSince.delete(item.key);
  return (
    <Box className={classes.toolRow} data-opened={open || undefined} data-status={status} data-entering={entering || undefined}>
      <UnstyledButton
        className={classes.toolHeader}
        aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); toggle(); }}
      >
        <span className={classes.toolIcon}><ToolIcon name={item.name} /></span>
        <Text component="span" className={`${classes.toolTitle} ${running ? classes.shimmer : ''}`} title={item.name ?? undefined}>
          {toolTitle(item.name, running)}
        </Text>
        {target && <Text component="span" className={classes.toolTarget} title={full}>{target}</Text>}
        <span className={classes.toolMeta}>
          {item.risk && (
            <Tooltip label="Hermes flagged this tool output as potentially risky" withArrow>
              <IconAlertTriangle size={14} className={classes.warn} aria-label="Flagged as risky" />
            </Tooltip>
          )}
          {item.subagents.length > 0 && (
            <Badge size="xs" variant="light" color={runningChildren ? 'teal' : 'gray'} radius="sm">
              {runningChildren ? `${runningChildren} running` : `${item.subagents.length} subagent${item.subagents.length === 1 ? '' : 's'}`}
            </Badge>
          )}
          {running
            ? <LiveElapsed itemKey={item.key} />
            : duration && <span className={classes.toolDuration}>{duration}</span>}
          {running
            ? <Loader size={12} type="oval" color="var(--astra-primary)" aria-label={STATUS_LABEL.running} />
            : <VisuallyHidden>{STATUS_LABEL[status]}</VisuallyHidden>}
          <IconChevronRight size={13} className={classes.chevron} data-opened={open || undefined} />
        </span>
      </UnstyledButton>
      <Collapse expanded={open}>
        <Box className={classes.toolBody}>{open && <ToolResultView item={item} childSessions={childSessions} />}</Box>
      </Collapse>
    </Box>
  );
});

export function ThoughtRow({ item, live = false }: { item: ThoughtItem; live?: boolean }) {
  const [open, toggle] = useRememberedDisclosure(`thought:${item.key}`, false);
  const entering = useEntering(`thought:${item.key}`, live);
  return (
    <Box className={classes.toolRow} data-opened={open || undefined} data-kind="thought" data-entering={entering || undefined}>
      <UnstyledButton
        className={classes.toolHeader}
        aria-expanded={open}
        aria-label="Thought"
        onClick={(event) => { event.stopPropagation(); toggle(); }}
      >
        <span className={classes.toolIcon}><IconBulb {...ICON} /></span>
        <Text component="span" className={classes.toolTitle}>Thought</Text>
        {!open && <Text component="span" className={classes.thoughtPreview}>{firstLine(item.text)}</Text>}
        <span className={classes.toolMeta}>
          <IconChevronRight size={13} className={classes.chevron} data-opened={open || undefined} />
        </span>
      </UnstyledButton>
      <Collapse expanded={open}>
        {open && <Text size="sm" className={classes.thoughtBody}>{item.text}</Text>}
      </Collapse>
    </Box>
  );
}

/** A notice such as "Memory updated": a sand card whose body is clamped to a few lines. */
function NoticeCard({ item, live }: { item: NoticeItem; live: boolean }) {
  const entering = useEntering(`notice:${item.key}`, live);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && !expanded) setOverflows(el.scrollHeight - el.clientHeight > 1);
  }, [item.detail, expanded]);
  return (
    <div className={classes.noticeCard} data-entering={entering || undefined}>
      <div className={classes.noticeLabel}>{item.label}</div>
      {item.detail && (
        <>
          <div ref={bodyRef} className={classes.noticeBody} data-clamped={expanded ? undefined : true}>
            {item.detail}
          </div>
          {(overflows || expanded) && (
            <UnstyledButton
              className={classes.noticeMore}
              onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }}
            >
              {expanded ? 'Show less' : 'Show more'}
            </UnstyledButton>
          )}
        </>
      )}
    </div>
  );
}

function ItemRow({ item, pendingIsRunning, childSessions }: {
  item: ActivityItem;
  pendingIsRunning: boolean;
  childSessions: ChildSession[];
}) {
  if (item.kind === 'thought') return <ThoughtRow item={item} live={pendingIsRunning} />;
  if (item.kind === 'notice') return <NoticeCard item={item} live={pendingIsRunning} />;
  return (
    <ToolRow
      item={item}
      status={effectiveStatus(item, pendingIsRunning)}
      childSessions={childSessions}
      live={pendingIsRunning}
    />
  );
}

/**
 * A run of consecutive thoughts, tool calls and notices. Each is its own tinted pill, coloured by
 * its status, so progress reads at a glance; any pill opens to show its detail.
 */
export const ActivityGroup = memo(function ActivityGroup({
  block,
  pendingIsRunning,
  childSessions,
}: {
  block: ActivityBlock;
  /** Calls without a result are still executing (the newest turn while a turn runs). */
  pendingIsRunning: boolean;
  childSessions: ChildSession[];
}) {
  return (
    <div className={classes.activityStack}>
      {block.items.map((item) => (
        <ItemRow key={item.key} item={item} pendingIsRunning={pendingIsRunning} childSessions={childSessions} />
      ))}
    </div>
  );
});
