import { Anchor, Code, Image, Paper, Stack, Text } from '@mantine/core';
import { fileDownloadUrl } from '../../../api/files';
import type { MessageContentPart } from '../../../api/types';

function stringValue(part: MessageContentPart, key: string): string | null {
  const value = part[key];
  return typeof value === 'string' && value ? value : null;
}

export function ContentParts({ parts }: { parts: MessageContentPart[] }) {
  return (
    <Stack gap="xs">
      {parts.map((part, index) => {
        const type = part.type.toLowerCase();
        const text = stringValue(part, 'text') ?? stringValue(part, 'content');
        if ((type === 'text' || type === 'input_text' || type === 'output_text') && text) {
          return (
            <Text key={index} style={{ fontSize: 'var(--astra-chat-font-size, 14px)', whiteSpace: 'pre-wrap' }}>
              {text}
            </Text>
          );
        }
        const nestedImage = part.image_url;
        const imageUrl =
          stringValue(part, 'url') ??
          (typeof nestedImage === 'string' ? nestedImage : nestedImage && typeof nestedImage === 'object' && 'url' in nestedImage && typeof nestedImage.url === 'string' ? nestedImage.url : null);
        if ((type.includes('image') || imageUrl) && imageUrl) {
          return <Image key={index} src={imageUrl} alt={stringValue(part, 'name') ?? 'Attached image'} radius="sm" w="auto" maw="100%" mah={420} fit="contain" style={{ alignSelf: 'flex-start' }} referrerPolicy="no-referrer" />;
        }
        const path = stringValue(part, 'path') ?? stringValue(part, 'file_path');
        if (type.includes('file') && path) {
          return (
            <Paper key={index} withBorder p="xs">
              <Anchor href={fileDownloadUrl(path)} target="_blank" rel="noreferrer">{stringValue(part, 'name') ?? path}</Anchor>
            </Paper>
          );
        }
        return <Code key={index} block>{JSON.stringify(part, null, 2)}</Code>;
      })}
    </Stack>
  );
}
