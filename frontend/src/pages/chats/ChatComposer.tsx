import { ActionIcon, Badge, Box, Button, FileButton, Group, Menu, Text, Textarea, Tooltip } from '@mantine/core';
import { IconArrowUp, IconCheck, IconChevronDown, IconChevronRight, IconPaperclip, IconPlayerStop, IconSearch, IconSparkles, IconX } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import type { ChatModelOption, ReasoningEffort } from '../../api/chat';
import { formatTps } from '../../lib/format';
import type { BusyTurnMode } from '../../lib/uiPreferences';
import { ContextRing } from './ContextRing';
import classes from './ChatComposer.module.css';

interface ModelGroup {
  provider: string | null; // null = models with no known provider ("other")
  models: ChatModelOption[];
}

const REASONING_EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const BUSY_MODE_LABELS: Record<BusyTurnMode, string> = {
  queue: 'Queue',
  interrupt: 'Interrupt',
  steer: 'Steer',
};

function groupModels(models: ChatModelOption[], providerOrder: string[]): ModelGroup[] {
  const byProvider = new Map<string, ChatModelOption[]>();
  const other: ChatModelOption[] = [];
  for (const option of models) {
    if (option.provider) {
      if (!byProvider.has(option.provider)) byProvider.set(option.provider, []);
      byProvider.get(option.provider)!.push(option);
    } else {
      other.push(option);
    }
  }
  const groups: ModelGroup[] = [];
  for (const provider of providerOrder) {
    const group = byProvider.get(provider);
    if (group?.length) {
      groups.push({ provider, models: group });
      byProvider.delete(provider);
    }
  }
  for (const [provider, group] of byProvider) groups.push({ provider, models: group });
  if (other.length) groups.push({ provider: null, models: other });
  return groups;
}

