import { Container, Stack, Text, Title } from '@mantine/core';

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <Container size="md" py="xl">
      <Stack gap="xs">
        <Title order={2}>{title}</Title>
        <Text c="dimmed">Coming in Phase 1.</Text>
      </Stack>
    </Container>
  );
}
