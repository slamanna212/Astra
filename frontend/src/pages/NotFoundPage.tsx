import { Button, Container, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';

export default function NotFoundPage() {
  return (
    <Container size="md" py="xl">
      <Stack gap="sm" align="flex-start">
        <Title order={2}>Page not found</Title>
        <Text c="dimmed">There is nothing at this address.</Text>
        <Button component={Link} to="/chats" variant="light">
          Go to chats
        </Button>
      </Stack>
    </Container>
  );
}
