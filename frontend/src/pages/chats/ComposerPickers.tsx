import { Badge, Group, Modal, ScrollArea, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconCheck, IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import type { ChatModelOption, ReasoningEffort } from '../../api/chat';
import classes from './ChatComposer.module.css';

export interface ModelGroup {
  provider: string | null; // null = models with no known provider ("other")
  models: ChatModelOption[];
}

function OptionRow({ label, detail, selected, onClick }: {
  label: string;
  detail?: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton className={classes.sheetOption} data-selected={selected || undefined} onClick={onClick} aria-pressed={selected}>
      <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
        <Text size="sm" fw={selected ? 600 : 400} truncate="end">{label}</Text>
        {detail && <Text size="xs" c="dimmed" truncate="end">{detail}</Text>}
      </Stack>
      {selected && <IconCheck size={16} className={classes.checkIcon} />}
    </UnstyledButton>
  );
}

/** Phone-sized model picker: a modal with a filter and every provider's models listed. */
export function ModelPickerModal({
  opened,
  onClose,
  groups,
  model,
  defaultModel,
  onSelect,
}: {
  opened: boolean;
  onClose: () => void;
  groups: ModelGroup[];
  model: string | null;
  defaultModel: string | null;
  /** `null` clears the override back to the session default. */
  onSelect: (option: ChatModelOption | null) => void;
}) {
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const visible = groups
    .map((group) => {
      if (!query || (group.provider ?? 'other').toLowerCase().includes(query)) return group;
      return { ...group, models: group.models.filter((option) => option.name.toLowerCase().includes(query)) };
    })
    .filter((group) => group.models.length > 0);
  const close = () => {
    setFilter('');
    onClose();
  };
  const choose = (option: ChatModelOption | null) => {
    onSelect(option);
    close();
  };
  return (
    <Modal opened={opened} onClose={close} title="Model" radius="md" size="lg" scrollAreaComponent={ScrollArea.Autosize}>
      <Stack gap="sm">
        <TextInput
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
          placeholder="Filter models"
          aria-label="Filter models"
          leftSection={<IconSearch size={15} />}
        />
        <OptionRow label="Session default" detail={defaultModel ?? '—'} selected={false} onClick={() => choose(null)} />
        {visible.map((group) => (
          <Stack key={group.provider ?? 'other'} gap={2}>
            <Group gap={6} px={4}>
              <Text className="astraLabel" size="xs" c="dimmed">{group.provider ?? 'other'}</Text>
              <Badge size="xs" variant="light" color="gray" radius="sm">{group.models.length}</Badge>
            </Group>
            {group.models.map((option) => (
              <OptionRow
                key={`${group.provider ?? ''}:${option.name}`}
                label={option.name}
                selected={option.name === model}
                onClick={() => choose(option)}
              />
            ))}
          </Stack>
        ))}
        {visible.length === 0 && <Text size="sm" c="dimmed" ta="center" py="md">No models match “{filter.trim()}”</Text>}
      </Stack>
    </Modal>
  );
}

/** Phone-sized reasoning effort picker. */
export function EffortPickerModal({
  opened,
  onClose,
  efforts,
  value,
  onChange,
}: {
  opened: boolean;
  onClose: () => void;
  efforts: ReasoningEffort[];
  value: ReasoningEffort | null;
  onChange: (value: ReasoningEffort | null) => void;
}) {
  const choose = (next: ReasoningEffort | null) => {
    onChange(next);
    onClose();
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Reasoning effort" radius="md">
      <Stack gap={2}>
        <OptionRow label="Default" selected={value === null} onClick={() => choose(null)} />
        {efforts.map((effort) => (
          <OptionRow
            key={effort}
            label={`${effort[0]!.toUpperCase()}${effort.slice(1)}`}
            selected={value === effort}
            onClick={() => choose(effort)}
          />
        ))}
      </Stack>
    </Modal>
  );
}
