import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InsightsResponse } from '../../api/types';
import { jsonResponse, render } from '../../test/render';
import InsightsPage from './InsightsPage';

function makeReport(overrides: Partial<InsightsResponse> = {}): InsightsResponse {
  return {
    days: '30',
    tz: 'UTC',
    range_start: 1_700_000_000,
    range_end: 1_702_600_000,
    totals: {
      sessions: 12,
      messages: 480,
      api_calls: 900,
      tool_calls: 300,
      input_tokens: 1_000_000,
      output_tokens: 200_000,
      cache_read_tokens: 500_000,
      cache_write_tokens: 10_000,
      reasoning_tokens: 50_000,
      total_tokens: 1_710_000,
      estimated_cost_usd: 12.3456,
      actual_cost_usd: 0,
      cache_hit_rate: 0.3333,
      auxiliary_estimated_cost_usd: 1.5,
      auxiliary_input_tokens: 40_000,
      auxiliary_output_tokens: 8_000,
    },
    daily: [
      {
        date: '2026-09-14',
        sessions: 3,
        input_tokens: 300_000,
        output_tokens: 60_000,
        cache_read_tokens: 100_000,
        cache_write_tokens: 0,
        reasoning_tokens: 10_000,
        estimated_cost_usd: 3.2,
      },
      {
        date: '2026-09-15',
        sessions: 4,
        input_tokens: 400_000,
        output_tokens: 80_000,
        cache_read_tokens: 150_000,
        cache_write_tokens: 0,
        reasoning_tokens: 12_000,
        estimated_cost_usd: 4.1,
      },
    ],
    models: [
      {
        model: 'deepseek-flash',
        sessions: 8,
        api_calls: 500,
        input_tokens: 700_000,
        output_tokens: 140_000,
        cache_read_tokens: 300_000,
        cache_write_tokens: 0,
        reasoning_tokens: 30_000,
        estimated_cost_usd: 8.0,
        actual_cost_usd: 0,
      },
    ],
    providers: [
      {
        provider: 'deepseek',
        sessions: 8,
        api_calls: 500,
        input_tokens: 700_000,
        output_tokens: 140_000,
        cache_read_tokens: 300_000,
        cache_write_tokens: 0,
        reasoning_tokens: 30_000,
        estimated_cost_usd: 8.0,
        actual_cost_usd: 0,
      },
    ],
    sources: [
      { source: 'webui', sessions: 7, messages: 300, tool_calls: 200, input_tokens: 600_000, output_tokens: 120_000, estimated_cost_usd: 7.0 },
      { source: 'subagent', sessions: 5, messages: 180, tool_calls: 100, input_tokens: 400_000, output_tokens: 80_000, estimated_cost_usd: 5.3456 },
    ],
    auxiliary: [
      {
        task: 'title_generation',
        sessions: 6,
        api_calls: 20,
        input_tokens: 20_000,
        output_tokens: 4_000,
        reasoning_tokens: 0,
        estimated_cost_usd: 1.0,
        actual_cost_usd: 0,
      },
    ],
    top_sessions: [
      {
        id: 'sess-1',
        title: 'Most expensive session',
        display_name: null,
        source: 'webui',
        model: 'deepseek-flash',
        started_at: 1_702_000_000,
        estimated_cost_usd: 9.99,
        input_tokens: 500_000,
        output_tokens: 100_000,
      },
    ],
    ...overrides,
  };
}

describe('InsightsPage', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('renders stat cards, breakdowns, and the top-sessions table from the API response', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(makeReport()));

    render(<InsightsPage />, { route: '/insights' });

    expect(await screen.findByText('12')).toBeInTheDocument(); // sessions stat card
    expect(screen.getByText('33.3%')).toBeInTheDocument(); // cache hit rate
    expect(screen.getByText('$12.35')).toBeInTheDocument(); // estimated cost
    expect(screen.getByText('$1.50 auxiliary')).toBeInTheDocument();

    // "deepseek-flash" / "deepseek" appear both as chart tick labels and table cells.
    expect(screen.getAllByText('deepseek-flash').length).toBeGreaterThan(0);
    expect(screen.getAllByText('deepseek').length).toBeGreaterThan(0);
    expect(screen.getByText('title_generation')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Most expensive session' });
    expect(link).toHaveAttribute('href', '/chats/sess-1');

    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/insights');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('days=30');
  });

  it('shows an empty state when there are no sessions in range', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        makeReport({
          totals: { ...makeReport().totals, sessions: 0 },
          daily: [],
          models: [],
          providers: [],
          sources: [],
          auxiliary: [],
          top_sessions: [],
        }),
      ),
    );

    render(<InsightsPage />, { route: '/insights' });

    expect(await screen.findByText('No sessions in this range.')).toBeInTheDocument();
  });

  it('shows a loading state before data arrives', () => {
    fetchMock.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<InsightsPage />, { route: '/insights' });
    expect(screen.getByText('Insights')).toBeInTheDocument();
  });
});
