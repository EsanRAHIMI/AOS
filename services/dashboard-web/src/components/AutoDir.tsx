import type { CSSProperties, ElementType, ReactNode } from 'react';
import { dirProps } from '@/lib/rtl';

type AutoDirProps = {
  children: ReactNode;
  /** When a plain string is available, direction is resolved from it. */
  text?: string | null;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  title?: string;
};

/**
 * Renders content with the correct writing direction for mixed EN/FA/AR UI.
 * Prefer passing `text` when children are not a plain string.
 */
export function AutoDir({ children, text, as: Tag = 'div', className, style, title }: AutoDirProps) {
  const sample = text ?? (typeof children === 'string' ? children : null);
  return (
    <Tag {...dirProps(sample)} className={className} style={style} title={title} data-auto-dir="">
      {children}
    </Tag>
  );
}
