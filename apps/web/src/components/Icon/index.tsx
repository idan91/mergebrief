import clsx from "clsx";

import { GLYPHS } from "./glyphs";
import styles from "./Icon.module.scss";
import {
  IconRotations,
  IconSizes,
  type IconName,
  type IconRotation,
  type IconSize,
} from "./types";

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** A colour value for the glyph; unset, it inherits `currentColor`. */
  color?: string | undefined;
  rotation?: IconRotation;
  className?: string | undefined;
  /** An accessible name. Unset, the icon is decorative and hidden. */
  label?: string | undefined;
}

/**
 * One drawing from the set at one of three sizes. The meaning belongs to
 * the control or row around it; an icon carries a name only when it stands
 * alone.
 */
export function Icon({
  name,
  size = IconSizes.LG,
  color,
  rotation = IconRotations.NONE,
  className,
  label,
}: IconProps) {
  const Glyph = GLYPHS[name];
  const style = color === undefined ? undefined : { color };

  return (
    <Glyph
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      className={clsx(styles["icon"], className)}
      data-icon={name}
      data-rotation={rotation === IconRotations.NONE ? undefined : rotation}
      focusable="false"
      height={size}
      role={label === undefined ? undefined : "img"}
      style={style}
      width={size}
    />
  );
}
