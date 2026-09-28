const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Split streamed Markdown into the part whose blocks are finished and the block still being
 * written: at the last blank line that is not inside a fenced code block.
 */
export function splitStreamingMarkdown(text: string): { stable: string; tail: string } {
  let inFence: string | null = null;
  let splitAt = 0;
  let offset = 0;
  let previousBlank = false;
  for (const line of text.split('\n')) {
    const fence = FENCE.exec(line)?.[1];
    if (fence) {
      if (inFence === null) inFence = fence;
      else if (fence[0] === inFence[0] && fence.length >= inFence.length) inFence = null;
    }
    const blank = line.trim() === '';
    // A non-blank line after a blank line outside a fence starts a new block.
    if (!blank && previousBlank) splitAt = offset;
    previousBlank = blank && inFence === null;
    offset += line.length + 1;
  }
  return { stable: text.slice(0, splitAt).trimEnd(), tail: text.slice(splitAt) };
}
