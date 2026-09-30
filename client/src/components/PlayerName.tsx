import type { ElementType } from 'react';
import { cx } from '../lib/cx';
import { nameStyleClass } from '../lib/nameStyles';

/**
 * A player's name in their equipped name style. The one place a name style is
 * applied: screens pass the id they got from the server and never pick colours
 * themselves. Unknown ids render as `default`. Purely visual: the text is the
 * real username, untouched.
 *
 * `className` carries the layout (truncate, font, size, base colour); the style
 * class overrides only the colour/fill, so the width never changes.
 */
export function PlayerName({
  name,
  nameStyle,
  className,
  as: Tag = 'span',
  title,
}: {
  name: string;
  nameStyle: string | null | undefined;
  className?: string;
  as?: ElementType;
  title?: string;
}) {
  return (
    <Tag className={cx(nameStyleClass(nameStyle), className)} title={title}>
      {name}
    </Tag>
  );
}
