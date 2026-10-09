import { callback } from "@open-intelligent-ui/core";
import { createContext, useContext, useId, type ReactNode } from "react";
import { z } from "zod/v4";
import { defineComponent } from "../define";
import { useOptimisticValue } from "../useOptimisticValue";
import { children, controlSize, optionValue, options } from "./schemas";
import { cx } from "./style";

type Option = z.infer<typeof options>[number];
type OptionValue = z.infer<typeof optionValue>;
const toOption = (o: Option) => (typeof o === "string" ? { label: o, value: o } : o);
const same = (a: OptionValue | undefined, b: OptionValue) =>
  a !== undefined && String(a) === String(b);
const sameText = (sent: string | number, received: string | number) =>
  String(sent) === String(received);
// A number field's `""` comes back from the program as `0`.
const sameNumber = (sent: string | number, received: string | number) =>
  sameText(sent, received) || Number(sent) === Number(received);

export const Button = defineComponent({
  name: "button",
  props: z.object({
    variant: z.enum(["solid", "soft", "outline", "ghost"]).optional(),
    color: z.enum(["primary", "secondary", "danger", "success"]).optional(),
    size: controlSize.optional(),
    block: z.boolean().optional(),
    square: z.boolean().optional(),
    disabled: z.boolean().optional(),
    loading: z.boolean().optional(),
    submit: z.boolean().optional(),
    label: z.string().optional(),
    onClick: callback().optional(),
    children,
  }),
  description:
    "Button. `submit` makes it submit the surrounding form. With children (an icon), `label` is only read aloud. `square` makes a square tile for game boards.",
  component: ({ props, children, className }) => (
    <button
      type={props.submit ? "submit" : "button"}
      className={cx(
        "oui-button",
        `oui-btn-${props.variant ?? "solid"}`,
        `oui-btn-${props.color ?? "primary"}`,
        `oui-size-${props.size ?? "md"}`,
        props.block && "oui-block",
        props.square && "oui-square",
        className,
      )}
      aria-label={children ? props.label : undefined}
      disabled={props.disabled || props.loading}
      onClick={props.submit ? undefined : () => props.onClick?.()}
    >
      {children ?? props.label}
    </button>
  ),
});

// Read aloud as the control's name; the visible label is usually text next to it.
const label = z.string().optional();

const inputProps = {
  label,
  value: z.union([z.string(), z.number()]).optional(),
  placeholder: z.string().optional(),
  disabled: z.boolean().optional(),
  onChange: callback({ params: "value: string" }).optional(),
};

export const Input = defineComponent({
  name: "input",
  props: z.object({
    ...inputProps,
    inputType: z
      .enum([
        "text",
        "number",
        "email",
        "password",
        "tel",
        "url",
        "search",
        "date",
        "time",
        "month",
      ])
      .optional(),
    size: controlSize.optional(),
    onSubmit: callback().optional(),
  }),
  description: "Single-line text field. Number fields still pass strings to onChange.",
  component: function InputField({ props, className }) {
    const [value, setValue] = useOptimisticValue(
      props.value,
      props.onChange,
      props.inputType === "number" ? sameNumber : sameText,
    );
    return (
      <input
        className={cx("oui-input", `oui-size-${props.size ?? "md"}`, className)}
        type={props.inputType ?? "text"}
        aria-label={props.label}
        value={value ?? ""}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) props.onSubmit?.();
        }}
      />
    );
  },
});

