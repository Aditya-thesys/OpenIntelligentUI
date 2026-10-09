import type { CSSProperties } from "react";
import type { z } from "zod/v4";
import { isSafeCss } from "./safety";
import type { layoutProps, textProps } from "./schemas";

export const TITLE_SIZES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"] as const;
export const SIZES = ["3xs", "2xs", ...TITLE_SIZES] as const;
export const FOREGROUNDS = [
  "default",
  "secondary",
  "tertiary",
  "success",
  "danger",
  "caution",
  "warning",
  "info",
  "primary",
  "inverse",
  "disabled",
] as const;
export const BACKGROUNDS = [
  "surface",
  "surface-secondary",
  "surface-tertiary",
  "surface-elevated",
  "success",
  "danger",
  "info",
  "warning",
  "caution",
  "primary",
] as const;
const BORDER_COLORS = ["default", "subtle", "strong"] as const;

const NUMERIC = /^-?\d+(\.\d+)?$/;
const raw = (v: unknown) => (typeof v === "string" && isSafeCss(v) ? v : undefined);
const isNumeric = (v: unknown) =>
  typeof v === "number" || (typeof v === "string" && NUMERIC.test(v));
const includes = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

export const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(" ") || undefined;

export function space(v: unknown): string | undefined {
  if (v === undefined || v === null || v === false) return undefined;
  return isNumeric(v) ? `calc(var(--oui-space) * ${v})` : raw(v);
}

export type Spacing =
  number | string | Partial<Record<"x" | "y" | "top" | "right" | "bottom" | "left", number>>;

export function spacing(v: Spacing | undefined): string | undefined {
  if (v === undefined || typeof v !== "object") return space(v);
  const y = space(v.y ?? 0);
  const x = space(v.x ?? 0);
  return [space(v.top) ?? y, space(v.right) ?? x, space(v.bottom) ?? y, space(v.left) ?? x].join(
    " ",
  );
}

export const length = (v: unknown) =>
  v === undefined || v === null ? undefined : isNumeric(v) ? `${v}px` : raw(v);

export function radius(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (v === "full") return "9999px";
  if (v === "none") return "0";
  if (includes(SIZES, v)) return `var(--oui-radius-${v})`;
  return length(v);
}

export const foreground = (v: unknown) =>
  includes(FOREGROUNDS, v) ? `var(--oui-fg-${v})` : raw(v);

export const background = (v: unknown) =>
  includes(BACKGROUNDS, v) ? `var(--oui-bg-${v})` : raw(v);

export const borderColor = (v: unknown) =>
  includes(BORDER_COLORS, v)
    ? `var(--oui-border-${v})`
    : (foreground(v) ?? "var(--oui-border-default)");

export type Border = boolean | string | { size?: number; style?: string; color?: string };

export function border(v: Border | undefined): string | undefined {
  if (!v) return undefined;
  if (v === true) return "1px solid var(--oui-border-default)";
  if (typeof v === "object")
    return `${v.size ?? 1}px ${v.style ?? "solid"} ${borderColor(v.color)}`;
  return /\s/.test(v) ? raw(v) : `1px solid ${borderColor(v)}`;
}

export const textSize = (v: unknown) => (includes(SIZES, v) ? `var(--oui-text-${v})` : length(v));

const ALIGN: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  stretch: "stretch",
  baseline: "baseline",
};
const JUSTIFY: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
};
const WEIGHT: Record<string, number> = { normal: 400, medium: 500, semibold: 600, bold: 700 };

export type LayoutStyleProps = z.infer<z.ZodObject<typeof layoutProps>> & {
  direction?: "row" | "col";
};

export function layoutStyle(p: LayoutStyleProps, fallback: "row" | "column"): CSSProperties {
  const direction = p.direction === "row" ? "row" : p.direction ? "column" : fallback;
  return {
    display: "flex",
    flexDirection: direction,
    gap: space(p.gap) ?? (fallback === "row" ? "calc(var(--oui-space) * 2)" : undefined),
    padding: spacing(p.padding),
    // A number is space above and below: in a column of answers, side margins only inset a block.
    margin: isNumeric(p.margin) ? `${space(p.margin)} 0` : space(p.margin),
    borderRadius: radius(p.radius),
    background: background(p.background),
    border: border(p.border),
    alignItems: (p.align && ALIGN[p.align]) ?? (fallback === "row" ? "center" : undefined),
    justifyContent: p.justify && JUSTIFY[p.justify],
    flexWrap: p.wrap ? "wrap" : undefined,
    flex:
      p.flex === true
        ? "1 1 0%"
        : p.flex !== undefined && p.flex !== false
          ? String(p.flex)
          : undefined,
    width: length(p.width),
    height: length(p.height),
    minWidth: length(p.minWidth),
    maxWidth: length(p.maxWidth),
    overflow: p.clip ? "hidden" : undefined,
    boxShadow: p.shadow ? "var(--oui-shadow)" : undefined,
    color: foreground(p.color),
  };
}

export type TextStyleProps = z.infer<z.ZodObject<typeof textProps>>;

export function textStyle(p: TextStyleProps): CSSProperties {
  return {
    color: foreground(p.color),
    fontSize: textSize(p.size),
    fontWeight: p.weight ? WEIGHT[p.weight] : undefined,
    textDecoration: p.lineThrough ? "line-through" : undefined,
    fontVariantNumeric: p.tabularNums ? "tabular-nums" : undefined,
    textAlign: p.align,
    fontStyle: p.italic ? "italic" : undefined,
    overflow: p.truncate ? "hidden" : undefined,
    textOverflow: p.truncate ? "ellipsis" : undefined,
    whiteSpace: p.truncate ? "nowrap" : undefined,
  };
}
