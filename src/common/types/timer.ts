import { TimerSettings, TimerStatus } from "../schemas";

// The countdown timer's clock right now
export interface TimerState {
  status: TimerStatus;
  // Milliseconds left
  remaining: number;
}

// What main sends the Tools page about the active profile's timer
export interface TimerData {
  settings: TimerSettings;
  state: TimerState;
  // Milliseconds added since the last push, negative when removed, 0 in replies
  added: number;
}
