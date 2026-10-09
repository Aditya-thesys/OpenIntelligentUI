// Path data for the `icon` component, drawn on a 24x24 grid as 2px strokes.
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const check = "M20 6 9 17l-5-5";
const x = "M18 6 6 18M6 6l12 12";
const circleCheck = `${circle(12, 12, 10)}M8.5 12l2.5 2.5 4.5-5`;
const warning =
  "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01";

export const ICONS: Record<string, string> = {
  check,
  "circle-check": circleCheck,
  "check-circle": circleCheck,
  x,
  close: x,
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  "trending-up": "M22 7l-8.5 8.5-5-5L2 17M16 7h6v6",
  "trending-down": "M22 17l-8.5-8.5-5 5L2 7M16 17h6v-6",
  "arrow-right": "M5 12h14M12 5l7 7-7 7",
  "arrow-left": "M19 12H5M12 19l-7-7 7-7",
  "arrow-up": "M12 19V5M5 12l7-7 7 7",
  "arrow-down": "M12 5v14M19 12l-7 7-7-7",
  sparkles:
    "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9ZM19 15v4M17 17h4M5 3v3M3.5 4.5h3",
  star: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2 2 9.3l6.9-1Z",
  info: `${circle(12, 12, 10)}M12 16v-4M12 8h.01`,
  "alert-triangle": warning,
  warning,
  search: `${circle(11, 11, 7)}M21 21l-4.3-4.3`,
  heart:
    "M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z",
  copy: "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2ZM4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2",
  "rotate-ccw": "M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8M3 3v5h5",
  refresh: "M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8M21 3v5h-5",
  calendar:
    "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM16 2v4M8 2v4M3 10h18",
  image: `M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z${circle(9, 9, 2)}M21 15l-5-5L5 21`,
  clock: `${circle(12, 12, 10)}M12 6v6l4 2`,
  settings: `${circle(12, 12, 3)}${circle(12, 12, 7)}M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1`,
};
