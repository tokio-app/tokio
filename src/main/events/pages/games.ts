import { APP_EVENTS } from "@/common/types";
import { createStack } from "@/helper/events";

const events = createStack("games");

// Placeholders until the Games handlers land, as every event needs one
// (events/index.test.ts).
events.push(APP_EVENTS.GET_GAMES, () => {}, { notify: false });
events.push(APP_EVENTS.SET_GAMES_SETTINGS, () => {}, { notify: false });
events.push(APP_EVENTS.UPDATE_GAMES_SETTINGS, () => {}, { notify: false });
events.push(APP_EVENTS.TEST_GAME_ACTION, () => {}, { notify: false });

export default events;
