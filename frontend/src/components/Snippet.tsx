import { parseSnippet } from '../lib/snippet';

/** Renders a backend search snippet, turning its sentinel-marked runs into `<mark>` — never
 * `dangerouslySetInnerHTML`. */
export function Snippet({ text }: { text: string }) {
  const parts = parseSnippet(text);
  return (
    <>
      {parts.map((part, i) =>
        part.marked ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}
