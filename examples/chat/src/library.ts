import {
  builtinComponents,
  builtinGroups,
  createLibrary,
  type PromptOptions,
} from "@open-intelligent-ui/react";
import { stateNoteRule } from "@open-intelligent-ui/react/chat";
import { travelComponents } from "./travel/components";

export const library = createLibrary({
  components: [...builtinComponents, ...travelComponents],
  componentGroups: [
    ...builtinGroups,
    {
      name: "Travel",
      components: travelComponents.map((c) => c.name),
      notes: [
        "- In a Stop, wikiTitle is the exact English Wikipedia title (it supplies photos), lat and lng are real coordinates, and note is one short sentence.",
      ],
    },
  ],
});

const tripExample = `Here's a relaxed walking day in **San Francisco**, from the Ferry Building up to Fisherman's Wharf.

<photo-strip places={["San Francisco Ferry Building", "Coit Tower", "Lombard Street (San Francisco)"]}/>
## Your route
<route-map stops={stops}/>
<itinerary stops={stops}/>
{@body const stops = [
{name: "Ferry Building", wikiTitle: "San Francisco Ferry Building", lat: 37.7955, lng: -122.3937, time: "9:00", category: "Food", note: "Coffee and pastries in the marketplace hall."},
{name: "Coit Tower", wikiTitle: "Coit Tower", lat: 37.8024, lng: -122.4058, time: "10:30", category: "Views", note: "Climb Telegraph Hill for bay views and murals."},
{name: "Washington Square", wikiTitle: "Washington Square (San Francisco)", lat: 37.8008, lng: -122.4101, time: "11:30", category: "Parks", note: "A lawn in the heart of North Beach."},
{name: "Lombard Street", wikiTitle: "Lombard Street (San Francisco)", lat: 37.8021, lng: -122.4187, time: "12:30", category: "Landmarks", note: "The crooked block."},
{name: "Fisherman's Wharf", wikiTitle: "Fisherman's Wharf, San Francisco", lat: 37.808, lng: -122.4177, time: "14:00", category: "Food", note: "Chowder by the water."},
]}
## Add a stop
<suggestions stops={extra}/>
{@body const extra = [
{name: "Palace of Fine Arts", wikiTitle: "Palace of Fine Arts", lat: 37.8029, lng: -122.4484, category: "Landmarks", note: "A Roman rotunda by a lagoon."},
{name: "Pier 39", wikiTitle: "Pier 39", lat: 37.8087, lng: -122.4098, category: "Landmarks", note: "Sea lions on the docks."},
{name: "Ghirardelli Square", wikiTitle: "Ghirardelli Square", lat: 37.8059, lng: -122.4229, category: "Food", note: "Chocolate in an old factory."},
]}
## Customize your route
{@body const [pace, setPace] = useState("relaxed")}
<radio-group value={pace} onChange={setPace} options={["relaxed", "packed"]}/>
<button onClick={() => action("sendMessage", "Replan my day at a " + pace + " pace")}>Update my route</button>`;

const promptOptions: PromptOptions = {
  examples: [tripExample],
  actions: [
    {
      name: "sendMessage",
      params: "text: string",
      description: "sends the text as the user's next message",
    },
  ],
  additionalRules: [
    "Answers are read on a phone: keep tables to 3 short columns and avoid wide rows.",
    "For a trip or a day out: one or two sentences, a photo-strip, the route-map and itinerary with 5 to 7 stops in a sensible walking order, 2 or 3 suggestions, and a short customize form that sends the choices with sendMessage.",
    stateNoteRule,
    "Build tools a person would keep using: inputs with sensible defaults, a summary that reacts (stat tiles, a progress bar or a chart), and a one-line takeaway with numbers from the current state. Compute every number from state.",
    "For games, keep score and offer a New game button.",
    'A tile game uses `<grid columns={4} gap={2} maxWidth={360}>`: face-down tiles are `variant="solid"` showing "?", face-up ones `variant="outline"` with the symbol, matched ones `color="success"`.',
  ],
};

export const systemPrompt = () => library.prompt(promptOptions);
