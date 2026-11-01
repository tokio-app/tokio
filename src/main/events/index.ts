import { mergeStacks } from "@/helper/events";
import init from "./init";
import about from "./pages/about";
import alerts from "./pages/alerts";
import games from "./pages/games";
import home from "./pages/home";
import lives from "./pages/lives";
import music from "./pages/music";
import overlays from "./pages/overlays";
import settings from "./pages/settings";
import tools from "./pages/tools";
import tts from "./pages/tts";
import updates from "./pages/updates";

export default mergeStacks(
  init,
  settings,
  tts,
  home,
  lives,
  music,
  overlays,
  alerts,
  games,
  tools,
  about,
  updates,
);
