// Overlay Studio's editor: cameras, videos, shapes, lists and goal bars
import {
  StudioElement,
  StudioElementOf,
  TriggerSchema,
} from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, TOKIO_EVENTS } from "@/common/types";
import { profileReply, settingsReply, studioOverlay } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { inList } from "@test/queries";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ID,
  elementOf,
  text,
  holding,
  scene,
  studio,
  open,
  lastSave,
  saved,
  savedElement,
  page,
  row,
  rowOf,
  drawn,
  field,
  undo,
} from "@test/studio";

describe("StudioEditor", () => {
  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("camera elements", () => {
    const device = (deviceId: string, label: string): MediaDeviceInfo => ({
      kind: "videoinput",
      deviceId,
      label,
      groupId: "",
      toJSON: () => ({}),
    });
    const listed = (...devices: MediaDeviceInfo[]) =>
      vi
        .spyOn(navigator.mediaDevices, "enumerateDevices")
        .mockResolvedValue(devices);
    const cameraField = () => page().getByRole("group", { name: "Camera" });

    it("picks one of this computer's cameras, or the default one", async () => {
      listed(device("cam-a", "Front"), device("cam-b", "Desk"));
      const element = elementOf("camera");
      const { user } = await open(scene(element));
      await user.click(row(/^Camera/));

      // The default camera, by the kind's name
      await user.click(within(cameraField()).getByText("Default camera"));
      expect(inList(cameraField(), "Front")).not.toBeNull();
      await user.click(inList(cameraField(), "Desk")!);
      await waitFor(() =>
        expect(savedElement()).toMatchObject({
          camera: { id: "cam-b", label: "Desk" },
        }),
      );
      expect(row(/^Desk/)).toBeVisible();
      // Main's echo, so the next pick is a change to save
      await studio(lastSave()!);

      await user.click(within(cameraField()).getByText("Desk"));
      await user.click(inList(cameraField(), "Default camera")!);
      await waitFor(() =>
        expect(savedElement()).toMatchObject({ camera: null }),
      );
    });

    it("lists a camera plugged in while it's open", async () => {
      const enumerate = listed();
      const { user } = await open(scene(elementOf("camera")));
      await user.click(row(/^Camera/));

      enumerate.mockResolvedValue([device("cam-a", "Front")]);
      await act(async () => {
        navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
      });
      await user.click(within(cameraField()).getByText("Default camera"));

      expect(inList(cameraField(), "Front")).not.toBeNull();
    });

    it("shows a saved camera by its name, or as not connected", async () => {
      listed(device("cam-b", "Desk"));
      // Saved where the ids differ, as in a dev build
      const desk = elementOf("camera", {
        label: "Desk cam",
        camera: { id: "old-id", label: "Desk" },
      });
      const gone = elementOf("camera", {
        label: "Gone cam",
        camera: { id: "gone", label: "Old cam" },
      });
      const { user } = await open(scene(desk, gone));

      await user.click(row(/^Desk cam/));
      expect(await within(cameraField()).findByText("Desk")).toBeVisible();

      await user.click(row(/^Gone cam/));
      expect(
        within(cameraField()).getByText("Old cam (not connected)"),
      ).toBeVisible();
    });

    it("saves its quality", async () => {
      const element = elementOf("camera");
      const { user } = await open(scene(element));
      await user.click(row(/^Camera/));

      const quality = page().getByRole("group", { name: "Quality" });
      await user.click(within(quality).getByText("720p"));
      await user.click(inList(quality, "1080p")!);

      await waitFor(() =>
        expect(savedElement()).toMatchObject({ quality: "1080p" }),
      );
    });

    it("shows the camera straight from this window, with no stream", async () => {
      listed(device("cam-b", "Desk"));
      const stream = { getTracks: () => [], getVideoTracks: () => [] };
      const opened = vi
        .spyOn(navigator.mediaDevices, "getUserMedia")
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        .mockResolvedValue(stream as unknown as MediaStream);
      const element = elementOf("camera", {
        camera: { id: "cam-b", label: "Desk" },
      });
      await open(scene(element));
      const video = () => drawn(element.id).querySelector("video")!;

      // Its src names the camera and its quality, with no key or server
      expect(video().dataset.src).toBe(
        "/studio/camera/?device=cam-b&label=Desk&quality=720p",
      );
      await waitFor(() => expect(video().srcObject).toBe(stream));
      expect(opened).toHaveBeenCalledWith({
        audio: false,
        video: expect.objectContaining({
          deviceId: { exact: "cam-b" },
          width: { ideal: 1280 },
        }),
      });
    });

    it("shows the camera with the overlay server off", async () => {
      const stream = { getTracks: () => [], getVideoTracks: () => [] };
      vi.spyOn(navigator.mediaDevices, "getUserMedia")
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        .mockResolvedValue(stream as unknown as MediaStream);
      const element = elementOf("camera");
      const { user } = await open(scene(element));
      await user.click(row(/^Camera/));

      await send(
        APP_EVENTS_RESPONSE.GET_SETTINGS,
        settingsReply((store) => {
          store.settings.server.enabled = false;
        }),
      );

      await waitFor(() =>
        expect(drawn(element.id).querySelector("video")?.srcObject).toBe(
          stream,
        ),
      );
      expect(
        within(cameraField()).queryByText(/overlay server/),
      ).not.toBeInTheDocument();
    });

    it("shows a webcam in its row, not a live picture", async () => {
      await open(scene(elementOf("camera")));

      const thumb = rowOf(/^Camera/).getByText(
        (_, el) => !!el?.matches("[class*=thumb]"),
      );
      expect(thumb.querySelector("svg")).not.toBeNull();
      expect(thumb.querySelector("img")).toBeNull();
    });
  });

  describe("videos", () => {
    const clip = (patch: Partial<StudioElementOf<"media">> = {}) =>
      elementOf("media", {
        label: "Clip",
        file: "clip.webm",
        name: "clip.webm",
        ...patch,
      });
    // The settings' hidden player, which reads the video's length
    const reader = () =>
      page()
        .getByRole("heading", { name: "Image or video" })
        .parentElement!.querySelector("video");
    const measure = (seconds: number) => {
      const video = reader()!;
      Object.defineProperty(video, "duration", {
        value: seconds,
        configurable: true,
      });
      fireEvent.loadedMetadata(video);
    };
    const cut = () => within(page().getByRole("group", { name: "Cut" }));
    const sound = () => page().getByRole("button", { name: "Canvas sound" });

    it("cuts a video with the alerts' track once its length is read, the canvas showing each frame", async () => {
      const shown = clip();
      const { user } = await open(holding(shown));
      await user.click(row(/^Clip/));
      const player = () => drawn(shown.id).querySelector("video")!;
      expect(page().queryByRole("group", { name: "Cut" })).toBeNull();

      measure(10);
      await user.clear(cut().getByRole("spinbutton", { name: "Start" }));
      await user.type(cut().getByRole("spinbutton", { name: "Start" }), "2");
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ start: 2, end: null }),
      );
      expect(player().currentTime).toBe(2);

      await studio(lastSave()!);
      await user.clear(cut().getByRole("spinbutton", { name: "End" }));
      await user.type(cut().getByRole("spinbutton", { name: "End" }), "5");
      // Held on the end's frame, then the cut plays again from its start
      expect(player().currentTime).toBe(5);
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ start: 2, end: 5 }),
      );
      await waitFor(() => expect(player().currentTime).toBe(2), {
        timeout: 2000,
      });

      // The whole video again: main holds the cut first, or the autosave
      // would see nothing new to send
      await studio(lastSave()!);
      await user.click(cut().getByRole("button", { name: "Reset the cut" }));
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ start: 0, end: null }),
      );
      expect(
        cut().getByRole("button", { name: "Reset the cut" }),
      ).toBeDisabled();
    });

    it("sets a video's volume and loop, and one without loop stays until it ends", async () => {
      const shown = clip({ when: "event", start: 1 });
      const { user } = await open(holding(shown));
      await user.click(row(/^Clip/));
      const seconds = () => field("Seconds on screen");
      const again = () => page().queryByRole("button", { name: "Play again" });
      expect(seconds().getByRole("spinbutton")).toBeVisible();
      // It plays again on its own while it loops
      expect(again()).toBeNull();

      fireEvent.change(page().getByRole("slider", { name: "Volume (100%)" }), {
        target: { value: "40" },
      });
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ volume: 40 }),
      );

      await studio(lastSave()!);
      await user.click(page().getByRole("checkbox", { name: "Loop" }));
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ loop: false }),
      );
      expect(seconds().queryByRole("spinbutton")).toBeNull();
      expect(seconds().getByText("Until the video ends")).toBeVisible();

      // Stopped at its end on the canvas, Play again starts its cut over
      const player = drawn(shown.id).querySelector("video")!;
      player.currentTime = 4;
      await user.click(again()!);
      expect(player.currentTime).toBe(1);
    });

    it("starts another file uncut, with its volume and loop", async () => {
      const shown = clip({ start: 2, end: 5, volume: 40, loop: false });
      const { user } = await open(holding(shown));
      await user.click(row(/^Clip/));
      await user.click(page().getByRole("button", { name: "clip.webm" }));
      await user.click(screen.getByRole("button", { name: "Browse file..." }));
      const [{ request }] = sent(APP_EVENTS.IMPORT_MEDIA);

      await send(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
        success: true,
        id: shown.id,
        request,
        media: { name: "Party", file: "party.webm" },
      });

      expect((await saved()).items[0]).toMatchObject({
        file: "party.webm",
        start: 0,
        end: null,
        volume: 40,
        loop: false,
      });
    });

    it("gives an image none of a video's fields", async () => {
      const { user } = await open(
        holding(clip({ file: "pic.png", name: "pic.png" })),
      );
      await user.click(row(/^Clip/));

      expect(page().queryByRole("checkbox", { name: "Loop" })).toBeNull();
      expect(page().queryByRole("slider", { name: /^Volume/ })).toBeNull();
      expect(reader()).toBeNull();
    });

    it("plays the canvas's videos with their sound only while Canvas sound is on", async () => {
      const shown = clip();
      const { user } = await open(holding(shown, text()));
      const player = () => drawn(shown.id).querySelector("video")!;
      expect(sound()).toHaveAttribute("aria-pressed", "false");
      expect(player().muted).toBe(true);

      await user.click(sound());
      expect(sound()).toHaveAttribute("aria-pressed", "true");
      expect(player().muted).toBe(false);

      await user.click(sound());
      expect(player().muted).toBe(true);
    });

    it("has no Canvas sound without a video on the canvas", async () => {
      await open(holding(text(), clip({ file: "pic.png", name: "pic.png" })));

      expect(sound()).toBeDisabled();
    });
  });

  describe("shapes", () => {
    const tiles = () => field("Shape");
    const picked = () => tiles().getByRole("radio", { checked: true });

    it("picks a shape from its tiles, each with the number it takes", async () => {
      const { user } = await open(holding(elementOf("shape")));
      await user.click(row(/^Rectangle/));
      expect(picked()).toHaveAccessibleName("Rectangle");
      expect(field("Corner radius").getByRole("spinbutton")).toBeVisible();

      await user.click(tiles().getByRole("radio", { name: "Star" }));
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ shape: "star" }),
      );
      expect(page().queryByRole("group", { name: "Corner radius" })).toBeNull();

      await studio(lastSave()!);
      await user.clear(field("Points").getByRole("spinbutton"));
      await user.type(field("Points").getByRole("spinbutton"), "7");
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({
          shape: "star",
          points: 7,
        }),
      );

      await studio(lastSave()!);
      await user.click(tiles().getByRole("radio", { name: "Speech bubble" }));
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ shape: "bubble" }),
      );
      expect(field("Corner radius").getByRole("spinbutton")).toBeVisible();
      expect(page().queryByRole("group", { name: "Points" })).toBeNull();
    });

    it("moves through the shapes with the arrow keys, and names and draws one in the list", async () => {
      const { user } = await open(holding(elementOf("shape")));
      await user.click(row(/^Rectangle/));
      await user.click(tiles().getByRole("radio", { name: "Star" }));

      await user.keyboard("{ArrowLeft}");
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ shape: "polygon" }),
      );
      expect(picked()).toHaveAccessibleName("Polygon");
      expect(field("Sides").getByRole("spinbutton")).toHaveValue(3);
      // Named by its shape, and drawn in miniature
      expect(row(/^Polygon/).querySelector("svg path")).toHaveAttribute(
        "d",
        expect.stringMatching(/^M[\d.]+ 0L/),
      );
    });
  });
  describe("lists", () => {
    it("shows this LIVE's top gifters with their coins, named by what it lists", async () => {
      const list = elementOf("list");
      const { user } = await open(holding(list));

      await user.click(row(/^Top gifters this LIVE/));
      const rows = drawn(list.id).querySelectorAll(".studio-row");
      // Five sample rows by default, biggest first
      expect(rows).toHaveLength(5);
      expect(rows[0].querySelector(".studio-number")!.textContent).toBe(
        "12.4K",
      );
      expect(page().getByRole("group", { name: "Number color" })).toBeVisible();
    });

    it("picks whose top gifters it shows once the profile uses another platform", async () => {
      const list = elementOf("list");
      const { user } = await open(holding(list));
      await user.click(row(/^Top gifters/));
      // TikTok's alone: nothing to pick
      expect(page().queryByRole("group", { name: "Platform" })).toBeNull();

      await send(
        APP_EVENTS_RESPONSE.GET_PROFILE,
        profileReply((p) => {
          p.platforms = ["tiktok", "youtube"];
        }),
      );
      await user.click(field("Platform").getByText("TikTok"));
      const platform = page().getByRole("group", { name: "Platform" });
      // The profile's platforms, each ranking in its own currency
      expect(inList(platform, "TikTok")).toBeTruthy();
      expect(inList(platform, "Twitch")).toBeNull();
      expect(inList(platform, "Kick")).toBeNull();
      await user.click(inList(platform, "YouTube")!);

      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ platform: "youtube" }),
      );
      // YouTube's in US dollars
      expect(drawn(list.id).querySelector(".studio-number")!.textContent).toBe(
        "$124.00",
      );

      // A profile without YouTube keeps it shown, to change
      await send(APP_EVENTS_RESPONSE.GET_PROFILE, profileReply());
      await user.click(field("Platform").getByText("YouTube"));
      const kept = page().getByRole("group", { name: "Platform" });
      expect(inList(kept, "TikTok")).toBeTruthy();
      expect(inList(kept, "Kick")).toBeNull();
    });

    it("tops Twitch's Bits and its gifted subs as two sources", async () => {
      const list = elementOf("list");
      const { user } = await open(holding(list));
      await send(
        APP_EVENTS_RESPONSE.GET_PROFILE,
        profileReply((p) => {
          p.platforms = ["twitch"];
        }),
      );
      await user.click(row(/^Top gifters/));

      // The saved TikTok top stays to change, named by its money
      await user.click(field("Shows").getByText("Top gifters this LIVE"));
      const shows = page().getByRole("group", { name: "Shows" });
      expect(inList(shows, "New followers")).toBeTruthy();
      expect(inList(shows, "Latest gifts")).toBeNull();
      await user.click(inList(shows, "Top gifted subs this LIVE")!);

      // TikTok gifts no subs: the list moves to Twitch's
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({
          source: "giftsubs",
          platform: "twitch",
        }),
      );
      expect(row(/^Top gifted subs this LIVE/)).toBeVisible();

      // Twitch's money top is its Bits
      await user.click(field("Shows").getByText("Top gifted subs this LIVE"));
      await user.click(
        inList(
          page().getByRole("group", { name: "Shows" }),
          "Top Bits this LIVE",
        )!,
      );
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({
          source: "gifters",
          platform: "twitch",
        }),
      );
      expect(row(/^Top Bits this LIVE/)).toBeVisible();
    });

    it("lists another source, with its own rows and fields", async () => {
      const list = elementOf("list");
      const { user } = await open(holding(list));
      await user.click(row(/^Top gifters/));

      const shows = field("Shows").getByText("Top gifters this LIVE");
      await user.click(shows);
      await user.click(
        inList(page().getByRole("group", { name: "Shows" }), "Chat")!,
      );

      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ source: "chat" }),
      );
      expect(row(/^Chat/)).toBeVisible();
      // Chat has no numbers to color
      expect(page().queryByRole("group", { name: "Number color" })).toBeNull();
      const messages = drawn(list.id).querySelectorAll(".studio-message");
      expect(messages[0].textContent).not.toBe("");
    });

    it("saves its rows, gap, size and pictures", async () => {
      const list = elementOf("list");
      const { user } = await open(holding(list));
      await user.click(row(/^Top gifters/));

      await user.clear(field("Rows").getByRole("spinbutton"));
      await user.type(field("Rows").getByRole("spinbutton"), "3");
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ rows: 3 }),
      );
      await studio(lastSave()!);
      expect(drawn(list.id).querySelectorAll(".studio-row")).toHaveLength(3);

      await user.clear(field("Space between rows").getByRole("spinbutton"));
      await user.type(field("Space between rows").getByRole("spinbutton"), "4");
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ rows: 3, gap: 4 }),
      );
      await studio(lastSave()!);

      await user.click(
        page().getByRole("checkbox", { name: "Viewers' pictures" }),
      );
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ pictures: false }),
      );
    });
  });
});

