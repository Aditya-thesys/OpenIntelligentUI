import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { z } from "zod/v4";
import { defineComponent } from "../define";
import { cx } from "./style";

const CHART_TYPES = ["bar", "line", "area", "pie", "donut"] as const;
const CHART_COLORS = 6;
const DEFAULT_HEIGHT = 220;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 480;
/** Approximate width of one character of an 11px axis label. */
const LABEL_CHAR_PX = 6.5;
// Slanted bar labels: the longest shown in full, and sin of their 35 degree angle.
const SLANT_CHARS = 14;
const SLANT_SIN = 0.574;

type Series = { key: string; label: string };
type ChartSpec = {
  type: (typeof CHART_TYPES)[number];
  rows: Record<string, string | number>[];
  categoryKey: string;
  series: Series[];
  height: number;
  stacked?: boolean;
  format: (v: number, short?: boolean) => string;
};

const describe = (spec: ChartSpec) =>
  `${spec.type} chart of ${spec.series.map((s) => s.label).join(", ")} over ${spec.rows.length} ${spec.categoryKey} values`;

const seriesColor = (i: number) => `var(--oui-chart-${(i % CHART_COLORS) + 1})`;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const niceStep = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
const compact = (v: number) =>
  Math.abs(v) >= 1e6
    ? `${+(v / 1e6).toFixed(1)}M`
    : Math.abs(v) >= 1e3
      ? `${+(v / 1e3).toFixed(1)}k`
      : `${+v.toFixed(2)}`;

