import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerUseBlockInspector } from '../src/renderer/src/ComputerUseBlockInspector';
import {
  compileComputerUseBlock,
  createDefaultComputerUseConfig,
} from '../src/shared/computer-use-runtime';

afterEach(cleanup);

describe('Computer Use block editor', () => {
  it('presents bounded authority, controller, outputs, and invocation as named groups', () => {
    const config = createDefaultComputerUseConfig({ id: 'computer-use' });
    const { getByText, queryByRole } = render(
      <ComputerUseBlockInspector
        block={compileComputerUseBlock(config)}
        presentation={{ kind: 'computer-use', config }}
        selectPath={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(getByText('Bounded browser session')).toBeInTheDocument();
    expect(getByText('Read-only')).toBeInTheDocument();
    expect(getByText('Codex controller')).toBeInTheDocument();
    expect(getByText('Declared outputs')).toBeInTheDocument();
    expect(getByText('Effective invocation')).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Choose' })).not.toBeInTheDocument();
  });

  it('applies a coherent target preset rather than isolated field changes', () => {
    const config = createDefaultComputerUseConfig({ id: 'computer-use' });
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <ComputerUseBlockInspector
        block={compileComputerUseBlock(config)}
        presentation={{ kind: 'computer-use', config }}
        selectPath={vi.fn()}
        onChange={onChange}
      />,
    );

    fireEvent.change(getByLabelText('Target preset'), {
      target: { value: 'perplexity-finance' },
    });

    const nextPresentation = onChange.mock.calls.at(-1)?.[1];
    expect(nextPresentation.config).toMatchObject({
      target: 'perplexity-finance',
      startUrl: 'https://www.perplexity.ai/finance',
      allowedOrigins: ['https://www.perplexity.ai'],
      reportPath: './perplexity-finance-report.json',
    });
    expect(nextPresentation.config.instruction).toContain(
      'Open Perplexity Finance',
    );
  });

  it('uses accessible path actions and preserves the selected local path', async () => {
    const config = createDefaultComputerUseConfig({ id: 'computer-use' });
    const onChange = vi.fn();
    const selectPath = vi.fn().mockResolvedValue('/safe/browser-policy.json');
    const { getByLabelText } = render(
      <ComputerUseBlockInspector
        block={compileComputerUseBlock(config)}
        presentation={{ kind: 'computer-use', config }}
        selectPath={selectPath}
        onChange={onChange}
      />,
    );

    fireEvent.click(getByLabelText('Choose browser policy manifest'));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(selectPath).toHaveBeenCalledWith(
      'file',
      './browser-policy.manifest.json',
    );
    expect(onChange.mock.calls.at(-1)?.[1].config.mcpPolicyManifestPath).toBe(
      '/safe/browser-policy.json',
    );
  });
});
