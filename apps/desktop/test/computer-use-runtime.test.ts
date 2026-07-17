import { describe, expect, it } from 'vitest';
import { createWorkflow } from '../src/shared/defaults';
import {
  DEFAULT_BROWSER_TOOLS,
  compileComputerUseBlock,
  createDefaultComputerUseConfig,
  defaultComputerUseInstruction,
  getComputerUseBlockMetadataIssue,
  getComputerUseBlockPresentation,
  setComputerUseBlockPresentation,
  type ComputerUseBlockConfig,
} from '../src/shared/computer-use-runtime';

describe('Computer Use runtime compiler', () => {
  it('creates one complete, visibly bounded TradingView configuration', () => {
    expect(
      createDefaultComputerUseConfig({ id: 'browser-task', model: 'gpt-test' }),
    ).toMatchObject({
      id: 'browser-task',
      target: 'tradingview',
      model: 'gpt-test',
      startUrl: 'https://www.tradingview.com/chart/',
      allowedOrigins: ['https://www.tradingview.com'],
      allowedTools: DEFAULT_BROWSER_TOOLS,
      actionBudget: 25,
      timeoutMs: 180_000,
      reportPortId: 'report',
    });
  });

  it('keeps unverifiable interactive ref tools out of the default authority', () => {
    expect(DEFAULT_BROWSER_TOOLS).toEqual([
      'browser_navigate',
      'browser_snapshot',
      'browser_wait_for',
      'browser_take_screenshot',
    ]);
  });

  it('compiles bounded headless Codex plus MCP configuration to a generic process', () => {
    const block = compileComputerUseBlock(config());

    expect(block.kind).toBe('process');
    expect(block.invocation.executable).toBe('codex');
    expect(block.invocation.shell).toBe(false);
    expect(block.invocation.timeoutMs).toBe(180_000);
    expect(block.outputs.map((output) => output.artifactKind)).toEqual([
      'json',
      'filesystem-reference',
      'filesystem-reference',
    ]);

    const args = block.invocation.arguments.map((argument) =>
      argument.type === 'literal' ? argument.value : '<dynamic>',
    );
    expect(args).toContain('exec');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('read-only');
    expect(args).toContain('features.shell_tool=false');
    expect(args).toContain('web_search="disabled"');
    expect(args).toContain('mcp_servers.node_repl.enabled=false');
    expect(args).toContain('mcp_servers.browser.required=true');
    expect(args).toContain(
      'mcp_servers.browser.default_tools_approval_mode="approve"',
    );
    expect(args).toContain(
      'mcp_servers.browser.enabled_tools=["browser_navigate","browser_snapshot","browser_click","browser_take_screenshot"]',
    );
    expect(args).toContain('mcp_servers.browser.command="node"');
    expect(args).toContain(
      'mcp_servers.browser.args=["./dist/mcp-policy-proxy.js","--config","./browser-policy.json","--allowed-origin","https://www.tradingview.com","--allowed-tool","browser_navigate","--allowed-tool","browser_snapshot","--allowed-tool","browser_click","--allowed-tool","browser_take_screenshot","--max-actions","25"]',
    );
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args).toContain('./chart-report.schema.json');
    expect(args).toContain('./spx-chart-report.json');
    expect(args.at(-1)).toContain(
      'Allowed origins: https://www.tradingview.com',
    );
    expect(args.at(-1)).toContain('Configured subject: SPX');
    expect(args.at(-1)).toContain('Configured venue: SP');
    expect(args.at(-1)).toContain('Configured timeframe: 4h');
    expect(args.at(-1)).toContain('Required indicators: RSI, Volume');
    expect(args.at(-1)).toContain('Maximum browser actions: 25');
    expect(args.at(-1)).toContain('Evidence screenshot path: ./spx-chart.png');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('stores and restores explicit editor presentation without changing engine semantics', () => {
    const value = config();
    const block = compileComputerUseBlock(value);
    const workflow = setComputerUseBlockPresentation(
      { ...createWorkflow(), blocks: [block] },
      block.id,
      value,
    );

    expect(getComputerUseBlockPresentation(workflow, block.id)).toEqual({
      kind: 'computer-use',
      config: value,
    });
    expect(
      getComputerUseBlockMetadataIssue(workflow, block.id),
    ).toBeUndefined();
  });

  it('rejects an unallowed start origin and an empty tool surface', () => {
    expect(() =>
      compileComputerUseBlock({
        ...config(),
        startUrl: 'https://evil.example/chart',
      }),
    ).toThrow('must match an allowed origin');
    expect(() =>
      compileComputerUseBlock({ ...config(), allowedTools: [] }),
    ).toThrow('at least one allowed MCP tool');
    expect(() =>
      compileComputerUseBlock({
        ...config(),
        startUrl: 'http://www.tradingview.com/chart/',
        allowedOrigins: ['http://www.tradingview.com'],
      }),
    ).toThrow('must use HTTPS');
    expect(() =>
      compileComputerUseBlock({
        ...config(),
        startUrl: 'https://user:secret@www.tradingview.com/chart/',
      }),
    ).toThrow('must not embed credentials');
  });

  it('rejects ambiguous output identities and malformed authority entries', () => {
    expect(() =>
      compileComputerUseBlock({ ...config(), reportPortId: 'screenshot' }),
    ).toThrow('reserved filesystem output ID');
    expect(() =>
      compileComputerUseBlock({
        ...config(),
        allowedTools: ['browser_snapshot', 'browser snapshot'],
      }),
    ).toThrow('portable identifiers');
    expect(() =>
      compileComputerUseBlock({
        ...config(),
        screenshotPath: './spx-chart-report.json',
      }),
    ).toThrow('paths must be different');
  });
});

function config(): ComputerUseBlockConfig {
  return {
    id: 'tradingview-spx',
    name: 'TradingView · SPX',
    target: 'tradingview',
    subject: 'SPX',
    venue: 'SP',
    timeframe: '4h',
    requiredIndicators: ['RSI', 'Volume'],
    instruction: defaultComputerUseInstruction('tradingview'),
    startUrl: 'https://www.tradingview.com/chart/',
    allowedOrigins: ['https://www.tradingview.com'],
    codexProfile: 'vorchestra-browser',
    mcpServer: 'browser',
    mcpPolicyProxyScript: './dist/mcp-policy-proxy.js',
    mcpPolicyManifestPath: './browser-policy.json',
    allowedTools: [
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
      'browser_take_screenshot',
    ],
    actionBudget: 25,
    timeoutMs: 180_000,
    model: 'configured/high-intelligence',
    reasoningEffort: 'high',
    outputSchemaPath: './chart-report.schema.json',
    reportPath: './spx-chart-report.json',
    screenshotPath: './spx-chart.png',
    reportPortId: 'report',
    reportPortName: 'SPX chart report',
  };
}
