import type { JSX } from '@solidjs/web';

export type ExternalLinkVariant = 'outline' | 'primary';

export interface ExternalLinkProps {
  href: string;
  variant?: ExternalLinkVariant;
  ariaLabel?: string;
  children: JSX.Element;
}

const VARIANT_CLASSES: Record<ExternalLinkVariant, string> = {
  outline:
    'border border-gh-border text-gh-accent px-2 py-1 rounded text-xs no-underline hover:underline',
  primary:
    'bg-gh-accent-bg text-white px-3 py-1.5 rounded text-xs font-medium no-underline hover:opacity-90',
};

/**
 * 新しいタブで安全に開く外部リンク。
 */
export function ExternalLink(props: ExternalLinkProps) {
  const variant = () => props.variant ?? 'outline';

  return (
    <a
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={props.ariaLabel}
      class={`inline-flex items-center justify-center min-h-6 ${VARIANT_CLASSES[variant()]}`}
    >
      {props.children}
    </a>
  );
}
