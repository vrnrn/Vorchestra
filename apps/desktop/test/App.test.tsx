import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/src/App';

class TestResizeObserver implements ResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

describe('block configuration ordering', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    Object.defineProperty(window, 'vorchestra', {
      configurable: true,
      value: {
        openWorkflow: vi.fn(),
        saveWorkflow: vi.fn(),
        runWorkflow: vi.fn(),
        cancelRun: vi.fn(),
        onRunEvent: vi.fn(() => () => undefined),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('reorders literal and input-bound arguments from their drag handles', () => {
    const { container, getByText } = render(<App />);
    const argumentsSection = getByText('Arguments').closest('section');
    const inputPortsSection = getByText('Input ports').closest('section');
    expect(argumentsSection).not.toBeNull();
    expect(inputPortsSection).not.toBeNull();

    fireEvent.click(
      within(argumentsSection!).getByRole('button', { name: 'Add' }),
    );
    fireEvent.change(within(argumentsSection!).getByLabelText('Argument 2'), {
      target: { value: 'second' },
    });

    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: vi.fn(),
    };
    const firstHandle = within(argumentsSection!).getByRole('button', {
      name: 'Reorder argument 1',
    });
    const secondRow = within(argumentsSection!)
      .getByLabelText('Argument 2')
      .closest('.argument-row');
    expect(secondRow).not.toBeNull();

    fireEvent.dragStart(firstHandle, { dataTransfer });
    fireEvent.dragEnter(secondRow!, { dataTransfer });
    fireEvent.dragOver(secondRow!, { dataTransfer });
    fireEvent.drop(secondRow!, { dataTransfer });

    expect(
      [
        ...container.querySelectorAll<HTMLInputElement>('.argument-row input'),
      ].map((input) => input.value),
    ).toEqual(['second', 'Hello from Vorchestra\\n']);

    fireEvent.click(
      within(inputPortsSection!).getByRole('button', { name: 'Add' }),
    );
    const inputArgumentHandle = within(argumentsSection!).getByRole('button', {
      name: 'Reorder input argument input-1',
    });
    fireEvent.keyDown(inputArgumentHandle, { key: 'ArrowUp' });
    fireEvent.keyDown(inputArgumentHandle, { key: 'ArrowUp' });

    expect(container.querySelector('.argument-row')?.textContent).toContain(
      'input:input-1',
    );
  });
});
