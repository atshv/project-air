import type { ComponentPropsWithRef, ReactNode } from "react";

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  readonly variant?: "primary" | "secondary" | "ghost";
  readonly size?: "bar" | "card";
  readonly children: ReactNode;
}

/** Text button; token-only styling (36 px bar / 28 px card target). */
export function Button({ variant = "secondary", size = "bar", children, type = "button", className, ...rest }: ButtonProps) {
  const classes = ["button", `button-${variant}`, `button-${size}`, className ?? ""].filter(Boolean).join(" ");
  return <button {...rest} type={type} className={classes}>{children}</button>;
}
