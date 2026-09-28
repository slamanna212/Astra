import { Badge, Box, Collapse, Loader, Text, Timeline, Tooltip, UnstyledButton } from '@mantine/core';
import {
  IconAlertTriangle,
  IconBulb,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconEdit,
  IconFile,
  IconInfoCircle,
  IconListDetails,
  IconPlugConnected,
  IconRobot,
  IconSearch,
  IconTerminal2,
  IconTool,
  IconWorld,
  IconX,
} from '@tabler/icons-react';
import { memo } from 'react';
import type { ChildSession } from '../../../api/types';
import { useRememberedDisclosure } from '../../../lib/disclosureMemory';
import {
  formatToolDuration,
  summarizeToolNames,
  toolArgumentPreview,
  toolCategory,
  toolTitle,
} from '../../../lib/toolDisplay';
import { effectiveStatus, resultHasErrorDetail, type ActivityBlock, type ActivityItem, type NoticeItem, type ThoughtItem, type ToolItem, type ToolStatus } from '../../../lib/turnBlocks';
import { ToolResultView } from './ToolResultView';
import classes from './Transcript.module.css';

const ICON = { size: 14, stroke: 1.8 };

function ToolIcon({ name }: { name: string | null }) {
  const n = (name ?? '').toLowerCase();
  if (n.startsWith('mcp__')) return <IconPlugConnected {...ICON} />;
  switch (toolCategory(name)) {
    case 'command': return <IconTerminal2 {...ICON} />;
    case 'read': return <IconFile {...ICON} />;
    case 'edit': return <IconEdit {...ICON} />;
    case 'search': return <IconSearch {...ICON} />;
    case 'web':
    case 'browser': return <IconWorld {...ICON} />;
    case 'delegate': return <IconRobot {...ICON} />;
    default: return <IconTool {...ICON} />;
  }
}

function StatusMark({ status }: { status: ToolStatus }) {
  if (status === 'running') return <Loader size={12} type="oval" aria-label="Running" />;
  if (status === 'pending') return <IconClock size={14} className={classes.dim} aria-label="No result" />;
  if (status === 'error') return <IconX size={14} className={classes.danger} aria-label="Failed" />;
  return <IconCheck size={14} className={classes.ok} aria-label="Done" />;
}

/** File paths read best from the end: keep the last few segments. */
function shortTarget(item: ToolItem): string {
  const target = item.preview || toolArgumentPreview(item.arguments);
  const category = toolCategory(item.name);
  if ((category === 'read' || category === 'edit') && /^[~./]?[^\s]*\/[^\s]+$/.test(target)) {
    const parts = target.split('/');
    if (parts.length > 3) return `…/${parts.slice(-3).join('/')}`;
  }
  return target;
}

export const ToolRow = memo(function ToolRow({
  item,
  status,
  childSessions,
  withIcon = true,
}: {
  item: ToolItem;
  status: ToolStatus;
  childSessions: ChildSession[];
  /** A standalone row shows the tool's icon; inside a timeline the bullet already does. */
  withIcon?: boolean;
}) {
  const [open, toggle] = useRememberedDisclosure(
    `tool:${item.key}`,
    status === 'error' && (item.result === null || resultHasErrorDetail(item.result)),
  );
  const target = shortTarget(item);
  const full = item.preview || toolArgumentPreview(item.arguments);
  const duration = formatToolDuration(item.duration);
  const runningChildren = item.subagents.filter((agent) => agent.status === 'running').length;
  return (
    <Box className={classes.toolRow} data-opened={open || undefined} data-status={status}>
      <UnstyledButton
        className={classes.toolHeader}
        aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); toggle(); }}
      >
        {withIcon && <span className={classes.toolIcon}><ToolIcon name={item.name} /></span>}
        <Text component="span" className={classes.toolTitle} title={item.name ?? undefined}>
          {toolTitle(item.name, status === 'running')}
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
          {duration && <span className={classes.toolDuration}>{duration}</span>}
          <StatusMark status={status} />
          <IconChevronRight size={13} className={classes.chevron} data-opened={open || undefined} />
        </span>
      </UnstyledButton>
      <Collapse expanded={open}>
        <Box className={classes.toolBody}>{open && <ToolResultView item={item} childSessions={childSessions} />}</Box>
      </Collapse>
    </Box>
  );
});

function firstLine(text: string): string {
  return text.trim().split('\n').find((line) => line.trim())?.trim() ?? '';
}

