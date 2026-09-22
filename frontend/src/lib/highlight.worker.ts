import { highlightWindow } from './highlightSyntax';
import type { HighlightRequest, HighlightResponse } from './highlightClient';

self.onmessage = (event: MessageEvent<HighlightRequest>) => {
  const { id, code, language, start, end } = event.data;
  let html: string | null = null;
  try {
    html = highlightWindow(code, language, start, end);
  } catch {
    // Unsupported/malformed input remains readable as escaped plain text in the component.
  }
  self.postMessage({ id, html } satisfies HighlightResponse);
};
