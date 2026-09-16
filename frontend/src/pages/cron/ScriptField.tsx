import { Alert, Box, Button, Code, Collapse, Group, Loader, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconCode } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { getCronJobScript, type CronScriptFieldName } from '../../api/cron';
import { isApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';

// Same lazy highlight.js chunk the Files preview uses — never loaded until a script is expanded.
const CodePreview = lazy(() => import('../../components/CodePreview'));

function languageFor(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = { py: 'python', sh: 'bash', js: 'javascript', ts: 'typescript', rb: 'ruby' };
  return ext ? (map[ext] ?? null) : null;
}

/** A job's script/post_script/monitor_script field: filename + an expand-to-view code viewer
 * that fetches the script's content from `$HERMES_HOME/scripts/<filename>` on demand. */
export function ScriptField({ jobId, field, filename }: { jobId: string; field: CronScriptFieldName; filename: string }) {
  const [opened, { toggle }] = useDisclosure(false);
  const query = useQuery({
    queryKey: queryKeys.cron.script(jobId, field),
    queryFn: ({ signal }) => getCronJobScript(jobId, field, signal),
    enabled: opened,
  });

  return (
    <div>
      <Group gap="xs">
        <Code>{filename}</Code>
        <Button size="compact-xs" variant="subtle" leftSection={<IconCode size={14} />} onClick={toggle}>
          {opened ? 'Hide' : 'View'} script
        </Button>
      </Group>
      <Collapse expanded={opened}>
        <Box mt={8}>
          {query.isLoading && <Loader size="sm" />}
          {query.isError && (
            <Alert color="red" title="Couldn't load script">
              {isApiError(query.error, 404) ? 'Script file not found under $HERMES_HOME/scripts.' : query.error.message}
            </Alert>
          )}
          {query.data && (
            <Suspense fallback={<Text size="sm">{query.data.content}</Text>}>
              <CodePreview code={query.data.content} language={languageFor(query.data.filename)} />
            </Suspense>
          )}
        </Box>
      </Collapse>
    </div>
  );
}
