import {
  IconBrain,
  IconChartBar,
  IconClock,
  IconFileText,
  IconFolder,
  IconMessages,
  IconSettings,
  IconSparkles,
  type Icon,
} from '@tabler/icons-react';

export interface NavItem {
  label: string;
  to: string;
  icon: Icon;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Chats', to: '/chats', icon: IconMessages },
  { label: 'Scheduled tasks', to: '/cron', icon: IconClock },
  { label: 'Skills', to: '/skills', icon: IconSparkles },
  { label: 'Memories', to: '/memories', icon: IconBrain },
  { label: 'Files', to: '/files', icon: IconFolder },
  { label: 'Insights', to: '/insights', icon: IconChartBar },
  { label: 'Logs', to: '/logs', icon: IconFileText },
  { label: 'Settings', to: '/settings', icon: IconSettings },
];
