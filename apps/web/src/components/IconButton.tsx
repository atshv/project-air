import type { ButtonHTMLAttributes } from "react";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  readonly iconSrc: string;
  readonly label: string;
  readonly dataLabel: string;
  readonly size?: "bar" | "card";
}

/** Icon button with aria-label/data-label from the message catalogs (no title). */
export function IconButton({ iconSrc, label, dataLabel, size = "bar", type = "button", className, ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} className={["icon-button", `icon-button-${size}`, className ?? ""].filter(Boolean).join(" ")} aria-label={label} data-label={dataLabel}>
      <img className="icon" src={iconSrc} alt="" aria-hidden="true" />
    </button>
  );
}
