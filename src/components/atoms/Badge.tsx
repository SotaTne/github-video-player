import type { JSX } from '@solidjs/web';

export type BadgeVariant = 'accent' | 'neutral' | 'success' | 'danger';

export interface BadgeProps {
  variant?: BadgeVariant;
  testId?: string;
  children: JSX.Element;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  accent: 'bg-gh-accent-subtle text-gh-accent',
  neutral: 'bg-gh-muted text-gh-fg-muted border border-gh-border',
  success: 'bg-gh-success-subtle text-gh-success',
  danger: 'bg-gh-danger-subtle text-gh-danger',
};

/**
 * GitHub テーマ変数でスタイル付けされたコンパクトなラベルバッジ。
 */
export function Badge(props: BadgeProps) {
  const variant = () => props.variant ?? 'neutral';

  return (
    <span
      data-testid={props.testId}
      class={`inline-flex items-center px-1.5 py-0.5 rounded font-semibold tracking-wide text-[11px] ${VARIANT_CLASSES[variant()]}`}
    >
      {props.children}
    </span>
  );
}
