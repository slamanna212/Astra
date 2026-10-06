import { describe, expect, it } from 'vitest';
import { summarizeToolNames, toolArgumentPreview, toolCategory, toolTitle } from './toolDisplay';

describe('toolArgumentPreview', () => {
  it('prefers a primary key, then any string, then the first entry of a string list', () => {
    expect(toolArgumentPreview({ query: 'new games', limit: 5 })).toBe('new games');
    expect(toolArgumentPreview('{"urls": ["https://a.example/x"]}')).toBe('https://a.example/x');
    expect(toolArgumentPreview({ urls: ['https://a.example/x', 'https://b.example/y', 'https://c.example/z'] })).toBe('https://a.example/x +2');
    expect(toolArgumentPreview({ ids: [1, 2] })).toBe('{ "ids": [ 1, 2 ] }');
  });
});

describe('tool names', () => {
  it('gives the tool-search bridge and memory tools readable titles', () => {
    expect(toolTitle('tool_call')).toBe('Called tool');
    expect(toolTitle('tool_describe', true)).toBe('Looking up tool');
    expect(toolTitle('viking_search')).toBe('Searched memory');
    expect(toolTitle('browser_exec')).toBe('Ran browser script');
    expect(toolCategory('mcp__home_assistant__ha_search')).toBe('mcp');
  });

  it('names the MCP tool a bridge call targets', () => {
    expect(toolArgumentPreview({ arguments: { detail_level: 'full' }, name: 'mcp__home_assistant__ha_get_overview' }))
      .toBe('home_assistant · ha_get_overview');
  });

  it('summarizes bridge calls as MCP calls', () => {
    expect(summarizeToolNames(['tool_describe', 'tool_call', 'tool_call', 'terminal'])).toBe('3 MCP calls, ran 1 command');
  });
});
