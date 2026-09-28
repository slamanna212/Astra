import { memo } from 'react';
import { splitStreamingMarkdown } from '../lib/streamingMarkdown';
import { Markdown } from './Markdown';
import classes from './StreamingMarkdown.module.css';

/**
 * Markdown for text that is still arriving. Finished blocks (everything before the last blank
 * line outside a code fence) render once through the normal memoized renderer; only the block
 * being written re-parses per frame, so a long answer does not re-render in full on every token.
 */
export const StreamingMarkdown = memo(function StreamingMarkdown({ text, sessionId }: { text: string; sessionId?: string }) {
  const { stable, tail } = splitStreamingMarkdown(text);
  return (
    <div className={classes.root}>
      {stable && <Markdown sessionId={sessionId}>{stable}</Markdown>}
      <div className={classes.tail}>
        <Markdown sessionId={sessionId} streaming>{tail}</Markdown>
      </div>
    </div>
  );
});
