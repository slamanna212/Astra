import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../../test/render';
import { ChatComposer } from './ChatComposer';

function Harness({
  onSend,
  onAttach,
  onCompact = vi.fn(async () => true),
  onSkills = vi.fn(async () => true),
  running = false,
  busyTurnMode = 'steer',
  onQueue = vi.fn(async () => undefined),
  onInterrupt = vi.fn(async () => undefined),
  onSteer = vi.fn(async () => undefined),
  onStop = vi.fn(async () => undefined),
}: {
  onSend: (text: string) => Promise<void>;
  onAttach: (file: File) => Promise<string>;
  onCompact?: (focusTopic: string | null) => Promise<boolean>;
  onSkills?: (query: string | null) => Promise<boolean>;
  running?: boolean;
  busyTurnMode?: import('../../lib/uiPreferences').BusyTurnMode;
  onQueue?: (text: string) => Promise<void>;
  onInterrupt?: (text: string) => Promise<void>;
  onSteer?: (text: string) => Promise<void>;
  onStop?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState<string | null>('model-a');
  const [provider, setProvider] = useState<string | null>('acme');
  const [reasoningEffort, setReasoningEffort] = useState<import('../../api/chat').ReasoningEffort | null>(null);
  return (
    <ChatComposer
      running={running}
      onSend={onSend}
      onStop={onStop}
      onSteer={onSteer}
      onQueue={onQueue}
      onInterrupt={onInterrupt}
      onCompact={onCompact}
      onSkills={onSkills}
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
      busyTurnMode={busyTurnMode}
      contextTokens={0}
      contextLength={null}
      contextEstimated={false}
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

  it('uploads files dropped onto the composer', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => undefined);
    const onAttach = vi.fn(async (file: File) => file.name);
    render(<Harness onSend={onSend} onAttach={onAttach} />);

    const first = new File(['a'], 'notes.txt', { type: 'text/plain' });
    const second = new File(['b'], 'photo.jpg', { type: 'image/jpeg' });
    const card = screen.getByPlaceholderText('Message Hermes…').closest('[data-astra-composer]') as HTMLElement;
    const items = [first, second].map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file }));
    fireEvent.drop(card, { dataTransfer: { files: [first, second], items, types: ['Files'] } });

    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    expect(await screen.findByText('photo.jpg')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Send message'));
    expect(onSend).toHaveBeenCalledWith('[Attached workspace file: notes.txt]\n[Attached workspace file: photo.jpg]');
  });

  it('selects a reasoning effort', async () => {
    const user = userEvent.setup();
    render(<Harness onSend={vi.fn(async () => undefined)} onAttach={vi.fn(async () => 'file')} />);

    await user.click(screen.getByRole('button', { name: 'Reasoning effort' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'high' }));

    expect(screen.getByRole('button', { name: 'Reasoning effort' })).toHaveTextContent('High effort');
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

  it('runs /skills locally with an optional filter', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => undefined);
    const onSkills = vi.fn(async () => true);
    render(<Harness onSend={onSend} onAttach={vi.fn(async () => 'file')} onSkills={onSkills} />);

    await user.type(screen.getByPlaceholderText('Message Hermes…'), '/skills development');
    await user.click(screen.getByLabelText('Send message'));

    expect(onSkills).toHaveBeenCalledWith('development');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Message Hermes…')).toHaveValue('');
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

  it('shows Stop while running with an empty draft and swaps back once typing', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn(async () => undefined);
    const onSteer = vi.fn(async () => undefined);
    render(<Harness running onStop={onStop} onSteer={onSteer} onSend={vi.fn(async () => undefined)} onAttach={vi.fn(async () => 'file')} />);

    await user.click(screen.getByLabelText('Stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Steer message')).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Steer while Hermes is responding…'), 'x');
    expect(screen.queryByLabelText('Stop')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Steer message'));
    expect(onSteer).toHaveBeenCalledWith('x');
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe('ChatComposer on a phone', () => {
  function phoneViewport() {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  it('shows model and effort as icons that open pickers', async () => {
    phoneViewport();
    const user = userEvent.setup();
    render(<Harness onSend={vi.fn(async () => undefined)} onAttach={vi.fn(async () => 'x')} />);

    // The pill labels are gone; the controls are icon buttons.
    expect(screen.queryByText('Default effort')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Model' }));
    await user.click(await screen.findByRole('button', { name: 'model-b' }));
    await user.click(screen.getByRole('button', { name: 'Model' }));
    expect(await screen.findByRole('button', { name: 'model-b', pressed: true })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Reasoning effort' }));
    await user.click(await screen.findByRole('button', { name: 'High' }));
    await user.click(screen.getByRole('button', { name: 'Reasoning effort' }));
    expect(await screen.findByRole('button', { name: 'High', pressed: true })).toBeInTheDocument();
  });

  it('sends on Enter with a keyboard, but adds a new line on Enter with a touchscreen keyboard', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => undefined);
    const { unmount } = render(<Harness onSend={onSend} onAttach={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('Message Hermes…'), 'hi{Enter}');
    expect(onSend).toHaveBeenCalledWith('hi');
    unmount();
    onSend.mockClear();

    const matchMedia = vi.mocked(window.matchMedia);
    const original = matchMedia.getMockImplementation();
    matchMedia.mockImplementation((query: string) => ({ ...original!(query), matches: query.includes('pointer: coarse') }));
    try {
      render(<Harness onSend={onSend} onAttach={vi.fn()} />);
      const input = screen.getByPlaceholderText('Message Hermes…');
      await user.type(input, 'line one{Enter}line two');
      expect(onSend).not.toHaveBeenCalled();
      expect(input).toHaveValue('line one\nline two');
      await user.click(screen.getByRole('button', { name: 'Send message' }));
      expect(onSend).toHaveBeenCalledWith('line one\nline two');
    } finally {
      matchMedia.mockImplementation(original!);
    }
  });
});
