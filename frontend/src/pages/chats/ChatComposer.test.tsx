import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../../test/render';
import { ChatComposer } from './ChatComposer';

function Harness({ onSend, onAttach }: { onSend: (text: string) => Promise<void>; onAttach: (file: File) => Promise<string> }) {
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState<string | null>('model-a');
  const [provider, setProvider] = useState<string | null>('acme');
  return (
    <ChatComposer
      running={false}
      onSend={onSend}
      onStop={vi.fn()}
      onSteer={vi.fn()}
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
      draft={draft}
      onDraftChange={setDraft}
      onAttach={onAttach}
      liveTps={null}
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
});
