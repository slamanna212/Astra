import { memo, useState } from 'react';
import { splitStreamingMarkdown } from '../lib/streamingMarkdown';
import { Markdown } from './Markdown';
import classes from './StreamingMarkdown.module.css';

/**
 * Markdown for text that is still arriving. Finished blocks (everything before the last blank
 * line outside a code fence) render once through the normal memoized renderer; only the block
 * being written re-parses per frame, so a long answer does not re-render in full on every token.
 * Text appended to that block fades in rather than popping.
 */
export const StreamingMarkdown = memo(function StreamingMarkdown({ text, sessionId }: { text: string; sessionId?: string }) {
  const { stable, tail } = splitStreamingMarkdown(text);
  // Where each appended chunk of the block being written began. Growth adds a chunk at the old
  // length; a new block starts over.
  const [chunks, setChunks] = useState(() => ({ tail, starts: [0] }));
  let starts = chunks.starts;
  if (chunks.tail !== tail) {
    starts = chunks.tail && tail.startsWith(chunks.tail) ? [...chunks.starts, chunks.tail.length] : [0];
    setChunks({ tail, starts });
  }
  return (
    <div className={classes.root}>
      {stable && <Markdown sessionId={sessionId}>{stable}</Markdown>}
      <div className={classes.tail}>
        <Markdown sessionId={sessionId} streaming chunkStarts={starts}>{tail}</Markdown>
      </div>
    </div>
  );
});
