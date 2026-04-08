"use client";

import { cn } from "@/lib/cn";

type BadgeColor = "blue" | "green" | "yellow" | "red" | "orange" | "violet" | "neutral";
type BadgeVariant = "default" | "status" | "outline";
type BadgeSize = "sm" | "md";

interface BadgeProps {
  /** `default` = chip (neutral fill). `status` = colored tint + accent text. `outline` = border only. */
  variant?: BadgeVariant;
  /** Color palette — only meaningful for `status` and `outline` variants. */
  color?: BadgeColor;
  size?: BadgeSize;
  /** Use mono font — for IDs, hashes, counts, numeric data. */
  mono?: boolean;
  className?: string;
  children: React.ReactNode;
}

const colorMap: Record<BadgeColor, { bg: string; text: string; border: string }> = {
  blue: {
    bg: "bg-[var(--color-tint-blue)]",
    text: "text-[var(--color-accent-blue)]",
    border: "border-[color-mix(in_srgb,var(--color-accent-blue)_35%,transparent)]",
  },
  green: {
    bg: "bg-[var(--color-tint-green)]",
    text: "text-[var(--color-accent-green)]",
    border: "border-[color-mix(in_srgb,var(--color-accent-green)_35%,transparent)]",
  },
  yellow: {
    bg: "bg-[var(--color-tint-yellow)]",
    text: "text-[var(--color-accent-yellow)]",
    border: "border-[color-mix(in_srgb,var(--color-accent-yellow)_35%,transparent)]",
  },
  red: {
    bg: "bg-[var(--color-tint-red)]",
    text: "text-[var(--color-accent-red)]",
    border: "border-[color-mix(in_srgb,var(--color-accent-red)_35%,transparent)]",
  },
  orange: {
    bg: "bg-[var(--color-tint-orange)]",
    text: "text-[var(--color-accent-orange)]",
    border: "border-[color-mix(in_srgb,var(--color-accent-orange)_35%,transparent)]",
  },
  violet: {
    bg: "bg-[var(--color-tint-violet)]",
    text: "text-[var(--color-accent-violet)]",
    border: "border-[color-mix(in_srgb,var(--color-accent-violet)_35%,transparent)]",
  },
  neutral: {
    bg: "bg-[var(--color-tint-neutral)]",
    text: "text-[var(--color-text-secondary)]",
    border: "border-[var(--color-border-default)]",
  },
};

export function Badge({
  variant = "default",
  color = "neutral",
  size = "sm",
  mono = false,
  className,
  children,
}: BadgeProps) {
  const colors = colorMap[color];
  const isSmall = size === "sm";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold leading-none",
        isSmall ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
        mono && "font-mono tracking-wide",

        // default — neutral chip fill
        variant === "default" && "bg-[var(--color-chip-bg)] text-[var(--color-text-secondary)]",

        // status — colored tint background + accent text
        variant === "status" && `${colors.bg} ${colors.text}`,

        // outline — transparent background + colored border + accent text
        variant === "outline" && `border ${colors.border} ${colors.text}`,

        className,
      )}
    >
      {children}
    </span>
  );
}