export const Textarea = defineComponent({
  name: "textarea",
  props: z.object({ ...inputProps, rows: z.number().optional() }),
  description: "Multi-line text field.",
  component: function TextareaField({ props, className }) {
    const [value, setValue] = useOptimisticValue(props.value, props.onChange, sameText);
    return (
      <textarea
        className={cx("oui-input", className)}
        rows={props.rows ?? 3}
        aria-label={props.label}
        value={value ?? ""}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  },
});

export const Select = defineComponent({
  name: "select",
  props: z.object({
    options,
    value: optionValue.optional(),
    placeholder: z.string().optional(),
    size: controlSize.optional(),
    disabled: z.boolean().optional(),
    label,
    onChange: callback({ params: "value: string | number" }).optional(),
  }),
  description: "Dropdown. Use only for long option lists.",
  component: function SelectField({ props, className }) {
    const [value, setValue] = useOptimisticValue(props.value, props.onChange);
    const choices = props.options.map(toOption);
    return (
      <select
        className={cx("oui-input", "oui-select", `oui-size-${props.size ?? "md"}`, className)}
        aria-label={props.label}
        value={value === undefined ? "" : String(value)}
        disabled={props.disabled}
        onChange={(e) => {
          setValue(choices.find((o) => String(o.value) === e.target.value)?.value ?? "");
        }}
      >
        {props.placeholder && <option value="">{props.placeholder}</option>}
        {choices.map((o, i) => (
          <option key={i} value={String(o.value)} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    );
  },
});

export const SegmentedControl = defineComponent({
  name: "segmented-control",
  props: z.object({
    options,
    value: optionValue.optional(),
    block: z.boolean().optional(),
    label,
    onChange: callback({ params: "value: string | number" }).optional(),
  }),
  description: "Row of mutually exclusive options; up to 4 short labels.",
  component: function SegmentedField({ props, className }) {
    const [value, setValue] = useOptimisticValue(props.value, props.onChange);
    return (
      <div
        className={cx("oui-segmented", props.block && "oui-block", className)}
        role="group"
        aria-label={props.label}
      >
        {props.options.map(toOption).map((o, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={same(value, o.value)}
            className={same(value, o.value) ? "oui-on" : undefined}
            onClick={() => setValue(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  },
});

const RadioContext = createContext<{
  name?: string;
  value?: OptionValue;
  onChange?: (value: OptionValue) => void;
}>({});

function RadioOption({
  value,
  label,
  disabled,
  className,
}: {
  value: OptionValue;
  label: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const group = useContext(RadioContext);
  return (
    <label className={cx("oui-checkbox", className)}>
      <input
        type="radio"
        name={group.name}
        checked={same(group.value, value)}
        disabled={disabled}
        onChange={() => group.onChange?.(value)}
      />
      {label}
    </label>
  );
}

export const RadioGroup = defineComponent({
  name: "radio-group",
  props: z.object({
    options: options.optional(),
    value: optionValue.optional(),
    direction: z.enum(["row", "col"]).optional(),
    label,
    onChange: callback({ params: "value: string | number" }).optional(),
    children,
  }),
  description: "Single choice with every option visible: `options`, or `radio` children.",
  component: function RadioGroupField({ props, children, className }) {
    const [value, onChange] = useOptimisticValue(props.value, props.onChange);
    const name = useId();
    return (
      <RadioContext.Provider value={{ name, value, onChange }}>
        <div
          className={cx("oui-radio-group", className)}
          role="radiogroup"
          aria-label={props.label}
          style={{ flexDirection: props.direction === "row" ? "row" : "column" }}
        >
          {props.options
            ? props.options
                .map(toOption)
                .map((o, i) => (
                  <RadioOption key={i} value={o.value} label={o.label} disabled={o.disabled} />
                ))
            : children}
        </div>
      </RadioContext.Provider>
    );
  },
});

export const Radio = defineComponent({
  name: "radio",
  props: z.object({
    value: optionValue,
    label: z.string().optional(),
    disabled: z.boolean().optional(),
    children,
  }),
  description: "Option inside a radio-group.",
  component: ({ props, children, className }) => (
    <RadioOption
      value={props.value}
      label={props.label ?? children ?? props.value}
      disabled={props.disabled}
      className={className}
    />
  ),
});

export const Slider = defineComponent({
  name: "slider",
  props: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    value: z.number().optional(),
    disabled: z.boolean().optional(),
    label,
    onChange: callback({ params: "value: number" }).optional(),
  }),
  description: "Numeric slider (min defaults to 0, max to 100).",
  component: function SliderField({ props, className }) {
    const [value, setValue] = useOptimisticValue(props.value, props.onChange);
    return (
      <input
        className={cx("oui-slider", className)}
        type="range"
        aria-label={props.label}
        min={props.min ?? 0}
        max={props.max ?? 100}
        step={props.step ?? 1}
        value={value ?? props.min ?? 0}
        disabled={props.disabled}
        onChange={(e) => setValue(Number(e.target.value))}
      />
    );
  },
});

export const Checkbox = defineComponent({
  name: "checkbox",
  props: z.object({
    checked: z.boolean().optional(),
    label: z.string().optional(),
    disabled: z.boolean().optional(),
    onChange: callback({ params: "checked: boolean" }).optional(),
    children,
  }),
  description: "Checkbox with an optional label.",
  component: function CheckboxField({ props, children, className }) {
    const [checked, setChecked] = useOptimisticValue(props.checked, props.onChange);
    return (
      <label className={cx("oui-checkbox", className)}>
        <input
          type="checkbox"
          checked={!!checked}
          disabled={props.disabled}
          onChange={(e) => setChecked(e.target.checked)}
        />
        {props.label ?? children}
      </label>
    );
  },
});

export const DatePicker = defineComponent({
  name: "date-picker",
  props: z.object({
    value: z.string().optional(),
    label,
    onChange: callback({ params: "date: string" }).optional(),
  }),
  description: "Date field with ISO `yyyy-mm-dd` values.",
  component: function DateField({ props, className }) {
    const [value, setValue] = useOptimisticValue(props.value, props.onChange);
    return (
      <input
        className={cx("oui-input", className)}
        type="date"
        aria-label={props.label}
        value={value ?? ""}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  },
});
