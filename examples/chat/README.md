# Chat

A chat app built on OpenUI's `AgentInterface`, with assistant answers rendered through `Renderer`, plus small scroll, layout and thread-storage fixes in `src/main.tsx`, `src/threads.ts` and `index.html`. The starters show a sightseeing route with photos, a map, an editable itinerary and suggestions, and three interactive answers built from the built-in components.

```bash
cp ../../.env.example ../../.env.local   # add OPENROUTER_API_KEY
pnpm install
pnpm --filter example-chat dev          # http://localhost:5391
```

The `/api` routes are Vite dev-server middleware, so the example runs with `dev` only; `build` just checks that it bundles.

| File                    | Purpose                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`          | The page: `AgentInterface` with starters, and the answer component.                                                                   |
| `src/library.ts`        | The component library and the prompt options (one example answer, a few rules).                                                       |
| `src/travel/`           | `photo-strip`, `route-map`, `itinerary` and `suggestions`, defined with `defineComponent`.                                            |
| `server/model-proxy.ts` | `/api/chat`: streams completions from OpenRouter with the system prompt generated from `src/library.ts`; the key stays on the server. |
| `server/places.ts`      | `/api/places`: photos of a Wikipedia article (or nearby photos when lat and lng are given), cached.                                   |
| `server/directions.ts`  | `/api/directions`: a walking route between stops from OSRM, cached. When it is unavailable the map draws labelled straight lines.     |

Route edits (removed stops, added suggestions) are kept with `useStateField`. `createChatBridge` from `@open-intelligent-ui/react/chat` records each answer's state and sends it back with that answer on the next turn, so a follow-up such as "make it shorter" keeps the user's changes. The server sends the model the last 20 messages (`maxHistory` in `server/model-proxy.ts`), so answers older than that, and their state, drop out of the conversation. Threads and answer state live in memory, so a reload starts over.

In development, react-lang mounts OpenUI's Inspect widget, which reads OpenUI Lang answers only and covers the send button on a phone. `index.html` presets react-lang's once-per-page mount flag (`Symbol.for("openui.devtools.autoMount")`) to keep it out; this is an internal of react-lang, so remove the line once react-ui can turn the widget off. Production builds never mount it.
