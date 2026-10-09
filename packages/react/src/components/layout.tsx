import { callback } from "@open-intelligent-ui/core";
import { z } from "zod/v4";
import { defineComponent } from "../define";
import { cssString } from "./safety";
import { children, cssLength, layoutProps } from "./schemas";
import { borderColor, cx, layoutStyle, length, space, spacing } from "./style";

const boxProps = z.object({
  direction: z.enum(["row", "col"]).optional(),
  ...layoutProps,
});

function box(name: string, description: string, direction: "row" | "column", className?: string) {
  return defineComponent({
    name,
    // Each component needs its own schema object: names are looked up by schema identity.
    props: boxProps.clone(),
    description,
    component: ({ props, children, className: enter }) => (
      <div
        className={cx("oui-box", `oui-dir-${direction}`, className, enter)}
        style={layoutStyle(props, direction)}
      >
        {children}
      </div>
    ),
  });
}

export const Box = box("box", "Vertical flex container.", "column");
export const Row = box("row", "Horizontal flex container; items are centered vertically.", "row");
export const Card = box("card", "Bordered, padded box.", "column", "oui-card");

export const Grid = defineComponent({
  name: "grid",
  props: z.object({
    columns: z.union([z.number(), cssString]).optional(),
    gap: cssLength.optional(),
    padding: cssLength.optional(),
    maxWidth: cssLength.optional(),
    children,
  }),
  description:
    "Grid with `columns` equal columns (default 2), or a CSS grid-template-columns value.",
  component: ({ props, children, className }) => (
    <div
      className={cx("oui-grid", className)}
      style={{
        display: "grid",
        gridTemplateColumns:
          typeof props.columns === "string"
            ? props.columns
            : `repeat(${props.columns ?? 2}, minmax(0, 1fr))`,
        gap: space(props.gap) ?? "calc(var(--oui-space) * 2)",
        padding: spacing(props.padding),
        maxWidth: length(props.maxWidth),
      }}
    >
      {children}
    </div>
  ),
});

export const GridItem = defineComponent({
  name: "grid-item",
  props: z.object({ span: z.number().optional(), children }),
  description: "Grid cell spanning `span` columns.",
  component: ({ props, children, className }) => (
    <div
      className={className}
      style={{ minWidth: 0, gridColumn: props.span ? `span ${props.span}` : undefined }}
    >
      {children}
    </div>
  ),
});

export const Pressable = defineComponent({
  name: "pressable",
  props: boxProps.extend({ onClick: callback().optional() }),
  description: "Clickable box.",
  component: ({ props, children, className }) => (
    <div
      role="button"
      tabIndex={0}
      className={cx("oui-box", "oui-pressable", className)}
      style={layoutStyle(props, "column")}
      // Clicks and keys meant for a control inside the box stay with that control.
      onClick={(e) => {
        const target = (e.target as Element).closest(
          "button,a,input,select,textarea,label,[role=button]",
        );
        if (target === e.currentTarget) props.onClick?.();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        props.onClick?.();
      }}
    >
      {children}
    </div>
  ),
});

export const Form = defineComponent({
  name: "form",
  props: boxProps.extend({ onSubmit: callback().optional() }),
  description: "Box that calls onSubmit when a submit button is pressed or Enter is typed.",
  component: ({ props, children, className }) => (
    <form
      className={cx("oui-box", className)}
      style={layoutStyle(props, "column")}
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit?.();
      }}
    >
      {children}
    </form>
  ),
});

export const Spacer = defineComponent({
  name: "spacer",
  props: z.object({}),
  description: "Takes the remaining space in a row or box.",
  component: ({ className }) => <div className={className} style={{ flex: 1 }} />,
});

export const Divider = defineComponent({
  name: "divider",
  props: z.object({ color: cssString.optional() }),
  description: "Horizontal rule.",
  component: ({ props, className }) => (
    <hr
      className={cx("oui-divider", className)}
      style={{ borderColor: borderColor(props.color) }}
    />
  ),
});