export function ThoughtRow({ item, withIcon = true }: { item: ThoughtItem; withIcon?: boolean }) {
  const [open, toggle] = useRememberedDisclosure(`thought:${item.key}`, false);
  return (
    <Box className={classes.toolRow} data-opened={open || undefined}>
      <UnstyledButton
        className={classes.toolHeader}
        aria-expanded={open}
        aria-label="Thought"
        onClick={(event) => { event.stopPropagation(); toggle(); }}
      >
        {withIcon && <span className={classes.toolIcon}><IconBulb {...ICON} /></span>}
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

function NoticeRow({ item }: { item: NoticeItem }) {
  return (
    <div className={classes.noticeRow}>
      <Text component="span" size="xs" c="dimmed">{item.label}</Text>
      {item.detail && <Text component="pre" size="xs" c="dimmed" className={classes.noticeDetail}>{item.detail}</Text>}
    </div>
  );
}

function ItemRow({ item, pendingIsRunning, childSessions, withIcon }: {
  item: ActivityItem;
  pendingIsRunning: boolean;
  childSessions: ChildSession[];
  withIcon: boolean;
}) {
  if (item.kind === 'thought') return <ThoughtRow item={item} withIcon={withIcon} />;
  if (item.kind === 'notice') return <NoticeRow item={item} />;
  return <ToolRow item={item} status={effectiveStatus(item, pendingIsRunning)} childSessions={childSessions} withIcon={withIcon} />;
}

function Bullet({ item, pendingIsRunning }: { item: ActivityItem; pendingIsRunning: boolean }) {
  if (item.kind === 'thought') return <IconBulb size={12} />;
  if (item.kind === 'notice') return <IconInfoCircle size={12} />;
  const status = effectiveStatus(item, pendingIsRunning);
  if (status === 'running') return <Loader size={10} type="oval" />;
  if (status === 'error') return <IconX size={12} className={classes.danger} />;
  return <ToolIcon name={item.name} />;
}

/**
 * A run of consecutive thoughts and tool calls. Collapsed it is one line: a summary of what was
 * done, or while running, the step in progress. Expanded it is a timeline of the steps.
 */
export const ActivityGroup = memo(function ActivityGroup({
  block,
  pendingIsRunning,
  childSessions,
  defaultOpen,
}: {
  block: ActivityBlock;
  /** Calls without a result are still executing (the newest turn while a turn runs). */
  pendingIsRunning: boolean;
  childSessions: ChildSession[];
  defaultOpen: boolean;
}) {
  const { items } = block;
  const tools = items.filter((item): item is ToolItem => item.kind === 'tool');
  const statuses = tools.map((item) => effectiveStatus(item, pendingIsRunning));
  const errors = statuses.filter((status) => status === 'error').length;
  const [open, toggle] = useRememberedDisclosure(`group:${block.key}`, defaultOpen || errors > 0);

  if (items.length === 1) {
    return (
      <div className={classes.activitySingle}>
        <ItemRow item={items[0]!} pendingIsRunning={pendingIsRunning} childSessions={childSessions} withIcon />
      </div>
    );
  }

  const runningIndex = statuses.lastIndexOf('running');
  const current = runningIndex >= 0 ? tools[runningIndex]! : null;
  const summary = current
    ? toolTitle(current.name, true)
    : tools.length > 0 ? summarizeToolNames(tools.map((item) => item.name)) : 'Thought';
  const detail = current ? shortTarget(current) : null;
  const total = tools.reduce((sum, item) => sum + (item.duration ?? 0), 0);
  const duration = total > 0 ? formatToolDuration(total) : null;
  return (
    <Box className={classes.activityGroup} data-opened={open || undefined} data-running={current ? true : undefined}>
      <UnstyledButton
        className={classes.groupHeader}
        aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); toggle(); }}
      >
        <span className={classes.toolIcon}>
          {current ? <Loader size={12} type="oval" aria-label="Running" /> : <IconListDetails {...ICON} />}
        </span>
        <Text component="span" className={classes.toolTitle}>{summary}</Text>
        {detail && <Text component="span" className={classes.toolTarget}>{detail}</Text>}
        <span className={classes.toolMeta}>
          {errors > 0 && (
            <Badge size="xs" variant="light" color="red" radius="sm">{errors} failed</Badge>
          )}
          <Text component="span" className={classes.toolDuration}>
            {items.length} steps{duration ? ` · ${duration}` : ''}
          </Text>
          <IconChevronRight size={13} className={classes.chevron} data-opened={open || undefined} />
        </span>
      </UnstyledButton>
      <Collapse expanded={open}>
        {open && (
          <Timeline bulletSize={20} lineWidth={1} active={-1} className={classes.timeline}>
            {items.map((item) => (
              <Timeline.Item
                key={item.key}
                bullet={<Bullet item={item} pendingIsRunning={pendingIsRunning} />}
                classNames={{ item: classes.timelineItem, itemBullet: classes.timelineBullet, itemBody: classes.timelineBody }}
              >
                <ItemRow item={item} pendingIsRunning={pendingIsRunning} childSessions={childSessions} withIcon={false} />
              </Timeline.Item>
            ))}
          </Timeline>
        )}
      </Collapse>
    </Box>
  );
});
