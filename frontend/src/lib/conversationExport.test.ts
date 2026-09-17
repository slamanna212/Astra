import { describe, expect, it } from 'vitest';
import type { Message, SessionDetail } from '../api/types';
import {
  conversationExportBlob,
  conversationToMarkdown,
  conversationToPdf,
  createConversationExport,
  exportFilename,
} from './conversationExport';

const session = {
  id: 'session-1', title: 'Export / Test', display_name: null, source: 'webui', model: 'test-model',
  started_at: 1_700_000_000, last_activity_at: null, ended_at: null, message_count: 2,
  tool_call_count: 0, input_tokens: 4, output_tokens: 5, estimated_cost_usd: null,
  pinned: false, archived: false, hidden: false, parent_session_id: null,
  last_activity_description: null, child_count: 0, context_length: null,
  last_prompt_tokens: null, context_tokens: 4, context_tokens_estimated: true,
} satisfies SessionDetail;

const message = {
  id: 1, role: 'user', content: 'Hello, Astra!', truncated: false, tool_calls: null,
  tool_call_id: null, tool_name: null, timestamp: 1_700_000_001, token_count: 4,
  finish_reason: null, reasoning: null, display_kind: null, display_metadata: null,
  effect_disposition: null, active: true, compacted: false,
} satisfies Message;

describe('conversation exports', () => {
  it('builds a readable Markdown transcript', () => {
    const markdown = conversationToMarkdown(createConversationExport(session, [message]));
    expect(markdown).toContain('# Export / Test');
    expect(markdown).toContain('## User — 2023-11-14T22:13:21.000Z');
    expect(markdown).toContain('Hello, Astra!');
  });

  it('creates JSON with a useful content type and safe filename', async () => {
    const blob = conversationExportBlob(createConversationExport(session, [message]), 'json');
    expect(blob.type).toBe('application/json;charset=utf-8');
    expect(JSON.parse(await blob.text()).messages).toHaveLength(1);
    expect(exportFilename(session, 'json')).toBe('Export-Test.json');
  });

  it('creates a PDF document with at least one page', async () => {
    const pdf = conversationToPdf(createConversationExport(session, [message]));
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.4');
    const document = await pdf.text();
    expect(document).toContain('/Type /Page');
    expect(document).toContain('CONVERSATION EXPORT');
    expect(document).toContain('0.169 0.714 0.769 rg');
    expect(document).toContain('/BaseFont /Helvetica-Bold');
  });
});
