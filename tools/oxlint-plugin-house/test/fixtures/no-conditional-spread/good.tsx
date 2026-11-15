declare const label: string | undefined;

interface LinkProps {
  href: string;
  title?: string;
}

declare function getFloatingProps(): Record<string, unknown>;

export const forwarded = <input aria-label={label} />;
export const floating = <div {...getFloatingProps()} />;

export function Link({ href, ...rest }: LinkProps) {
  return <a href={href} {...rest} />;
}
