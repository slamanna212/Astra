import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { render } from '../../../test/render';
import { ContentParts } from './ContentParts';

describe('ContentParts', () => {
  it('renders text, images, and workspace files distinctly', () => {
    render(
      <ContentParts
        parts={[
          { type: 'text', text: 'caption' },
          { type: 'image_url', image_url: { url: 'https://example.test/image.png' }, name: 'chart' },
          { type: 'file', path: 'reports/result.csv', name: 'result.csv' },
        ]}
      />,
    );
    expect(screen.getByText('caption')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'chart' })).toHaveAttribute('src', 'https://example.test/image.png');
    expect(screen.getByRole('link', { name: 'result.csv' })).toHaveAttribute(
      'href',
      '/api/files/download?path=reports%2Fresult.csv',
    );
  });
});
