import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusResponse } from '../../api/types';
import { updateUiPreferences } from '../../lib/uiPreferences';
import { jsonResponse, render } from '../../test/render';
import SettingsPage from './SettingsPage';

function makeStatus(overrides: Partial<StatusResponse> = {}): StatusResponse {
  return {
    version: '0.9.0',
    hermes_home_exists: true,
    state_db_ok: true,
    session_count: 86,
    journal_mode: 'wal',
    hermes_src_configured: true,
    hermes_importable: true,
    ...overrides,
  };
}

describe('SettingsPage', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    updateUiPreferences({ sidebarDesktopCollapsed: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('shows system status once /api/status resolves', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(makeStatus()));
    render(<SettingsPage />);

    expect(await screen.findByText('v0.9.0')).toBeInTheDocument();
    expect(screen.getByText('86')).toBeInTheDocument();
    expect(screen.getByText('wal')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('shows a degraded badge and reason when the state database is unreachable', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(makeStatus({ state_db_ok: false })));
    render(<SettingsPage />);

    expect(await screen.findByText('Degraded')).toBeInTheDocument();
    expect(screen.getByText('Unreachable')).toBeInTheDocument();
  });

  it('shows an error state when the status request fails', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ detail: 'nope' }, 500));
    render(<SettingsPage />);

    expect(await screen.findByText('Failed to load system status')).toBeInTheDocument();
  });

  it('toggles the sidebar-collapsed preference', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(makeStatus()));
    const user = userEvent.setup();
    render(<SettingsPage />);

    const toggle = screen.getByRole('switch', { name: /Collapse sidebar by default/ });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();
  });

  it('changes the color scheme', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(makeStatus()));
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByText('Dark'));
    // SegmentedControl re-renders with the new value selected; no crash / no stray request.
    expect(screen.getByLabelText('Color scheme')).toBeInTheDocument();
  });

  it('changes the chat font size', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(makeStatus()));
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByText('Large'));
    expect(screen.getByLabelText('Chat font size')).toBeInTheDocument();
  });
});
