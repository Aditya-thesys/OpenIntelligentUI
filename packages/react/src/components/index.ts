import type { ComponentGroup, DefinedComponent } from "../define";
import { createLibrary } from "../library";
import { Chart } from "./chart";
import {
  Button,
  Checkbox,
  DatePicker,
  Input,
  Radio,
  RadioGroup,
  SegmentedControl,
  Select,
  Slider,
  Textarea,
} from "./controls";
import { Image, Svg, svgShapes, Table, TableCell, TableRow } from "./data";
import { Box, Card, Divider, Form, Grid, GridItem, Pressable, Row, Spacer } from "./layout";
import {
  Badge,
  Bold,
  Caption,
  Code,
  CodeBlock,
  Icon,
  Italic,
  Label,
  Link,
  List,
  ListItem,
  Strike,
  Text,
  Title,
} from "./text";

/** Layout, text, input, data and drawing components. */
export const builtinComponents: DefinedComponent[] = [
  Box,
  Row,
  Card,
  Grid,
  GridItem,
  Pressable,
  Form,
  Spacer,
  Divider,
  Text,
  Title,
  Caption,
  Label,
  Bold,
  Italic,
  Strike,
  Code,
  CodeBlock,
  List,
  ListItem,
  Link,
  Badge,
  Icon,
  Button,
  Input,
  Textarea,
  Select,
  SegmentedControl,
  RadioGroup,
  Radio,
  Slider,
  Checkbox,
  DatePicker,
  Table,
  TableRow,
  TableCell,
  Image,
  Chart,
  Svg,
  ...svgShapes,
] as DefinedComponent[];

export const builtinGroups: ComponentGroup[] = [
  {
    name: "Layout",
    components: [
      "box",
      "row",
      "card",
      "grid",
      "grid-item",
      "pressable",
      "form",
      "divider",
      "spacer",
    ],
    notes: [
      "- Spacing (`gap`, `padding`, `margin`) is in 4px steps: `padding={3}` is 12px. A number `margin` is space above and below.",
      '- A stat tile: `<box background="surface-secondary" radius="lg" padding={3} gap={1}><caption>Label</caption><title size="lg" tabularNums>value</title></box>` inside a 2-column `grid`.',
      '- A labeled field row: `<row gap={3}><box flex={1}><text>Rent</text></box><box width={110}><input inputType="number" label="Rent" value={rent} onChange={setRent}/></box></row>`. Controls take a `label` that is read aloud.',
      '- A progress bar: `<box background="surface-tertiary" radius="full" height="8px" clip><box background="primary" height="100%" width={pct + "%"}/></box>`.',
      '- An editable list row ends with a short remove control: `<button variant="ghost" size="sm" label={"Remove " + item.name}><icon name="x"/></button>`, never a long text button.',
      "- A game board: a `<grid>` of `<button square>` tiles.",
    ],
  },
  {
    name: "Text",
    components: ["text", "title", "caption", "label", "badge", "icon", "link", "strike"],
  },
  {
    name: "Inputs",
    components: [
      "button",
      "input",
      "textarea",
      "select",
      "segmented-control",
      "radio-group",
      "radio",
      "slider",
      "checkbox",
      "date-picker",
    ],
    notes: ["- Inputs hold values the user types; show fixed labels as text."],
  },
  {
    name: "Data",
    components: ["table", "table-row", "table-cell", "image", "chart"],
    notes: [
      '- `<chart type="bar" data={[{month: "Jan", revenue: 120, cost: 80}]} categoryKey="month"/>`. Prefer chart over hand-drawn svg.',
    ],
  },
  {
    name: "Drawing",
    components: ["svg"],
  },
];

/** A library with only the built-in components. */
export const builtinLibrary = createLibrary({
  components: builtinComponents,
  componentGroups: builtinGroups,
});
