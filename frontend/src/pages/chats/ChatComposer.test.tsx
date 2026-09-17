import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../../test/render';
import { ChatComposer } from './ChatComposer';

function Harness({
  onSend,
  onAttach,
  onCompact = vi.fn(async () => true),
  running = false,
  busyTurnMode = 'steer',
  onQueue = vi.fn(async () => undefined),
  onInterrupt = vi.fn(async () => undefined),
  onSteer = vi.fn(async () => undefined),
}: {
  onSend: (text: string) => Promise<void>;
  onAttach: (file: File) => Promise<string>;
  onCompact?: (focusTopic: string | null) => Promise<boolean>;
  running?: boolean;
  busyTurnMode?: import('../../lib/uiPreferences').BusyTurnMode;
  onQueue?: (text: string) => Promise<void>;
  onInterrupt?: (text: string) => Promise<void>;
  onSteer?: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState<string | null>('model-a');
  const [provider, setProvider] = useState<string | null>('acme');
  const [reasoningEffort, setReasoningEffort] = useState<import('../../api/chat').ReasoningEffort | null>(null);
  return (
    <ChatComposer
      running={running}
      onSend={onSend}
      onStop={vi.fn()}
      onSteer={onSteer}
      onQueue={onQueue}
      onInterrupt={onInterrupt}
      onCompact={onCompact}
      model={model}
      provider={provider}
      models={[
        { name: 'model-a', provider: 'acme' },
        { name: 'model-b', provider: 'acme' },
      ]}
      providers={['acme']}
      defaultModel="model-a"
      onModelChange={setModel}
      onProviderChange={setProvider}
      reasoningEffort={reasoningEffort}
      onReasoningEffortChange={setReasoningEffort}
      draft={draft}
      onDraftChange={setDraft}
      onAttach={onAttach}
      liveTps={null}
      busyTurnMode={busyTurnMode}
      onBusyTurnModeChange={vi.fn()}
    />
  );
}

describe('ChatComposer', () => {
  it('selects a model, uploads an attachment, and includes its canonical workspace path', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => undefined);
    const onAttach = vi.fn(async () => 'diagram.png');
    render(<Harness onSend={onSend} onAttach={onAttach} />);

    await user.click(screen.getByRole('button', { name: 'Model' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'model-b' }));
    const file = new File(['image'], 'diagram.png', { type: 'image/png' });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    expect(await screen.findByText('diagram.png')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Message Hermes…'), 'Please inspect this');
    await user.click(screen.getByLabelText('Send message'));

    expect(onAttach).toHaveBeenCalledWith(file);
    expect(onSend).toHaveBeenCalledWith('[Attached workspace file: diagram.png]\n\nPlease inspect this');
  });

  it('selects a reasoning effort', async () => {
    const user = userEvent.setup();
    render(<Harness onSend={vi.fn(async () => undefined)} onAttach={vi.fn(async () => 'file')} />);

    await user.click(screen.getByRole('button', { name: 'Reasoning effort' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'high' }));

    expect(screen.getByRole('button', { name: 'Reasoning effort' })).toHaveTextContent('high');
  });

  it('runs /compact locally with an optional focus topic', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => undefined);
    const onCompact = vi.fn(async () => true);
    render(<Harness onSend={onSend} onAttach={vi.fn(async () => 'file')} onCompact={onCompact} />);

    await user.type(screen.getByPlaceholderText('Message Hermes…'), '/compact deployment decisions');
    await user.click(screen.getByLabelText('Send message'));

    expect(onCompact).toHaveBeenCalledWith('deployment decisions');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Message Hermes…')).toHaveValue('');
  });

  it('offers one-click context compaction', async () => {
    const user = userEvent.setup();
    const onCompact = vi.fn(async () => true);
    render(<Harness onSend={vi.fn(async () => undefined)} onAttach={vi.fn(async () => 'file')} onCompact={onCompact} />);

    await user.click(screen.getByRole('button', { name: 'Compact context' }));

    expect(onCompact).toHaveBeenCalledWith(null);
  });

  it.each([
    ['queue', 'Queue while Hermes is responding…', 'Queue message', 'onQueue'],
    ['interrupt', 'Interrupt while Hermes is responding…', 'Interrupt message', 'onInterrupt'],
    ['steer', 'Steer while Hermes is responding…', 'Steer message', 'onSteer'],
  ] as const)('routes busy input through %s mode', async (mode, placeholder, buttonName, expectedHandler) => {
    const user = userEvent.setup();
    const handlers = {
      onQueue: vi.fn(async () => undefined),
      onInterrupt: vi.fn(async () => undefined),
      onSteer: vi.fn(async () => undefined),
    };
    render(
      <Harness
        running
        busyTurnMode={mode}
        onSend={vi.fn(async () => undefined)}
        onAttach={vi.fn(async () => 'file')}
        {...handlers}
      />,
    );

    await user.type(screen.getByPlaceholderText(placeholder), 'change course');
    await user.click(screen.getByLabelText(buttonName));

    expect(handlers[expectedHandler]).toHaveBeenCalledWith('change course');
  });
});
