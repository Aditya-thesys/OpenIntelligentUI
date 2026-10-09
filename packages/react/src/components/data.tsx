import { createElement, useState } from "react";
import { z } from "zod/v4";
import { defineComponent } from "../define";
import { ICONS } from "./icons";
import { cssString, imageUrl, svgAttributes } from "./safety";
import { children, cssLength } from "./schemas";
import { cx, length, radius } from "./style";

export const TableCell = defineComponent({
  name: "table-cell",
  props: z.object({ header: z.boolean().optional(), children }),
  description: "Table cell; `header` for a column heading.",
  component: ({ props, children, className }) =>
    props.header ? (
      <th className={className}>{children}</th>
    ) : (
      <td className={className}>{children}</td>
    ),
});

export const TableRow = defineComponent({
  name: "table-row",
  props: z.object({ children }),
  description: "Table row of table-cell elements.",
  component: ({ children, className }) => <tr className={className}>{children}</tr>,
});

export const Table = defineComponent({
  name: "table",
  props: z.object({ children }),
  description: "Table of table-row elements.",
  component: ({ children, className }) => (
    <div className={cx("oui-table-scroll", className)}>
      <table className="oui-table">
        <tbody>{children}</tbody>
      </table>
    </div>
  ),
});

export const Image = defineComponent({
  name: "image",
  props: z.object({
    src: imageUrl,
    alt: z.string().optional(),
    width: cssLength.optional(),
    height: cssLength.optional(),
    radius: z.union([cssString, z.number()]).optional(),
    fit: z.enum(["cover", "contain", "fill", "none"]).optional(),
  }),
  description: "Image.",
  component: function ImageView({ props, className }) {
    const [failed, setFailed] = useState<string | null>(null);
    const style = {
      width: length(props.width) ?? "100%",
      height: length(props.height),
      borderRadius: radius(props.radius),
    };
    // A photo that fails to load keeps its frame as a neutral placeholder when it has a size,
    // and otherwise leaves no empty box behind.
    if (failed === props.src)
      return props.height === undefined ? null : (
        <div
          className={cx("oui-image-missing", className)}
          style={style}
          role="img"
          aria-label={props.alt}
        >
          <svg className="oui-icon" viewBox="0 0 24 24" aria-hidden>
            <path d={ICONS.image} />
          </svg>
        </div>
      );
    return (
      <img
        className={cx("oui-image", className)}
        src={props.src}
        alt={props.alt ?? ""}
        onError={() => setFailed(props.src)}
        style={{ ...style, objectFit: props.fit ?? "cover" }}
      />
    );
  },
});

export const Svg = defineComponent({
  name: "svg",
  props: z.looseObject({ viewBox: z.string().optional(), children }),
  description:
    "SVG drawing; takes SVG attributes and line, polyline, polygon, rect, circle, ellipse, path, g and svg-text children.",
  component: ({ props, children, className }) => (
    <svg
      {...svgAttributes(props)}
      className={className}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
    >
      {children}
    </svg>
  ),
});

/** SVG elements take any attribute; `svgAttributes` drops the unsafe ones. */
const shape = (name: string, { tag = name, nested = false } = {}) =>
  defineComponent({
    name,
    props: nested ? z.looseObject({ children }) : z.looseObject({}),
    description: "",
    component: ({ props, children }) => createElement(tag, svgAttributes(props), children),
  });

export const svgShapes = [
  ...["line", "polyline", "polygon", "circle", "ellipse", "path", "rect"].map((name) =>
    shape(name),
  ),
  shape("g", { nested: true }),
  shape("svg-text", { tag: "text", nested: true }),
];