export function ChatComposer({
  running,
  onSend,
  onStop,
  onSteer,
  onQueue,
  onInterrupt,
  onCompact,
  onSkills,
  model,
  provider,
  models,
  providers,
  defaultModel,
  onModelChange,
  onProviderChange,
  reasoningEffort,
  onReasoningEffortChange,
  draft,
  onDraftChange,
  onAttach,
  liveTps,
  busyTurnMode,
  onBusyTurnModeChange,
  contextTokens,
  contextLength,
  contextEstimated,
}: {
  running: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
  onSteer: (text: string) => Promise<void>;
  onQueue: (text: string) => Promise<void>;
  onInterrupt: (text: string) => Promise<void>;
  onCompact: (focusTopic: string | null) => Promise<boolean>;
  onSkills: (query: string | null) => Promise<boolean>;
  model: string | null;
  provider: string | null;
  models: ChatModelOption[];
  providers: string[];
  defaultModel: string | null;
  onModelChange: (value: string | null) => void;
  onProviderChange: (value: string | null) => void;
  reasoningEffort: ReasoningEffort | null;
  onReasoningEffortChange: (value: ReasoningEffort | null) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onAttach: (file: File) => Promise<string>;
  liveTps: number | null;
  busyTurnMode: BusyTurnMode;
  onBusyTurnModeChange: (value: BusyTurnMode) => void;
  contextTokens: number;
  contextLength: number | null;
  contextEstimated: boolean;
}) {
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [menuOpened, setMenuOpened] = useState(false);
  const [filter, setFilter] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<string | null | undefined>(undefined);

  const groups = useMemo(() => groupModels(models, providers), [models, providers]);
  const trimmedFilter = filter.trim().toLowerCase();
  const isFiltering = trimmedFilter.length > 0;

  const visibleGroups = useMemo(() => {
    if (!isFiltering) return groups;
    return groups
      .map((group) => {
        const providerMatches = (group.provider ?? 'other').toLowerCase().includes(trimmedFilter);
        const matchingModels = providerMatches
          ? group.models
          : group.models.filter((option) => option.name.toLowerCase().includes(trimmedFilter));
        return { ...group, models: matchingModels };
      })
      .filter((group) => group.models.length > 0);
  }, [groups, isFiltering, trimmedFilter]);

  const matchCount = useMemo(() => visibleGroups.reduce((sum, group) => sum + group.models.length, 0), [visibleGroups]);

  const openMenu = () => {
    setExpandedGroup(provider ?? undefined);
    setFilter('');
    setMenuOpened(true);
  };
  const closeMenu = () => {
    setMenuOpened(false);
    setFilter('');
  };
  const toggleGroup = (key: string | null) => {
    setExpandedGroup((prev) => (prev === key ? undefined : key));
  };
  const selectModel = (name: string) => {
    const option = models.find((item) => item.name === name);
    if (!option) return;
    onModelChange(option.name);
    onProviderChange(option.provider);
    closeMenu();
  };
  const clearOverride = () => {
    onModelChange(null);
    onProviderChange(null);
    closeMenu();
  };

  const handleAttach = (file: File | null) => {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    void onAttach(file)
      .then((path) => setAttachments((items) => [...items, path]))
      .catch((error: unknown) => setUploadError(error instanceof Error ? error.message : 'Upload failed'))
      .finally(() => setUploading(false));
  };
  const submit = async () => {
    const skillsMatch = attachments.length === 0 && draft.trim().match(/^\/skills(?:\s+([\s\S]*))?$/i);
    if (!running && skillsMatch) {
      if (await onSkills(skillsMatch[1]?.trim() || null)) onDraftChange('');
      return;
    }
    const compactMatch = attachments.length === 0 && draft.trim().match(/^\/(?:compact|compress)(?:\s+([\s\S]*))?$/i);
    if (!running && compactMatch) {
      if (await onCompact(compactMatch[1]?.trim() || null)) onDraftChange('');
      return;
    }
    const references = attachments.map((path) => `[Attached workspace file: ${path}]`).join('\n');
    const value = [references, draft.trim()].filter(Boolean).join('\n\n');
    if (!value) return;
    if (!running) await onSend(value);
    else if (busyTurnMode === 'queue') await onQueue(value);
    else if (busyTurnMode === 'interrupt') await onInterrupt(value);
    else await onSteer(value);
    onDraftChange('');
    setAttachments([]);
  };

  return (
    <Box className={classes.wrapper}>
      <Box className={classes.card}>
        <Textarea
          variant="unstyled"
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          autosize
          minRows={2}
          maxRows={8}
          placeholder={running ? `${BUSY_MODE_LABELS[busyTurnMode]} while Hermes is responding…` : 'Message Hermes…'}
          classNames={{ input: classes.textarea }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {attachments.length > 0 && (
          <Group gap={6}>
            {attachments.map((path) => (
              <Badge key={path} variant="light" rightSection={<IconX size={11} onClick={() => setAttachments((items) => items.filter((item) => item !== path))} />}>
                {path}
              </Badge>
            ))}
          </Group>
        )}
        {uploadError && <Text c="red" fz="xs">{uploadError}</Text>}
        <Group gap={8} wrap="wrap" className={classes.controlRow}>
          <FileButton onChange={handleAttach}>
            {(props) => (
              <Tooltip label="Attach a workspace file">
                <ActionIcon {...props} variant="subtle" size={30} radius={6} aria-label="Attach file" loading={uploading} c={running ? 'var(--astra-border-strong)' : 'var(--astra-text-dim)'}>
                  <IconPaperclip size={17} />
                </ActionIcon>
              </Tooltip>
            )}
          </FileButton>

          <Box className={classes.pillGroup}>
          <Menu opened={menuOpened} onChange={(opened) => (opened ? openMenu() : closeMenu())} position="top-start" offset={8} radius="md" trapFocus>
            <Menu.Target>
              <button type="button" className={classes.groupTrigger} aria-label="Model" disabled={running}>
                <span className={classes.pillModel}>{model ?? '—'}</span>
                <IconChevronDown size={13} className={classes.pillChevron} />
              </button>
            </Menu.Target>
            <Menu.Dropdown className={classes.menuDropdown} w={300} p={0}>
              <Menu.Search
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
                placeholder={isFiltering ? `${matchCount} match${matchCount === 1 ? '' : 'es'}` : `Filter ${models.length} models`}
                variant="unstyled"
                classNames={{ wrapper: classes.filterHeader, input: classes.filterInput }}
                leftSection={<IconSearch size={15} color="var(--astra-text-disabled)" />}
                rightSection={
                  <Text ff="monospace" fz={10.5} c="var(--astra-border-strong)">
                    ↑↓
                  </Text>
                }
              />
              <Box className={classes.menuList}>
                {visibleGroups.map((group, index) => {
                  const groupKey = group.provider ?? 'other';
                  const isExpanded = isFiltering || expandedGroup === group.provider;
                  const isActive = group.provider !== null && group.provider === provider;
                  return (
                    <Box key={groupKey}>
                      <button type="button" className={classes.groupHeader} aria-expanded={isExpanded} onClick={() => toggleGroup(group.provider)}>
                        <span className={classes.groupChevron}>{isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}</span>
                        <span className={`astraLabel ${classes.groupLabel}`}>{groupKey}</span>
                        {isActive ? <span className={classes.activeDot} /> : <span className={classes.groupCount}>{group.models.length}</span>}
                      </button>
                      {isExpanded && (
                        <Menu.RadioGroup value={model} onChange={selectModel}>
                          {group.models.map((option) => {
                            const selected = option.name === model;
                            return (
                              <Menu.RadioItem
                                key={option.name}
                                value={option.name}
                                checked={selected}
                                className={selected ? `${classes.modelRow} ${classes.modelRowSelected}` : classes.modelRow}
                                classNames={{ itemIndicator: classes.hiddenIndicator, itemLabel: classes.modelRowLabel }}
                              >
                                <span className={selected ? `${classes.modelName} ${classes.modelNameSelected}` : classes.modelName}>{option.name}</span>
                                {selected && <IconCheck size={13} className={classes.checkIcon} />}
                              </Menu.RadioItem>
                            );
                          })}
                        </Menu.RadioGroup>
                      )}
                      {index < visibleGroups.length - 1 && <Menu.Divider className={classes.groupDivider} />}
                    </Box>
                  );
                })}
                {visibleGroups.length === 0 && <Text className={classes.emptyState}>No models match “{filter.trim()}”</Text>}
              </Box>
              <button type="button" className={classes.menuFooter} onClick={clearOverride}>
                <span className={classes.footerLabel}>Session default</span>
                <span className={classes.footerModel}>{defaultModel ?? '—'}</span>
              </button>
            </Menu.Dropdown>
          </Menu>

          <Menu position="top-start" offset={8} radius="md">
            <Menu.Target>
              <button type="button" className={`${classes.groupTrigger} ${classes.effortTrigger}`} aria-label="Reasoning effort" disabled={running}>
                <span className={classes.pillModel}>
                  {reasoningEffort ? `${reasoningEffort[0]!.toUpperCase()}${reasoningEffort.slice(1)} effort` : 'Default effort'}
                </span>
                <IconChevronDown size={13} className={classes.pillChevron} />
              </button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Reasoning effort</Menu.Label>
              <Menu.RadioGroup
                value={reasoningEffort ?? 'default'}
                onChange={(value) => onReasoningEffortChange(value === 'default' ? null : value as ReasoningEffort)}
              >
                <Menu.RadioItem value="default">Default</Menu.RadioItem>
                <Menu.Divider />
                {REASONING_EFFORTS.map((effort) => (
                  <Menu.RadioItem key={effort} value={effort} tt="capitalize">{effort}</Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Dropdown>
          </Menu>
          </Box>

          {running && (
            <>
              <Menu position="top-start" offset={8} radius="md">
                <Menu.Target>
                  <button type="button" className={`${classes.pill} ${classes.effortPill}`} aria-label="Busy turn mode">
                    <span className={classes.pillModel}>{BUSY_MODE_LABELS[busyTurnMode]}</span>
                    <IconChevronDown size={13} className={classes.pillChevron} />
                  </button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Send while responding</Menu.Label>
                  <Menu.RadioGroup value={busyTurnMode} onChange={(value) => onBusyTurnModeChange(value as BusyTurnMode)}>
                    <Menu.RadioItem value="queue">Queue — send next</Menu.RadioItem>
                    <Menu.RadioItem value="interrupt">Interrupt — stop and send</Menu.RadioItem>
                    <Menu.RadioItem value="steer">Steer — guide this turn</Menu.RadioItem>
                  </Menu.RadioGroup>
                </Menu.Dropdown>
              </Menu>
              <Group gap={6} wrap="nowrap">
                <span className={classes.runningDot} />
                <Text component="span" ff="monospace" fz={11} c="var(--astra-accent)">
                  {formatTps(liveTps)}
                </Text>
              </Group>
            </>
          )}

          <Box style={{ flex: 1 }} />
          {!running && (
            <Tooltip label="Compact earlier context (/compact)">
              <ActionIcon
                variant="subtle"
                size={30}
                radius={6}
                aria-label="Compact context"
                onClick={() => void onCompact(null)}
              >
                <IconSparkles size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          {running && (
            <Button size="xs" h={30} color="red" variant="light" leftSection={<IconPlayerStop size={14} />} onClick={() => void onStop()}>
              Stop
            </Button>
          )}
          <ContextRing tokens={contextTokens} contextLength={contextLength} estimated={contextEstimated} />
          <Tooltip label={running ? `${BUSY_MODE_LABELS[busyTurnMode]} message` : 'Send message'}>
            <ActionIcon
              size={32}
              radius="xl"
              variant="filled"
              onClick={() => void submit()}
              aria-label={running ? `${BUSY_MODE_LABELS[busyTurnMode]} message` : 'Send message'}
            >
              <IconArrowUp size={18} stroke={2.2} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>
    </Box>
  );
}
