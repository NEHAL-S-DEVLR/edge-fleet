"use client";

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "danger" | "quiet";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-[#181008] border-accent hover:brightness-110",
  ghost: "bg-transparent text-[#ecebe6] border-line hover:bg-surface2",
  danger: "bg-transparent text-bad border-bad/50 hover:bg-bad/10",
  quiet: "bg-surface2 text-[#aeab9f] border-line hover:text-[#ecebe6]",
};

export function Button({
  variant = "ghost",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`font-mono text-[11px] uppercase tracking-wide px-3 py-1.5 rounded-sm border transition disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
