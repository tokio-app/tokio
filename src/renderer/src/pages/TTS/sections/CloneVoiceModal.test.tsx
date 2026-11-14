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

const ELEVEN = {
  ...engine("elevenlabs", "ElevenLabs"),
  cloning: { samples: 10, minSeconds: 60, maxSeconds: 120 },
};
const INWORLD = {
  ...engine("inworld", "Inworld"),
  cloning: { samples: 1, minSeconds: 10, maxSeconds: 30 },
};
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

// Decodes bytes into a mono buffer of 0.5s, one frame per byte, and fails on
// bytes that start with 0
class FakeContext {
  static decoded: ArrayBuffer[] = [];
  constructor(
    public channels: number,
    public length: number,
    public sampleRate: number,
  ) {}
  decodeAudioData(data: ArrayBuffer) {
    FakeContext.decoded.push(data);
    const bytes = new Uint8Array(data);
    if (bytes[0] === 0)
      return Promise.reject(new DOMException("", "EncodingError"));
    return Promise.resolve({
      sampleRate: this.sampleRate,
      numberOfChannels: 1,
      length: bytes.length,
      getChannelData: () => new Float32Array(bytes.length).fill(0.5),
    });
  }
}

const CLONE_ID = "00000000-0000-4000-8000-000000000001";

let track: { stop: ReturnType<typeof vi.fn>; addEventListener: () => void };
let gum: MockInstance<MediaDevices["getUserMedia"]>;

beforeEach(() => {
  FakeRecorder.made = [];
  track = { stop: vi.fn(), addEventListener: () => {} };
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  FakeContext.decoded = [];
  vi.stubGlobal("OfflineAudioContext", FakeContext);
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

function setup(engines = [ELEVEN]) {
  const onClose = vi.fn();
  const view = renderWithProviders(
    <CloneVoiceModal engines={engines} onClose={onClose} />,
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
      await dialog().findByText("0:00 of 2:00");
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

    it("stops by itself at the engine's longest length", async () => {
      vi.useFakeTimers();
      setup();

      fireEvent.click(button("Record"));
      await granted();
      await act(async () => {});
      expect(dialog().getByText("0:00 of 2:00")).toBeInTheDocument();

      await act(async () => vi.advanceTimersByTime(65_000));
      expect(dialog().getByText("1:05 of 2:00")).toBeInTheDocument();

      await act(async () => vi.advanceTimersByTime(54_000));
      expect(FakeRecorder.made[0].state).toBe("recording");
      await act(async () => vi.advanceTimersByTime(1_000));
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
      await dialog().findByText("0:00 of 2:00");

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
      // As they are, since ElevenLabs takes several
      expect(FakeContext.decoded).toEqual([]);
    });

    it("joins the samples into one WAV for an engine that takes one", async () => {
      const { user } = setup([INWORLD]);
      const a = sample("a.mp3");
      await user.type(dialog().getByPlaceholderText("My voice"), "Me");
      await picked(a, sample("b.webm"));
      await user.click(dialog().getByRole("checkbox"));

      await user.click(button("Clone voice"));

      const [sent0] = sent(APP_EVENTS.CLONE_VOICE);
      expect(sent0.engine).toBe("inworld");
      expect(sent0.samples).toHaveLength(1);
      const wav = sent0.samples[0];
      expect(wav.name).toBe("sample.wav");
      // 2 samples of 3 frames, 16 bits each
      expect(wav.data).toHaveLength(44 + 12);
      expect(String.fromCharCode(...wav.data.slice(0, 4))).toBe("RIFF");
      expect(new DataView(wav.data.buffer).getUint32(24, true)).toBe(44100);
      // Decoded from copies, so the samples keep their bytes
      expect(FakeContext.decoded).toHaveLength(2);
      expect(FakeContext.decoded[0]).not.toBe(a.data.buffer);
      expect(a.data).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("says which sample it can't read, and sends nothing", async () => {
      const { user } = setup([INWORLD]);
      await user.type(dialog().getByPlaceholderText("My voice"), "Me");
      await picked(sample("a.mp3"), {
        name: "b.m4a",
        data: new Uint8Array([0, 1]),
      });
      await user.click(dialog().getByRole("checkbox"));

      await user.click(button("Clone voice"));

      expect(await dialog().findByRole("alert")).toHaveTextContent(
        'Unable to read "b.m4a". Remove it and add another file.',
      );
      expect(sent(APP_EVENTS.CLONE_VOICE)).toEqual([]);
      expect(button("Clone voice")).toBeEnabled();
      expect(dialog().getByText("a.mp3")).toBeInTheDocument();

      const bad = within(dialog().getAllByRole("listitem")[1]);
      await user.click(bad.getByRole("button", { name: "Remove" }));
      expect(dialog().queryByRole("alert")).not.toBeInTheDocument();
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

  describe("engines", () => {
    const picker = () => dialog().queryByRole("combobox", { name: "Engine" });
    const hint = () => dialog().getByText(/^Best with/);

    it("picks one only when there are two or more", () => {
      setup();

      expect(picker()).not.toBeInTheDocument();
      expect(hint()).toHaveTextContent(/^Best with 1–2 minutes of one person/);
    });

    it("names the picked engine and its lengths", async () => {
      const { user } = setup([ELEVEN, INWORLD]);
      await picked(sample("a.mp3"));
      expect(picker()).toHaveTextContent("ElevenLabs");

      await user.click(picker()!);
      await user.click(screen.getByRole("option", { name: "Inworld" }));

      expect(
        screen.getByRole("dialog", { name: "Clone a voice" }),
      ).toHaveAccessibleDescription(/^Inworld adds the voice/);
      expect(hint()).toHaveTextContent(
        /^Best with 10–30 seconds of .+ Inworld takes a single sample, so Tokio joins yours, up to 30 seconds.$/,
      );
      // The samples stay
      expect(dialog().getByText("a.mp3")).toBeInTheDocument();
    });

    it("can't change while recording", async () => {
      const { user } = setup([ELEVEN, INWORLD]);

      await user.click(button("Record"));
      await granted();
      await dialog().findByText("0:00 of 2:00");

      expect(picker()).toHaveAttribute("aria-disabled", "true");
    });

    it("stops a recording at the picked engine's longest length", async () => {
      vi.useFakeTimers();
      setup([INWORLD]);

      fireEvent.click(button("Record"));
      await granted();
      await act(async () => {});
      expect(dialog().getByText("0:00 of 0:30")).toBeInTheDocument();

      await act(async () => vi.advanceTimersByTime(30_000));
      await act(async () => {});

      expect(FakeRecorder.made[0].state).toBe("inactive");
      expect(dialog().getByText("Recording 1.webm")).toBeInTheDocument();
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
