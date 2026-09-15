import { Badge, type BadgeProps } from '@mantine/core';
import { sourceColor } from '../lib/sources';

export function SourceBadge({ source, ...props }: { source: string } & Omit<BadgeProps, 'color'>) {
  return (
    <Badge variant="light" size="xs" radius="sm" color={sourceColor(source)} {...props}>
      {source || 'unknown'}
    </Badge>
  );
}
