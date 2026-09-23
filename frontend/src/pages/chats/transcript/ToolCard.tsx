import { Box, Code, Collapse, Loader, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconFile,
  IconInfoCircle,
  IconPlugConnected,
  IconRobot,
  IconSearch,
  IconTerminal2,
  IconTool,
  IconWorld,
  IconX,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { formatToolDuration, toolDisplayName } from '../../../lib/toolDisplay';
import classes from './Transcript.module.css';

export type ToolStatus = 'running' | 'pending' | 'done' | 'error';

function ToolIcon({ name, kind }: { name: string | null; kind?: string }) {
  const n = (name ?? '').toLowerCase();
  const props = { size: 14, stroke: 1.8, className: classes.toolIcon };
  if (kind === 'subagent') return <IconRobot {...props} />;
  if (kind === 'status') return <IconInfoCircle {...props} />;
  if (n.startsWith('mcp__')) return <IconPlugConnected {...props} />;
  if (/terminal|shell|bash|exec|command|process/.test(n)) return <IconTerminal2 {...props} />;
  if (/search|grep|find/.test(n)) return <IconSearch {...props} />;
  if (/web|browser|fetch|url|http/.test(n)) return <IconWorld {...props} />;
  if (/file|read|write|patch|edit/.test(n)) return <IconFile {...props} />;
  if (/delegate|agent/.test(n)) return <IconRobot {...props} />;
  return <IconTool {...props} />;
}

function StatusIcon({ status }: { status: ToolStatus }) {
  if (status === 'running') return <Loader size={12} type="oval" aria-label="Running" />;
  if (status === 'pending') return <IconClock size={14} color="var(--astra-text-dim)" aria-label="No result" />;
  if (status === 'error') return <IconX size={14} color="var(--astra-danger)" aria-label="Failed" />;
  return <IconCheck size={14} color="var(--astra-ok)" aria-label="Done" />;
}

/** Compact, content-width tool card. Collapsed it is one line (icon · name · preview · status);
 *  expanded it widens to the column so arguments and results have room. */
export function ToolCard({
  name,
  kind,
  preview,
  status,
  duration,
  warning,
  children,
}: {
  name: string | null;
  /** Non-tool live activity (subagent/status) picks its icon from the kind instead of the name. */
  kind?: string;
  preview: string;
  status?: ToolStatus;
  duration?: number | null;
  warning?: string | null;
  children: ReactNode;
}) {
  const [opened, { toggle }] = useDisclosure(false);
  const time = formatToolDuration(duration);
  return (
    <Box className={classes.toolCard} data-opened={opened || undefined} data-status={status}>
      <UnstyledButton
        onClick={(event) => { event.stopPropagation(); toggle(); }}
        className={classes.toolCardHeader}
        aria-expanded={opened}
      >
        <IconChevronRight size={12} className={classes.toolChevron} data-opened={opened || undefined} />
        <ToolIcon name={name} kind={kind} />
        <Text component="span" className={classes.toolName} title={name ?? undefined}>
          {toolDisplayName(name)}
        </Text>
        {preview && (
          <Text component="span" className={classes.toolArgs} title={preview}>
            {preview}
          </Text>
        )}
        <span className={classes.toolMeta}>
          {warning && (
            <Tooltip label={warning} withArrow>
              <IconAlertTriangle size={14} color="var(--astra-warn)" aria-label={warning} />
            </Tooltip>
          )}
          {time && <span className={classes.toolDuration}>{time}</span>}
          {status && <StatusIcon status={status} />}
        </span>
      </UnstyledButton>
      <Collapse expanded={opened}>
        <Box className={classes.toolCardBody}>{opened && children}</Box>
      </Collapse>
    </Box>
  );
}

export function ToolSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <Text size="xs" c="dimmed" fw={600} mt={8} mb={4}>{label}</Text>
      {typeof children === 'string' ? <Code block className={classes.toolCode}>{children}</Code> : children}
    </>
  );
}
