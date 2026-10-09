import { callback } from "@open-intelligent-ui/core";
import { useState } from "react";
import { z } from "zod/v4";
import { defineComponent } from "../define";
import { ICONS } from "./icons";
import { linkUrl } from "./safety";
import { children, size, textColor, textProps } from "./schemas";
import { cx, foreground, textSize, textStyle, TITLE_SIZES } from "./style";

export const Text = defineComponent({
  name: "text",
  props: z.object(textProps),
  description: "Paragraph. Markdown `**bold**` works inside.",
  component: ({ props, children, className }) => (
    <div className={cx("oui-text", className)} style={textStyle(props)}>
      {children}
    </div>
  ),
});

const HEADING_LEVEL: Record<string, number> = {
  "4xl": 1,
  "3xl": 1,
  "2xl": 2,
  xl: 2,
  lg: 3,
  md: 3,
};

export const Title = defineComponent({
  name: "title",
  props: z.object({
    ...textProps,
    size: z.enum(TITLE_SIZES).optional(),
  }),
  description: "Heading.",
  component: ({ props, children, className }) => (
    <div
      role="heading"
      aria-level={HEADING_LEVEL[props.size ?? "md"] ?? 4}
      className={cx("oui-title", `oui-title-${props.size ?? "md"}`, className)}
      style={textStyle({ ...props, size: undefined })}
    >
      {children}
    </div>
  ),
});

export const Caption = defineComponent({
  name: "caption",
  props: z.object(textProps),
  description: "Small secondary text.",
  component: ({ props, children, className }) => (
    <span className={cx("oui-caption", className)} style={textStyle(props)}>
      {children}
    </span>
  ),
});

export const Label = defineComponent({
  name: "label",
  props: z.object(textProps),
  description: "Form field label.",
  component: ({ props, children, className }) => (
    <label className={cx("oui-label", className)} style={textStyle(props)}>
      {children}
    </label>
  ),
});

const inline = (name: string, description: string, Tag: "strong" | "em" | "s" | "code") =>
  defineComponent({
    name,
    props: z.object({ children }),
    description,
    component: ({ children, className }) => (
      <Tag className={cx(Tag === "code" && "oui-code", className)}>{children}</Tag>
    ),
  });

// Tags with an empty description are left out of the prompt: compiled Markdown produces them.
export const Bold = inline("bold", "", "strong");
export const Italic = inline("italic", "", "em");
export const Strike = inline("strike", "Struck-through inline text.", "s");
export const Code = inline("code", "", "code");

export const List = defineComponent({
  name: "list",
  props: z.object({ ordered: z.boolean().optional(), start: z.number().optional(), children }),
  description: "",
  component: ({ props, children, className }) =>
    props.ordered ? (
      <ol className={cx("oui-list", className)} start={props.start}>
        {children}
      </ol>
    ) : (
      <ul className={cx("oui-list", className)}>{children}</ul>
    ),
});

export const ListItem = defineComponent({
  name: "list-item",
  props: z.object({ children }),
  description: "",
  component: ({ children, className }) => <li className={className}>{children}</li>,
});

export const CodeBlock = defineComponent({
  name: "code-block",
  props: z.object({ code: z.string(), language: z.string().optional() }),
  description: "",
  component: function CodeBlockView({ props, className }) {
    const [copied, setCopied] = useState(false);
    // Writing fails without permission or focus; the button then just stays "Copy".
    const copy = () =>
      navigator.clipboard
        ?.writeText(props.code)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
        .catch(() => {});
    return (
      <div className={cx("oui-code-block", className)}>
        <div className="oui-code-head">
          <span>{props.language}</span>
          <button type="button" onClick={copy} aria-live="polite">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre>
          <code>{props.code}</code>
        </pre>
      </div>
    );
  },
});

export const Link = defineComponent({
  name: "link",
  props: z.object({ href: linkUrl.optional(), onClick: callback().optional(), children }),
  description: "Link that opens `href` in a new tab, or calls onClick.",
  component: ({ props, children, className }) => {
    const { href, onClick } = props;
    if (onClick)
      return (
        <a
          className={className}
          href={href ?? "#"}
          onClick={(e) => {
            e.preventDefault();
            onClick();
          }}
        >
          {children}
        </a>
      );
    if (!href) return <span className={className}>{children}</span>;
    return (
      <a className={className} href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
});

export const Badge = defineComponent({
  name: "badge",
  props: z.object({
    color: z
      .enum(["secondary", "success", "danger", "warning", "caution", "info", "primary"])
      .optional(),
    label: z.string().optional(),
    children,
  }),
  description: "Small status label.",
  component: ({ props, children, className }) => (
    <span className={cx("oui-badge", `oui-badge-${props.color ?? "secondary"}`, className)}>
      {props.label ?? children}
    </span>
  ),
});

export const Icon = defineComponent({
  name: "icon",
  props: z.object({
    name: z.enum(Object.keys(ICONS) as [string, ...string[]]),
    size: size.optional(),
    color: textColor.optional(),
    label: z.string().optional(),
  }),
  description: "Small line icon; give it a `label` when it means something on its own.",
  component: ({ props, className }) => (
    <svg
      className={cx("oui-icon", className)}
      viewBox="0 0 24 24"
      style={{
        color: foreground(props.color),
        // Icons are 1.15em, so an `md` icon takes the `sm` font size to match `md` text.
        fontSize: textSize(props.size === "md" ? "sm" : props.size),
      }}
      {...(props.label ? { role: "img", "aria-label": props.label } : { "aria-hidden": true })}
    >
      <path d={ICONS[props.name]} />
    </svg>
  ),
});
