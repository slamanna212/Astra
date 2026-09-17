import { Alert, Code, Loader } from '@mantine/core';
import { useEffect, useId, useState } from 'react';
import classes from './Markdown.module.css';

type DiagramState =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error'; message: string };

let initialized = false;

export default function MermaidDiagram({ definition }: { definition: string }) {
  const reactId = useId();
  const [state, setState] = useState<DiagramState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        if (!initialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'neutral',
          });
          initialized = true;
        }

        const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
        const { svg } = await mermaid.render(id, definition);
        if (!cancelled) setState({ status: 'ready', svg });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'The Mermaid diagram could not be rendered.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [definition, reactId]);

  if (state.status === 'loading') {
    return <Loader size="sm" aria-label="Rendering Mermaid diagram" />;
  }

  if (state.status === 'error') {
    return (
      <Alert color="red" title="Invalid Mermaid diagram">
        {state.message}
        <Code block mt="xs">{definition}</Code>
      </Alert>
    );
  }

  // Mermaid generates the SVG from its own parser. `securityLevel: 'strict'` sanitizes the SVG
  // and disables interactive HTML/links before it reaches this rendering boundary.
  return (
    <div
      className={classes.mermaid}
      role="img"
      aria-label="Mermaid diagram"
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
