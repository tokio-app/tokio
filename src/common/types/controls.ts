// What a hotkey, the phone remote and the API can do mid-LIVE. The keys of
// Settings → Shortcuts and the remote's routes follow these names.
export const CONTROL_ACTIONS = [
  "skipSong",
  "stopTts",
  "replayAlert",
  "pause",
] as const;

export type ControlAction = (typeof CONTROL_ACTIONS)[number];

// Main keeps it in memory only, so a restart or a new connect resumes
export interface ControlState {
  paused: boolean;
}
