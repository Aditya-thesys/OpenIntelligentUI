import { z } from "zod/v4";

const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

function protocolOf(value: string): string | null {
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
}

// Relative URLs are rejected: their base would be the host page.
const isSafeLink = (value: string) => LINK_PROTOCOLS.has(protocolOf(value.trim()) ?? "");

const isSafeImage = (value: string) =>
  IMAGE_PROTOCOLS.has(protocolOf(value.trim()) ?? "") || DATA_IMAGE.test(value.trim());

// A model-written style could otherwise fetch any URL from the page: `background="url(...)"`.
const UNSAFE_CSS = /(url|image|image-set|cross-fade|element|expression|paint)\s*\(|@import|\\/i;

export const isSafeCss = (value: string) => !UNSAFE_CSS.test(value);

export const linkUrl = z.string().refine(isSafeLink, "Only http, https and mailto links");
export const imageUrl = z.string().refine(isSafeImage, "Only http, https and data image URLs");
export const cssString = z.string().refine(isSafeCss, "CSS value may not load resources");

// Drops what could load a resource or bypass validation: `style`, `href`s, external `url()`s.
// Only `onClick` is kept: handlers such as `onAnimationStart` fire without a user gesture and
// would let a program call `action()` on its own.
export function svgAttributes(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "style" || /href$/i.test(key) || key === "dangerouslySetInnerHTML") continue;
    if (typeof value === "string" && !isSafeCss(value.replace(/url\(\s*#[\w-]+\s*\)/g, "")))
      continue;
    if (typeof value === "function" ? key !== "onClick" : typeof value === "object") continue;
    out[key] = value;
  }
  return out;
}
