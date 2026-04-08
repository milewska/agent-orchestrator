"use client";

import { cn } from "@/lib/cn";

type ButtonVariant = "ghost" | "primary" | "danger";
type ButtonSize = "xs" | "sm" | "md";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** `ghost` = subtle border/bg (default). `primary` = accent fill. `danger` = error outline. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Use mono font — for IDs, actions with code-like labels. */
  mono?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  ghost: [
    "border border-[var(--color-border-default)]",
    "bg-[var(--color-bg-subtle)]",
    "text-[var(--color-text-muted)]",
    "hover:border-[var(--color-accent)]",
    "hover:text-[var(--color-accent)]",
  ].join(" "),

  primary: [
    "border border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]",
    "bg-[var(--color-accent-subtle)]",
    "text-[var(--color-accent)]",
    "hover:bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)]",
    "hover:border-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]",
  ].join(" "),

  danger: [
    "border border-[color-mix(in_srgb,var(--color-status-error)_35%,transparent)]",
    "bg-transparent",
    "text-[var(--color-status-error)]",
    "hover:border-[var(--color-status-error)]",
    "hover:bg-[rgba(220,38,38,0.06)]",
  ].join(" "),
};

const sizeClasses: Record<ButtonSize, string> = {
  xs: "px-2 py-0.5 text-[10px] gap-1",
  sm: "px-2 py-1 text-[11px] gap-1.5",
  md: "px-3 py-1.5 text-[13px] gap-2",
};

export function Button({
  variant = "ghost",
  size = "sm",
  mono = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center font-semibold leading-none transition-colors",
        "disabled:pointer-events-none disabled:opacity-40",
        mono && "font-mono tracking-[0.04em]",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
