import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { SegmentedControl } from './SegmentedControl';

describe('SegmentedControl', () => {
  const options = [
    { value: 'after', label: '変更後 (After)' },
    { value: 'before', label: '変更前 (Before)' },
    { value: 'split', label: '並列比較 (Split)' },
  ] as const;

  it('renders all options and exposes selection via aria-pressed', () => {
    const { getByRole } = render(() => (
      <SegmentedControl
        options={options}
        value="after"
        onChange={() => {}}
        ariaLabel="比較表示モード"
      />
    ));

    expect(getByRole('button', { name: '変更後 (After)' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(getByRole('button', { name: '変更前 (Before)' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(getByRole('button', { name: '並列比較 (Split)' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('calls onChange and updates aria-pressed reactively when clicked', () => {
    const onChange = vi.fn<(value: 'after' | 'before' | 'split') => void>();
    const [selected, setSelected] = createSignal<'after' | 'before' | 'split'>('after');

    const { getByRole } = render(() => (
      <SegmentedControl
        options={options}
        value={selected()}
        onChange={(next) => {
          setSelected(next);
          onChange(next);
        }}
      />
    ));

    const splitBtn = getByRole('button', { name: '並列比較 (Split)' });
    fireEvent.click(splitBtn);

    expect(onChange).toHaveBeenCalledWith('split');
    expect(splitBtn.getAttribute('aria-pressed')).toBe('true');
    expect(getByRole('button', { name: '変更後 (After)' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });
});
