import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../cn';
import { AppLink } from './AppLink';

type Variant = 'primary' | 'secondary';
type Size = 'lg' | 'md' | 'sm';

const base =
  'inline-flex select-none items-center justify-center gap-2.5 whitespace-nowrap rounded-control transition-[border-color,opacity,background-color] duration-(--dur-fast) ease-signal active:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-38 aria-disabled:pointer-events-none aria-disabled:opacity-38';

const variants: Record<Variant, string> = {
  // The accent's first allowed place: the primary button (design rule 1).
  primary: 'bg-accent text-accent-contrast font-display text-16 hover:opacity-90',
  secondary: 'border border-border text-text font-medium text-14.5 hover:border-text',
};

const sizes: Record<Size, string> = {
  lg: 'h-13 px-6',
  md: 'h-11 px-5',
  sm: 'h-9 px-3.5 text-14',
};

interface Common {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export type ButtonProps = Common & ComponentProps<'button'>;

export function Button({
  variant = 'secondary',
  size = 'lg',
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export type ButtonLinkProps = Common & Omit<ComponentProps<'a'>, 'href'> & { href: string };

export function ButtonLink({
  variant = 'secondary',
  size = 'lg',
  icon,
  className,
  children,
  href,
  ...rest
}: ButtonLinkProps) {
  return (
    <AppLink href={href} className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {icon}
      {children}
    </AppLink>
  );
}
