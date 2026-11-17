import { For } from 'solid-js';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}

/**
 * aria-pressed で選択状態を伝える汎用セグメント切替ボタングループ。
 */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={props.ariaLabel}
      class="inline-flex rounded border border-gh-border overflow-hidden"
    >
      <For each={props.options}>
        {(option) => {
          const isSelected = () => props.value === option.value;
          return (
            <button
              type="button"
              aria-pressed={isSelected() ? 'true' : 'false'}
              onClick={() => props.onChange(option.value)}
              class={`px-2.5 py-1 min-h-6 text-xs cursor-pointer transition-colors ${
                isSelected()
                  ? 'bg-gh-accent-bg text-white font-medium'
                  : 'bg-transparent text-gh-fg hover:bg-gh-muted'
              }`}
            >
              {option.label}
            </button>
          );
        }}
      </For>
    </div>
  );
}
