import { ActionIcon, Badge, Box, FileButton, Group, Loader, Menu, Text, Textarea, Tooltip, UnstyledButton } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useElementSize, useMediaQuery } from '@mantine/hooks';
import { IconArrowUp, IconBrain, IconCheck, IconChevronDown, IconChevronRight, IconCpu, IconFileUpload, IconPaperclip, IconPlayerStopFilled, IconSearch, IconSparkles, IconX } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import type { ChatModelOption, ReasoningEffort } from '../../api/chat';
import type { BusyTurnMode } from '../../lib/uiPreferences';
import { BotPicker } from '../../components/BotPicker';
import { ContextRing } from './ContextRing';
import { EffortPickerModal, ModelPickerModal, type ModelGroup } from './ComposerPickers';
import classes from './ChatComposer.module.css';

/** The effort menu opens from the right end of the pill, so it grows from that corner. */
const EFFORT_MENU_TRANSITION = {
  in: { opacity: 1, transform: 'none' },
  out: { opacity: 0, transform: 'translateY(4px) scale(.98)' },
  transitionProperty: 'opacity, transform',
  common: { transformOrigin: 'bottom right' },
};

const REASONING_EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const BUSY_MODE_LABELS: Record<BusyTurnMode, string> = {
  queue: 'Queue',
  interrupt: 'Interrupt',
  steer: 'Steer',
};

