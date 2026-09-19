import { Alert, Code, Loader, Modal, useComputedColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useEffect, useId, useState } from 'react';
import classes from './Markdown.module.css';

type DiagramState =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error'; message: string };

/** Mermaid derives shades with its own color math, so it needs concrete colors rather than
 * var() references — resolve the Graphite tokens for whichever scheme is active right now. */
function themeVariables(scheme: 'light' | 'dark') {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(`--astra-${name}`).trim();
  const text = token('text');
  const dim = token('text-dim');
  const surface = token('surface');
  const sunk = token('surface-sunk');
  const border = token('border-strong');
  const palette = ['primary', 'syntax-string', 'syntax-function', 'syntax-number', 'syntax-property', 'danger', 'syntax-comment'].map(token);
  return {
    darkMode: scheme === 'dark',
    background: token('bg'),
    fontFamily: token('font'),
    fontSize: '13px',
    primaryColor: surface,
    primaryTextColor: text,
    primaryBorderColor: border,
    secondaryColor: sunk,
    secondaryTextColor: text,
    secondaryBorderColor: border,
    tertiaryColor: sunk,
    tertiaryTextColor: text,
    tertiaryBorderColor: border,
    lineColor: dim,
    textColor: text,
    titleColor: text,
    edgeLabelBackground: surface,
    clusterBkg: sunk,
    clusterBorder: border,
    // sequence
    actorBkg: surface,
    actorBorder: border,
    actorTextColor: text,
    actorLineColor: dim,
    signalColor: dim,
    signalTextColor: text,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: border,
    labelTextColor: text,
    loopTextColor: text,
    noteBkgColor: token('accent-soft'),
    noteTextColor: text,
    noteBorderColor: token('accent'),
    activationBkgColor: sunk,
    activationBorderColor: border,
    sequenceNumberColor: token('primary-ink'),
    // pie
    ...Object.fromEntries(palette.map((color, i) => [`pie${i + 1}`, color])),
    pieTitleTextColor: text,
    pieSectionTextColor: token('bg'),
    pieLegendTextColor: text,
    pieStrokeColor: token('bg'),
    pieOuterStrokeColor: border,
    pieOpacity: '1',
    // xychart
    xyChart: {
      backgroundColor: 'transparent',
      titleColor: text,
      xAxisLabelColor: dim,
      xAxisTitleColor: text,
      xAxisTickColor: dim,
      xAxisLineColor: border,
      yAxisLabelColor: dim,
      yAxisTitleColor: text,
      yAxisTickColor: dim,
      yAxisLineColor: border,
      plotColorPalette: palette.join(', '),
    },
  };
}

// mermaid.render() keeps per-diagram-type parser state in module globals and measures text in a
// shared scratch node, so two renders in flight corrupt each other (a pie + an xychart in one
// message would each intermittently fail, depending on which chunk resolved first). Serialize.
let renderQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(task, task);
  renderQueue = run.catch(() => undefined);
  return run;
}

export default function MermaidDiagram({ definition }: { definition: string }) {
  const reactId = useId();
  const scheme = useComputedColorScheme('dark');
  const [state, setState] = useState<DiagramState>({ status: 'loading' });
  const [enlarged, { open, close }] = useDisclosure(false);

  useEffect(() => {
    let cancelled = false;

    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}-${scheme}`;
        // initialize() is global too, so it runs inside the queue right before its own render.
        const { svg } = await enqueue(() => {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'base',
            themeVariables: themeVariables(scheme),
          });
          return mermaid.render(id, definition);
        });
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
  }, [definition, reactId, scheme]);

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
    <>
      <button type="button" className={classes.mermaidTrigger} onClick={open} title="Open larger">
        <span
          className={classes.mermaid}
          role="img"
          aria-label="Mermaid diagram"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      </button>
      <Modal opened={enlarged} onClose={close} size="90%" title="Diagram">
        <div
          className={classes.mermaidLightbox}
          role="img"
          aria-label="Mermaid diagram, enlarged"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      </Modal>
    </>
  );
}