describe("a goal bar's fields", () => {
  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const roses = {
    name: "roses",
    trigger: TriggerSchema.parse({ type: TOKIO_EVENTS.GIFT, gifts: [] }),
  };
  const withBar = (bar: StudioElement, counters = [roses]) =>
    studioOverlay("Main", { id: ID, counters, items: [bar] });

  it("fills toward a LIVE number or a counter, shown as a text writes them", async () => {
    const { user } = await open(withBar(elementOf("bar")));
    await user.click(row(/^Goal bar/));

    const number = field("Number");
    await user.click(number.getByText("{likes}"));
    expect(inList(number.getByText("{likes}"), "{coins}")).not.toBeNull();
    expect(inList(number.getByText("{likes}"), "{uptime}")).toBeNull();
    await user.click(inList(number.getByText("{likes}"), "{roses}")!);
    await waitFor(() =>
      expect(lastSave()?.items[0]).toMatchObject({ number: "roses" }),
    );

    await studio(lastSave()!);
    const goal = field("Goal").getByRole("spinbutton");
    await user.clear(goal);
    await user.type(goal, "250");
    await waitFor(() =>
      expect(lastSave()?.items[0]).toMatchObject({ goal: 250 }),
    );
  });

  it("shows no number for a counter since removed", async () => {
    const { user } = await open(
      withBar(elementOf("bar", { number: "roses" }), []),
    );
    await user.click(row(/^Goal bar/));

    expect(field("Number").queryByText(/^\{/)).toBeNull();
  });

  it("draws its sample fill on the canvas and in its row, and fades it into a gradient", async () => {
    const bar = elementOf("bar");
    const { user } = await open(withBar(bar));
    await user.click(row(/^Goal bar/));

    // The editor shows it partly full, whatever its number
    const fill = drawn(bar.id).querySelector<HTMLElement>(".studio-bar-fill")!;
    expect(fill.style.width).toBe("60%");
    expect(
      row(/^Goal bar/).querySelector<HTMLElement>("[class*=thumb_bar] > span")!
        .style.width,
    ).toBe("60%");

    await user.click(page().getByRole("checkbox", { name: "Gradient" }));
    await waitFor(() =>
      expect(lastSave()?.items[0]).toMatchObject({ gradient: true }),
    );
    expect(drawn(bar.id).classList).toContain("studio-gradient");
  });

  it("turns its box around its center when it goes vertical, in one step", async () => {
    const bar = elementOf("bar", { x: 100, y: 500, width: 720, height: 56 });
    const { user } = await open(withBar(bar));
    await user.click(row(/^Goal bar/));

    await user.click(
      page().getByRole("checkbox", {
        name: "Vertical, filling from the bottom",
      }),
    );
    await waitFor(() =>
      expect(lastSave()?.items[0]).toMatchObject({
        vertical: true,
        x: 432,
        y: 168,
        width: 56,
        height: 720,
      }),
    );
    const fill = drawn(bar.id).querySelector<HTMLElement>(".studio-bar-fill")!;
    expect(fill.style.height).toBe("60%");

    // Back where it was, in one undo
    await studio(lastSave()!);
    await user.click(undo());
    await waitFor(() =>
      expect(lastSave()?.items[0]).toMatchObject({
        vertical: false,
        x: 100,
        y: 500,
        width: 720,
        height: 56,
      }),
    );
  });
});
