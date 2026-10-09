import { tagSchemaId } from "@open-intelligent-ui/core";
import { z } from "zod/v4";
import { slot } from "../define";
import { cssString } from "./safety";
import { BACKGROUNDS, FOREGROUNDS, SIZES } from "./style";

export { cssString, imageUrl, linkUrl } from "./safety";

export const cssLength = z.union([z.number(), cssString]);
export const children = slot().optional();
export const textColor = z.union([z.enum(FOREGROUNDS), cssString]);
export const size = z.enum(SIZES);
// Named so the prompt prints each palette once.
tagSchemaId(textColor, "Color");
tagSchemaId(size, "Size");
export const controlSize = z.enum(["xs", "sm", "md", "lg"]);
export const optionValue = z.union([z.string(), z.number()]);
export const option = z.object({
  label: z.string(),
  value: optionValue,
  disabled: z.boolean().optional(),
});
export const options = z.array(z.union([option, z.string()]));

export const layoutProps = {
  gap: cssLength.optional(),
  padding: z
    .union([
      cssLength,
      z.object({
        x: z.number().optional(),
        y: z.number().optional(),
        top: z.number().optional(),
        right: z.number().optional(),
        bottom: z.number().optional(),
        left: z.number().optional(),
      }),
    ])
    .optional(),
  margin: cssLength.optional(),
  radius: z.union([z.enum([...SIZES, "full", "none"]), z.number()]).optional(),
  background: z.union([z.enum(BACKGROUNDS), cssString]).optional(),
  border: z
    .union([
      z.boolean(),
      cssString,
      z.object({
        size: z.number().optional(),
        style: cssString.optional(),
        color: cssString.optional(),
      }),
    ])
    .optional(),
  align: z.enum(["start", "center", "end", "stretch", "baseline"]).optional(),
  justify: z.enum(["start", "center", "end", "between", "around", "evenly"]).optional(),
  wrap: z.union([z.boolean(), z.literal("wrap")]).optional(),
  flex: z.union([z.number(), cssString, z.boolean()]).optional(),
  width: cssLength.optional(),
  height: cssLength.optional(),
  minWidth: cssLength.optional(),
  maxWidth: cssLength.optional(),
  clip: z.boolean().optional(),
  shadow: z.boolean().optional(),
  color: textColor.optional(),
  children,
};

export const textProps = {
  color: textColor.optional(),
  size: z.union([size, z.number()]).optional(),
  weight: z.enum(["normal", "medium", "semibold", "bold"]).optional(),
  align: z.enum(["start", "center", "end", "left", "right"]).optional(),
  tabularNums: z.boolean().optional(),
  lineThrough: z.boolean().optional(),
  italic: z.boolean().optional(),
  truncate: z.boolean().optional(),
  children,
};
