import { APP_EVENTS } from "@/common/types";
import { createStack } from "@/helper/events";
import { settingsFlushed } from "@/mcp/common";

const events = createStack("system");

// The window's answer to FLUSH_SETTINGS: the saves it had waiting came first
events.push(
  APP_EVENTS.SETTINGS_FLUSHED,
  (_handler, _e, { id }) => {
    settingsFlushed(id);
  },
  { notify: false },
);

export default events;