const axisLabelStyle: CSSProperties = {
  fontSize: 11,
  fill: "var(--oui-fg-tertiary)",
  fontVariantNumeric: "tabular-nums",
};

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="oui-chart-legend">
      {series.map((s, i) => (
        <span key={s.key}>
          <i style={{ background: seriesColor(i) }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function Cartesian({ spec, width }: { spec: ChartSpec; width: number }) {
  const { rows, series, height, type } = spec;
  const stacked = spec.stacked && type !== "line";
  // Running totals per row, the top edge of each stacked series.
  const levels = rows.map((r) => {
    let total = 0;
    return series.map((s) => (total += Math.max(0, Number(r[s.key]))));
  });
  const values = stacked
    ? levels.map((l) => l[l.length - 1] ?? 0)
    : rows.flatMap((r) => series.map((s) => Number(r[s.key])));
  const step = niceStep((Math.max(0, ...values) - Math.min(0, ...values)) / 4);
  const lo = Math.floor(Math.min(0, ...values) / step) * step;
  const hi = Math.max(lo + step, Math.ceil(Math.max(0, ...values) / step) * step);
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, k) => lo + k * step);
  // Room on the left for the widest value label, so it stays inside the chart's box.
  const tickChars = Math.max(...ticks.map((t) => spec.format(t, true).length));
  const pad = { top: 8, right: 8, bottom: 22, left: Math.ceil(tickChars * LABEL_CHAR_PX) + 8 };
  const w = Math.max(0, width - pad.left - pad.right);
  const band = rows.length ? w / rows.length : w;
  const category = (r: ChartSpec["rows"][number]) => String(r[spec.categoryKey] ?? "");
  // Every bar gets a label, slanted when one is wider than its bar; points on a line get every
  // nth label instead.
  const maxChars = Math.floor((band - 4) / LABEL_CHAR_PX);
  const longest = Math.max(0, ...rows.map((r) => category(r).length));
  const slant = type === "bar" && longest > maxChars;
  const everyBar = type === "bar" && (slant || maxChars >= 4);
  if (slant)
    pad.bottom = Math.ceil(Math.min(longest, SLANT_CHARS) * LABEL_CHAR_PX * SLANT_SIN) + 16;
  const h = Math.max(0, height - pad.top - pad.bottom);
  const y = (v: number) => pad.top + h - ((v - lo) / (hi - lo)) * h;
  const labelWidth = Math.max(44, longest * LABEL_CHAR_PX + 8);
  const labelEvery = everyBar
    ? 1
    : Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(w / labelWidth))));
  // Every nth label, always including the last row, so the axis runs to the end of the data.
  const last = rows.length - 1;
  const labeled = (i: number) => i === last || (i % labelEvery === 0 && last - i >= labelEvery);
  const label = (r: ChartSpec["rows"][number]) => {
    const text = category(r);
    const room = slant ? SLANT_CHARS : maxChars;
    return everyBar && text.length > room ? `${text.slice(0, room - 1)}…` : text;
  };
  const xCenter = (i: number) => pad.left + band * i + band / 2;

  return (
    <svg width={width} height={height} role="img" aria-label={describe(spec)}>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={pad.left}
            x2={pad.left + w}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--oui-border-subtle)"
            strokeDasharray={t === 0 ? undefined : "3 3"}
          />
          <text x={pad.left - 6} y={y(t) + 3.5} textAnchor="end" style={axisLabelStyle}>
            {spec.format(t, true)}
          </text>
        </g>
      ))}
      {rows.map((r, i) =>
        labeled(i) ? (
          <text
            key={i}
            x={xCenter(i)}
            y={slant ? h + pad.top + 12 : height - 6}
            textAnchor={slant ? "end" : "middle"}
            transform={slant ? `rotate(-35 ${xCenter(i)} ${h + pad.top + 12})` : undefined}
            style={axisLabelStyle}
          >
            <title>{category(r)}</title>
            {label(r)}
          </text>
        ) : null,
      )}
      {type === "bar" &&
        rows.map((r, i) => {
          const inner = band * 0.7;
          if (stacked)
            return series.map((s, si) => {
              const top = y(levels[i][si]);
              return (
                <rect
                  key={`${i}-${s.key}`}
                  x={xCenter(i) - inner / 2}
                  y={top}
                  width={inner}
                  height={Math.max(0, y(levels[i][si - 1] ?? 0) - top)}
                  fill={seriesColor(si)}
                  rx={si === series.length - 1 ? 3 : 0}
                >
                  <title>{`${r[spec.categoryKey]}, ${s.label}: ${spec.format(Number(r[s.key]))}`}</title>
                </rect>
              );
            });
          const bw = inner / series.length;
          return series.map((s, si) => {
            const v = Number(r[s.key]);
            return (
              <rect
                key={`${i}-${s.key}`}
                x={xCenter(i) - inner / 2 + bw * si + 1}
                y={Math.min(y(v), y(0))}
                width={Math.max(1, bw - 2)}
                height={Math.abs(y(0) - y(v))}
                rx={3}
                fill={seriesColor(si)}
              >
                <title>{`${r[spec.categoryKey]}: ${spec.format(v)}`}</title>
              </rect>
            );
          });
        })}
      {(type === "line" || type === "area") &&
        series.map((s, si) => {
          const top = (i: number) => (stacked ? levels[i][si] : Number(rows[i][s.key]));
          const base = (i: number) => (stacked ? (levels[i][si - 1] ?? 0) : 0);
          const pts = rows.map((_, i) => [xCenter(i), y(top(i))] as const);
          const d = pts
            .map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`)
            .join("");
          const under = rows
            .map((_, i) => `L${xCenter(i).toFixed(1)},${y(base(i)).toFixed(1)}`)
            .reverse()
            .join("");
          return (
            <g key={s.key}>
              {type === "area" && pts.length > 1 && (
                <path d={`${d}${under}Z`} fill={seriesColor(si)} opacity={stacked ? 0.3 : 0.14} />
              )}
              <path
                d={d}
                fill="none"
                stroke={seriesColor(si)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.length <= 24 &&
                pts.map(([px, py], i) => (
                  <circle key={i} cx={px} cy={py} r={2.5} fill={seriesColor(si)}>
                    <title>{`${rows[i][spec.categoryKey]}: ${spec.format(Number(rows[i][s.key]))}`}</title>
                  </circle>
                ))}
            </g>
          );
        })}
    </svg>
  );
}

function Pie({ spec, width }: { spec: ChartSpec; width: number }) {
  const key = spec.series[0]?.key;
  const items = spec.rows.map((r) => ({
    label: String(r[spec.categoryKey] ?? ""),
    value: Math.max(0, Number(key ? r[key] : 0)),
  }));
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const size = Math.min(spec.height, width, DEFAULT_HEIGHT);
  const r = size / 2;
  const inner = spec.type === "donut" ? r * 0.6 : 0;
  let angle = -Math.PI / 2;
  const arcs = items.map((it, i) => {
    const sweep = (it.value / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const large = sweep > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) =>
      `${(r + rad * Math.cos(a)).toFixed(2)},${(r + rad * Math.sin(a)).toFixed(2)}`;
    const d =
      sweep >= Math.PI * 2 - 1e-6
        ? `M${p(r, 0)}A${r},${r} 0 1 1 ${p(r, Math.PI)}A${r},${r} 0 1 1 ${p(r, 0)}Z`
        : inner
          ? `M${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}L${p(inner, a1)}A${inner},${inner} 0 ${large} 0 ${p(inner, a0)}Z`
          : `M${r},${r}L${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}Z`;
    return (
      <path key={i} d={d} fill={seriesColor(i)} stroke="var(--oui-bg-surface)" strokeWidth={2} />
    );
  });
  return (
    <div className="oui-pie">
      <svg width={size} height={size} role="img" aria-label={describe(spec)}>
        {arcs}
      </svg>
      <div className="oui-pie-legend">
        {items.map((it, i) => (
          <div key={i}>
            <i style={{ background: seriesColor(i) }} />
            <span title={spec.format(it.value)}>{it.label}</span>
            <strong>{`${((it.value / total) * 100).toFixed(it.value / total < 0.1 ? 1 : 0)}%`}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function SvgChart({ spec, className }: { spec: ChartSpec; className?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const pie = spec.type === "pie" || spec.type === "donut";
  return (
    <div
      ref={ref}
      className={cx("oui-chart", className)}
      style={{ minHeight: pie ? undefined : spec.height }}
    >
      {width > 0 &&
        (pie ? <Pie spec={spec} width={width} /> : <Cartesian spec={spec} width={width} />)}
      {!pie && <Legend series={spec.series} />}
    </div>
  );
}

const chartProps = z.object({
  type: z.enum(CHART_TYPES).optional(),
  data: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  categoryKey: z.string().optional(),
  dataKey: z.string().optional(),
  series: z.array(z.object({ key: z.string(), label: z.string().optional() })).optional(),
  stacked: z.boolean().optional(),
  height: z.number().optional(),
  valuePrefix: z.string().optional(),
  valueSuffix: z.string().optional(),
});

function toSpec(props: z.infer<typeof chartProps>): ChartSpec | null {
  const first = props.data[0];
  if (!first) return null;
  const categoryKey =
    props.categoryKey ??
    Object.keys(first).find((k) => typeof first[k] === "string") ??
    Object.keys(first)[0] ??
    "";
  const keys = props.dataKey
    ? [props.dataKey]
    : Object.keys(first).filter((k) => k !== categoryKey && typeof first[k] === "number");
  const series = props.series?.length
    ? props.series.map((s) => ({ key: s.key, label: s.label ?? s.key }))
    : keys.map((k) => ({ key: k, label: k }));
  return {
    type: props.type ?? "bar",
    rows: props.data.map((row) => {
      const out: Record<string, string | number> = {
        [categoryKey]: String(row[categoryKey] ?? ""),
      };
      for (const s of series) out[s.key] = Number(row[s.key]) || 0;
      return out;
    }),
    categoryKey,
    series,
    height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, props.height ?? DEFAULT_HEIGHT)),
    stacked: !!props.stacked,
    format: (v, short) =>
      `${props.valuePrefix ?? ""}${short ? compact(v) : v.toLocaleString()}${props.valueSuffix ?? ""}`,
  };
}

export const Chart = defineComponent({
  name: "chart",
  props: chartProps,
  description:
    "Bar, line, area, pie or donut chart. Every numeric key other than categoryKey becomes a series (pie and donut use `dataKey`); `stacked` stacks bar and area series.",
  component: ({ props, className }) => {
    const spec = toSpec(props);
    return spec ? (
      <SvgChart spec={spec} className={className} />
    ) : (
      <div className={cx("oui-chart", className)} style={{ minHeight: DEFAULT_HEIGHT }} />
    );
  },
});
