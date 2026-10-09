import { tagSchemaId, useStateField } from "@open-intelligent-ui/react";
import { z } from "zod/v4";

export const stop = z.object({
  name: z.string(),
  wikiTitle: z.string(),
  lat: z.number(),
  lng: z.number(),
  time: z.string().optional(),
  category: z.string().optional(),
  note: z.string().optional(),
});
tagSchemaId(stop, "Stop");

export type Stop = z.infer<typeof stop>;

// Edits are shared by one answer's map, itinerary and suggestions, and reach the model next turn.
export function useRoute(stops: Stop[]) {
  const edits = useStateField<{ removed: string[]; added: Stop[] }>("routeEdits", {
    removed: [],
    added: [],
  });
  const { removed, added } = edits.value;
  const all = [...stops, ...added.filter((a) => !stops.some((s) => s.name === a.name))];
  return {
    all,
    active: all.filter((s) => !removed.includes(s.name)),
    isRemoved: (s: Stop) => removed.includes(s.name),
    isAdded: (s: Stop) => added.some((a) => a.name === s.name),
    toggle: (s: Stop) =>
      edits.setValue({
        added,
        removed: removed.includes(s.name)
          ? removed.filter((n) => n !== s.name)
          : [...removed, s.name],
      }),
    add: (s: Stop) => edits.setValue({ removed, added: [...added, s] }),
  };
}