let nextUploadId = 0;

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
  busyTurnMode,
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
  busyTurnMode: BusyTurnMode;
  contextTokens: number;
  contextLength: number | null;
  contextEstimated: boolean;
}) {
  const [attachments, setAttachments] = useState<string[]>([]);
  // Names of files still uploading, shown as grey chips until each lands.
  const [uploadsInFlight, setUploadsInFlight] = useState<{ id: number; name: string }[]>([]);
  const uploading = uploadsInFlight.length > 0;
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [menuOpened, setMenuOpened] = useState(false);
  const [filter, setFilter] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<string | null | undefined>(undefined);
  // On a phone the model and effort pills become icons that open full pickers, so the whole
  // control row fits on one line.
  // The same compact controls take over when the card itself gets narrow (a wide session list on a
  // laptop), so the control row never overflows.
  const { ref: cardRef, width: cardWidth } = useElementSize<HTMLDivElement>();
  const phone = useMediaQuery('(max-width: 48em)', undefined, { getInitialValueInEffect: false }) ?? false;
  const compact = phone || (cardWidth > 0 && cardWidth < 520);
  const [sheet, setSheet] = useState<'model' | 'effort' | null>(null);
  // On a touchscreen keyboard Enter adds a new line and the button sends; with a real keyboard
  // Enter sends and Shift+Enter adds a new line.
  const touch = useMediaQuery('(hover: none) and (pointer: coarse)', undefined, { getInitialValueInEffect: false }) ?? false;

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
  // One model id can sit under several providers, so a row is identified by both.
  const selectModel = (name: string, groupProvider: string | null) => {
    const option = models.find((item) => item.name === name && (item.provider ?? null) === groupProvider);
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

  // Files from the paperclip and from drag-and-drop both land here; each uploads to the workspace
  // and is referenced by its path when the message is sent.
  const handleAttach = (files: File[]) => {
    if (files.length === 0) return;
    setUploadError(null);
    for (const file of files) {
      const upload = { id: nextUploadId++, name: file.name };
      setUploadsInFlight((items) => [...items, upload]);
      void onAttach(file)
        .then((path) => setAttachments((items) => (items.includes(path) ? items : [...items, path])))
        .catch((error: unknown) => setUploadError(error instanceof Error ? error.message : 'Upload failed'))
        .finally(() => setUploadsInFlight((items) => items.filter((item) => item.id !== upload.id)));
    }
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
    if (!running) {
      try { await onSend(value); } catch { return; } // Parent renders the send error; leave draft and attachments intact.
    }
    else if (busyTurnMode === 'queue') await onQueue(value);
    else if (busyTurnMode === 'interrupt') await onInterrupt(value);
    else await onSteer(value);
    onDraftChange('');
    setAttachments([]);
  };

  // While running, the action button is Stop until something is typed, then it sends via the busy-turn mode from settings.
  const showStop = running && !draft.trim() && attachments.length === 0;
  const actionLabel = showStop ? 'Stop' : running ? `${BUSY_MODE_LABELS[busyTurnMode]} message` : 'Send message';
  const hasContent = !!draft.trim() || attachments.length > 0;
  const sendState = showStop ? 'stop' : running ? 'steer' : hasContent ? 'ready' : 'empty';

  // Compact pops back in when a turn ends, not on every render.
  const [prevRunning, setPrevRunning] = useState(running);
  const [compactEntering, setCompactEntering] = useState(false);
  if (prevRunning !== running) {
    setPrevRunning(running);
    setCompactEntering(prevRunning && !running);
  }

  return (
    <Box className={classes.wrapper} ref={cardRef}>
      <Dropzone
        onDrop={handleAttach}
        multiple
        activateOnClick={false}
        activateOnKeyboard={false}
        enablePointerEvents
        unstyled
        classNames={{ root: classes.card, inner: classes.cardInner }}
        data-astra-composer
        data-running={running || undefined}
      >
        <Dropzone.Accept>
          <Box className={classes.dropOverlay}>
            <IconFileUpload size={20} stroke={1.6} />
            <Text fz="sm" fw={500}>Drop to attach</Text>
          </Box>
        </Dropzone.Accept>
        <Textarea
          variant="unstyled"
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          autosize
          minRows={compact ? 1 : 2}
          maxRows={8}
          placeholder={running ? `${BUSY_MODE_LABELS[busyTurnMode]} while Hermes is responding…` : 'Message Hermes…'}
          classNames={{ input: classes.textarea }}
          enterKeyHint={touch ? 'enter' : 'send'}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !touch && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {(attachments.length > 0 || uploading) && (
          <Group gap={6}>
            {attachments.map((path) => (
              <Badge key={path} variant="light" className={classes.attachmentChip} rightSection={<IconX size={11} onClick={() => setAttachments((items) => items.filter((item) => item !== path))} />}>
                {path}
              </Badge>
            ))}
            {uploadsInFlight.map((upload) => (
              <span key={upload.id} className={`${classes.attachmentChip} ${classes.uploadChip}`}>
                <Loader size={9} type="oval" color="var(--astra-primary)" />
                Uploading {upload.name}
              </span>
            ))}
          </Group>
        )}
        {uploadError && <Text c="red" fz="xs">{uploadError}</Text>}
        <Group gap={compact ? 4 : 8} wrap="nowrap" className={classes.controlRow}>
          <FileButton multiple onChange={handleAttach}>
            {(props) => (
              <Tooltip label="Attach a workspace file">
                <ActionIcon {...props} variant="subtle" size={30} radius={6} aria-label="Attach file" loading={uploading} className={classes.attachButton} c={running ? 'var(--astra-border-strong)' : 'var(--astra-text-dim)'}>
                  <IconPaperclip size={17} />
                </ActionIcon>
              </Tooltip>
            )}
          </FileButton>

          {/* Which bot answers this message — the choice belongs next to the input. */}
          <BotPicker compact={compact} />

          {compact ? (
            <>
              <Tooltip label={model ? `Model: ${model}` : 'Model'}>
                <ActionIcon variant="subtle" size={30} radius={6} aria-label="Model" disabled={running} onClick={() => setSheet('model')} c="var(--astra-text-dim)">
                  <IconCpu size={17} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={reasoningEffort ? `Effort: ${reasoningEffort}` : 'Default effort'}>
                <ActionIcon
                  variant="subtle"
                  size={30}
                  radius={6}
                  aria-label="Reasoning effort"
                  disabled={running}
                  onClick={() => setSheet('effort')}
                  c={reasoningEffort ? 'var(--astra-primary)' : 'var(--astra-text-dim)'}
                >
                  <IconBrain size={17} />
                </ActionIcon>
              </Tooltip>
              <ModelPickerModal
                opened={sheet === 'model'}
                onClose={() => setSheet(null)}
                groups={groups}
                model={model}
                provider={provider}
                defaultModel={defaultModel}
                onSelect={(option) => {
                  onModelChange(option?.name ?? null);
                  onProviderChange(option?.provider ?? null);
                }}
              />
              <EffortPickerModal
                opened={sheet === 'effort'}
                onClose={() => setSheet(null)}
                efforts={REASONING_EFFORTS}
                value={reasoningEffort}
                onChange={onReasoningEffortChange}
              />
            </>
          ) : (
          <Box className={classes.pillGroup}>
          <Menu opened={menuOpened} onChange={(opened) => (opened ? openMenu() : closeMenu())} position="top-start" offset={8} radius="md" trapFocus>
            <Menu.Target>
              <button type="button" className={`${classes.groupTrigger} ${classes.modelTrigger}`} aria-label="Model" disabled={running}>
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
                        <span className={classes.groupChevron}><IconChevronRight size={14} /></span>
                        <span className={`astraLabel ${classes.groupLabel}`}>{groupKey}</span>
                        {isActive ? <span className={classes.activeDot} /> : <span className={classes.groupCount}>{group.models.length}</span>}
                      </button>
                      {isExpanded && (
                        <div className={classes.groupRows}>
                        <Menu.RadioGroup
                          value={group.provider === (provider ?? null) ? model : null}
                          onChange={(name) => selectModel(name, group.provider)}
                        >
                          {group.models.map((option) => {
                            const selected = option.name === model && group.provider === (provider ?? null);
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
                        </div>
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

          <Menu position="top-end" offset={8} radius="md" transitionProps={{ transition: EFFORT_MENU_TRANSITION, duration: 150, timingFunction: 'cubic-bezier(.2,.6,.3,1)' }}>
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
          )}

          <Box style={{ flex: 1 }} />
          {!running && (
            <Tooltip label="Compact earlier context (/compact)">
              <ActionIcon
                variant="subtle"
                size={30}
                radius={6}
                aria-label="Compact context"
                className={classes.compactButton}
                data-entering={compactEntering || undefined}
                onClick={() => void onCompact(null)}
              >
                <IconSparkles size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          <ContextRing tokens={contextTokens} contextLength={contextLength} estimated={contextEstimated} />
          <Tooltip label={actionLabel}>
            <UnstyledButton
              className={classes.sendButton}
              data-state={sendState}
              onClick={() => void (showStop ? onStop() : submit())}
              aria-label={actionLabel}
            >
              {/* Keyed by icon so it pops in each time it changes. */}
              {showStop
                ? <IconPlayerStopFilled key="stop" size={14} />
                : <IconArrowUp key="send" size={18} stroke={2.2} />}
            </UnstyledButton>
          </Tooltip>
        </Group>
      </Dropzone>
    </Box>
  );
}
