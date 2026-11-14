import { APP_EVENTS, APP_EVENTS_RESPONSE, VoiceSample } from "@/common/types";
import { engine, failure } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { act, fireEvent, screen, within } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  MockInstance,
  vi,
} from "vitest";
import { CloneVoiceModal } from "./CloneVoiceModal";

const ELEVEN = { ...engine("elevenlabs", "ElevenLabs"), clones: true };
const RECORDED = [7, 8, 9];

const sample = (name: string): VoiceSample => ({
  name,
  data: new Uint8Array([1, 2, 3]),
});

// A MediaRecorder that hands over RECORDED when it stops
class FakeRecorder {
  static made: FakeRecorder[] = [];
  state: RecordingState = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: MediaStream,
    public options: MediaRecorderOptions,
  ) {
    FakeRecorder.made.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(RECORDED)]) });
    this.onstop?.();
  }
}

const CLONE_ID = "00000000-0000-4000-8000-000000000001";

let track: { stop: ReturnType<typeof vi.fn>; addEventListener: () => void };
let gum: MockInstance<MediaDevices["getUserMedia"]>;

beforeEach(() => {
  FakeRecorder.made = [];
  track = { stop: vi.fn(), addEventListener: () => {} };
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a fake
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  gum = vi
    .spyOn(navigator.mediaDevices, "getUserMedia")
    .mockResolvedValue(stream);
  vi.spyOn(crypto, "randomUUID").mockReturnValue(CLONE_ID);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup() {
  const onClose = vi.fn();
  const view = renderWithProviders(
    <CloneVoiceModal engine={ELEVEN} onClose={onClose} />,
  );
  return { ...view, onClose, queue: view.audio.queue("voice-sample") };
}

const dialog = () => within(screen.getByRole("dialog"));
const button = (name: string) => dialog().getByRole("button", { name });
const cloneButton = () => dialog().getAllByRole("button").at(-1)!;
const picked = (...samples: VoiceSample[]) =>
  send(APP_EVENTS_RESPONSE.PICK_VOICE_SAMPLES, { success: true, samples });
const granted = (granted = true) =>
  send(APP_EVENTS_RESPONSE.ASK_MICROPHONE, { success: true, granted });

// Name, a sample and consent: ready to clone
async function fill(user: ReturnType<typeof setup>["user"]) {
  await user.type(dialog().getByPlaceholderText("My voice"), "  Me  ");
  await picked(sample("me.mp3"));
  await user.click(dialog().getByRole("checkbox"));
}

describe("CloneVoiceModal", () => {
  it("names the engine", () => {
    setup();

    expect(
      screen.getByRole("dialog", { name: "Clone a voice" }),
    ).toHaveAccessibleDescription(/^ElevenLabs adds the voice/);
    expect(dialog().getByText("No samples yet.")).toBeInTheDocument();
  });

  it("clones only with a name, a sample and consent", async () => {
    const { user } = setup();
    const clone = button("Clone voice");
    expect(clone).toBeDisabled();

    await user.type(dialog().getByPlaceholderText("My voice"), "   ");
    await picked(sample("me.mp3"));
    await user.click(dialog().getByRole("checkbox"));
    expect(clone).toBeDisabled();

    await user.type(dialog().getByPlaceholderText("My voice"), "Me");
    expect(clone).toBeEnabled();

    await user.click(dialog().getByRole("checkbox"));
    expect(clone).toBeDisabled();
  });

  it("lists the files main read, and removes one", async () => {
    const { user } = setup();

    await user.click(button("Add files"));
    expect(sent(APP_EVENTS.PICK_VOICE_SAMPLES)).toHaveLength(1);

    await picked(sample("a.mp3"), sample("b.wav"));
    // A canceled dialog or a failure adds nothing
    await send(APP_EVENTS_RESPONSE.PICK_VOICE_SAMPLES, { success: true });
    await send(APP_EVENTS_RESPONSE.PICK_VOICE_SAMPLES, failure());

    expect(
      dialog()
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["a.mp3", "b.wav"]);

    const first = within(dialog().getAllByRole("listitem")[0]);
    await user.click(first.getByRole("button", { name: "Remove" }));
    expect(dialog().queryByText("a.mp3")).not.toBeInTheDocument();
  });

  it("plays a sample, one at a time, with its bytes kept", async () => {
    const { user, queue } = setup();
    const a = sample("a.mp3");
    await picked(a, sample("b.mp3"));
    const row = (i: number) => within(dialog().getAllByRole("listitem")[i]);

    await user.click(row(0).getByRole("button", { name: "Play" }));
    expect(queue.enqueue).toHaveBeenCalledWith(a.data, {
      onEnded: expect.any(Function),
    });
    expect(queue.enqueue.mock.calls[0][0]).not.toBe(a.data);
    expect(row(0).getByRole("button", { name: "Stop" })).toBeInTheDocument();

    await user.click(row(1).getByRole("button", { name: "Play" }));
    expect(row(0).getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(row(1).getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("stops playing when it closes", () => {
    const { unmount, queue } = setup();

    unmount();

    expect(queue.stop).toHaveBeenCalled();
  });

  describe("recording", () => {
    it("records the microphone, unprocessed, into a sample", async () => {
      const { user } = setup();

      await user.click(button("Record"));
      expect(sent(APP_EVENTS.ASK_MICROPHONE)).toHaveLength(1);
      expect(gum).not.toHaveBeenCalled();

      await granted();
      await dialog().findByText("0:00 of 3:00");
      expect(gum).toHaveBeenCalledWith({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      expect(FakeRecorder.made[0].options).toEqual({
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 128000,
      });
      // Nothing clones mid-recording
      expect(button("Add files")).toBeDisabled();

      await user.click(button("Stop"));

      expect(await dialog().findByText("Recording 1.webm")).toBeInTheDocument();
      expect(track.stop).toHaveBeenCalled();
      expect(button("Record")).toBeEnabled();

      await user.type(dialog().getByPlaceholderText("My voice"), "Me");
      await user.click(dialog().getByRole("checkbox"));
      await user.click(button("Clone voice"));
      expect(sent(APP_EVENTS.CLONE_VOICE)[0].samples).toEqual([
        { name: "Recording 1.webm", data: new Uint8Array(RECORDED) },
      ]);
    });

    it("stops by itself at 3:00", async () => {
      vi.useFakeTimers();
      setup();

      fireEvent.click(button("Record"));
      await granted();
      await act(async () => {});
      expect(dialog().getByText("0:00 of 3:00")).toBeInTheDocument();

      await act(async () => vi.advanceTimersByTime(65_000));
      expect(dialog().getByText("1:05 of 3:00")).toBeInTheDocument();

      await act(async () => vi.advanceTimersByTime(115_000));
      await act(async () => {});

      expect(FakeRecorder.made[0].state).toBe("inactive");
      expect(track.stop).toHaveBeenCalled();
      expect(dialog().getByText("Recording 1.webm")).toBeInTheDocument();
    });

    it("says the microphone is blocked when main says so", async () => {
      const { user } = setup();

      await user.click(button("Record"));
      await granted(false);

      expect(dialog().getByRole("alert")).toHaveTextContent(
        "Tokio can't use the microphone.",
      );
      expect(gum).not.toHaveBeenCalled();
      expect(button("Record")).toBeEnabled();
    });

    it("says why the microphone didn't open", async () => {
      gum.mockRejectedValue(new DOMException("None", "NotFoundError"));
      const { user } = setup();

      await user.click(button("Record"));
      await granted();

      expect(await dialog().findByRole("alert")).toHaveTextContent(
        "No microphone found.",
      );
    });

    it("lets the microphone go when it closes, keeping nothing", async () => {
      const { user, unmount } = setup();
      await user.click(button("Record"));
      await granted();
      await dialog().findByText("0:00 of 3:00");

      unmount();

      expect(track.stop).toHaveBeenCalled();
      expect(FakeRecorder.made[0].state).toBe("inactive");
    });
  });

  describe("cloning", () => {
    it("sends the voice, and shows it's working", async () => {
      const { user } = setup();
      await fill(user);

      await user.click(button("Clone voice"));

      expect(sent(APP_EVENTS.CLONE_VOICE)).toEqual([
        {
          id: CLONE_ID,
          engine: "elevenlabs",
          name: "Me",
          samples: [sample("me.mp3")],
        },
      ]);
      expect(cloneButton()).toHaveAccessibleName("Loading");
    });

    it("closes once it's cloned", async () => {
      const { user, onClose } = setup();
      await fill(user);
      await user.click(button("Clone voice"));

      await send(APP_EVENTS_RESPONSE.CLONE_VOICE, {
        success: true,
        id: "another",
      });
      expect(onClose).not.toHaveBeenCalled();

      await send(APP_EVENTS_RESPONSE.CLONE_VOICE, {
        success: true,
        id: CLONE_ID,
      });
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("keeps everything when it fails", async () => {
      const { user, onClose } = setup();
      await fill(user);
      await user.click(button("Clone voice"));

      await send(APP_EVENTS_RESPONSE.CLONE_VOICE, {
        ...failure(),
        id: CLONE_ID,
      });

      expect(onClose).not.toHaveBeenCalled();
      expect(button("Clone voice")).toBeEnabled();
      expect(dialog().getByPlaceholderText("My voice")).toHaveValue("  Me  ");
      expect(dialog().getByText("me.mp3")).toBeInTheDocument();
    });
  });

  it("takes up to 10 samples", async () => {
    setup();

    await picked(
      ...Array.from({ length: 12 }, (_, i) => sample(`${i + 1}.mp3`)),
    );

    expect(dialog().getAllByRole("listitem")).toHaveLength(10);
    for (const name of ["Add files", "Record"]) {
      expect(button(name)).toBeDisabled();
      expect(button(name)).toHaveAttribute("title", "Up to 10 samples");
    }
  });
});
