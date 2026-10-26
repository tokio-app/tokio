import { Profile } from "@/common/schemas";
import {
  ChatEvent,
  CurrentSongInfo,
  MusicInfo,
  SongInfo,
  TOKIO_EVENTS,
  TokioEventMap,
  UserData,
} from "@/common/types";
import { defaultProfile } from "@/common/util";
import Logger from "@/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionResponse, MusicProvider } from "./common";
import { MusicService } from "./index";

const song = (title: string, duration = 10_000): SongInfo => ({
  album: `album:${title}`,
  track: `track:${title}`,
  title,
  thumbnail: `${title}.jpg`,
  duration,
});

class FakeProvider extends MusicProvider {
  setKey = vi.fn<(key: string) => void>();
  connect = vi.fn<() => Promise<ConnectionResponse>>(async () => ({
    success: true,
  }));
  disconnect = vi.fn<() => void>();
  play = vi.fn<(track: SongInfo) => Promise<void>>(async () => {});
  searchSong = vi.fn<(query: string) => Promise<SongInfo | null>>(
    async (query) => song(query),
  );
  playerStatus = vi.fn<() => Promise<CurrentSongInfo | null>>(async () => null);
  isActive = vi.fn<() => boolean>(() => true);

  // Public, so tests can emit what a real provider would
  public override emit<K extends TOKIO_EVENTS>(
    event: K,
    data?: TokioEventMap[K],
  ) {
    super.emit(event, data);
  }
}

const chat = (content: string, user: Partial<UserData> = {}): ChatEvent => ({
  user: { username: "Viewer", handle: "viewer", profilePictures: [], ...user },
  comment: { content, emotes: [], lang: "en" },
});

// Without a cooldown unless `change` sets one, so requests don't wait, and
// with every control open to every viewer
const settings = (change: (music: Profile["music"]) => void = () => {}) => {
  const music = structuredClone(defaultProfile.music);
  music.protection.cooldown = 0;
  music.protection.limit_controls = false;
  change(music);
  return music;
};

// A promise that fails, already handled so dropping it isn't an unhandled rejection
const rejected = (error: Error) => {
  const promise = Promise.reject(error);
  promise.catch(() => {});
  return promise;
};

const setup = () => {
  const service = new MusicService();
  const provider = new FakeProvider();
  service.addProvider("Fake", provider, true);
  const changes = vi.fn<(songs: MusicInfo[]) => void>();
  service.on(TOKIO_EVENTS.MUSIC_CHANGE, changes);

  const request = async (content: string, music = settings()) => {
    service.handle(chat(content), music);
    await vi.advanceTimersByTimeAsync(0);
  };
  const searched = () => provider.searchSong.mock.calls.map(([query]) => query);
  const played = () => provider.play.mock.calls.map(([track]) => track.title);
  const queue = () =>
    (changes.mock.lastCall?.[0] ?? []).map(({ title, playing }) =>
      playing ? `${title} (playing)` : title,
    );

  return { service, provider, changes, request, searched, played, queue };
};

describe("MusicService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("commands", () => {
    it("searches the text after the command, trimmed", async () => {
      const { request, searched } = setup();

      await request("!play  Song Name ");

      expect(searched()).toEqual(["Song Name"]);
    });

    it("ignores commands that aren't at the start of the message", async () => {
      const { request, provider } = setup();

      await request("please !play Song");

      expect(provider.searchSong).not.toHaveBeenCalled();
    });

    it("ignores empty messages", async () => {
      const { request, provider } = setup();

      await request("");

      expect(provider.playerStatus).not.toHaveBeenCalled();
      expect(provider.searchSong).not.toHaveBeenCalled();
    });

    it("uses renamed commands", async () => {
      const { request, searched } = setup();
      const music = settings((m) => {
        m.controls.play.command = "!sr";
      });

      await request("!play Old", music);
      await request("!sr New", music);

      expect(searched()).toEqual(["New"]);
    });

    it("ignores disabled controls", async () => {
      const { request, played } = setup();
      const music = settings((m) => {
        m.controls.next.enabled = false;
      });
      await request("!play A", music);
      await request("!play B", music);

      await request("!next", music);

      expect(played()).toEqual(["A"]);
    });

    it("ignores a disabled play command", async () => {
      const { request, provider } = setup();

      await request(
        "!play Song",
        settings((m) => {
          m.controls.play.enabled = false;
        }),
      );

      expect(provider.searchSong).not.toHaveBeenCalled();
    });

    it("only takes requests from viewers with permission", async () => {
      const { service, searched } = setup();
      const music = settings((m) => {
        m.permissions.all = false;
        m.permissions.followers = true;
      });

      service.handle(chat("!play Stranger"), music);
      service.handle(chat("!play Fan", { follower: true }), music);
      await vi.advanceTimersByTimeAsync(0);

      expect(searched()).toEqual(["Fan"]);
    });

    it("ignores blacklisted viewers", async () => {
      const { service, searched } = setup();
      const music = settings((m) => {
        m.permissions.all = false;
        m.permissions.list = { enabled: true, white: [], black: ["troll"] };
      });

      service.handle(chat("!play Spam", { handle: "troll" }), music);
      service.handle(chat("!play Song", { handle: "fan" }), music);
      await vi.advanceTimersByTimeAsync(0);

      expect(searched()).toEqual(["Song"]);
    });
  });

  describe("protection", () => {
    it("ignores commands until the cooldown has passed since the last one taken", async () => {
      const { service, request, searched } = setup();
      const music = settings((m) => {
        m.protection.cooldown = 2;
      });

      await request("!play A", music);
      await vi.advanceTimersByTimeAsync(500);
      service.handle(chat("!play B", { handle: "other" }), music);
      await vi.advanceTimersByTimeAsync(1500);
      await request("!play C", music);

      expect(searched()).toEqual(["A", "C"]);
    });

    it("keeps the cooldown when the system clock is set back", async () => {
      const { request, searched } = setup();
      const music = settings((m) => {
        m.protection.cooldown = 2;
      });

      await request("!play A", music);
      await vi.advanceTimersByTimeAsync(2000);
      vi.setSystemTime(Date.now() - 60_000);
      await request("!play B", music);

      expect(searched()).toEqual(["A", "B"]);
    });

    it("takes every command without a cooldown", async () => {
      const { service, searched } = setup();

      service.handle(chat("!play A"), settings());
      service.handle(chat("!play B"), settings());
      await vi.advanceTimersByTimeAsync(0);

      expect(searched()).toEqual(["A", "B"]);
    });

    it("drops requests past the queue length while they wait", async () => {
      const { service, searched } = setup();
      const music = settings((m) => {
        m.protection.queue_length = 1;
      });

      service.handle(chat("!play A"), music);
      service.handle(chat("!play B"), music);
      service.handle(chat("!play C"), music);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(searched()).toEqual(["A", "B"]);
    });

    it("keeps as many songs as the queue length", async () => {
      const { request, queue } = setup();
      const music = settings((m) => {
        m.protection.queue_length = 2;
      });

      await request("!play A", music);
      await request("!play B", music);
      await request("!play C", music);

      expect(queue()).toEqual(["A (playing)", "B"]);
    });

    describe("one request per viewer", () => {
      const music = settings((m) => {
        m.protection.one_per_viewer = true;
        m.protection.cooldown = 2;
      });
      const from = (handle: string, content: string) =>
        chat(content, { handle });

      it("ignores a viewer's request while another of theirs waits, keeping the cooldown free", async () => {
        const { service, request, searched, queue } = setup();
        await request("!play A", music);
        await vi.advanceTimersByTimeAsync(2_000);
        // A plays, so the viewer may ask again
        await request("!play B", music);
        await vi.advanceTimersByTimeAsync(2_000);

        await request("!play C", music);
        service.handle(from("other", "!play D"), music);
        await vi.advanceTimersByTimeAsync(0);

        expect(searched()).toEqual(["A", "B", "D"]);
        expect(queue()).toEqual(["A (playing)", "B", "D"]);
      });

      it("ignores a viewer's request while theirs is searching", async () => {
        const { service, provider, request, searched } = setup();
        let found = (_song: SongInfo | null) => {};
        provider.searchSong.mockImplementationOnce(
          () => new Promise((resolve) => (found = resolve)),
        );
        await request("!play A", music);
        await vi.advanceTimersByTimeAsync(2_000);

        await request("!play B", music);
        service.handle(from("other", "!play C"), music);
        found(song("A"));
        await vi.advanceTimersByTimeAsync(0);

        expect(searched()).toEqual(["A", "C"]);
      });

      it("drops a song that's playing or waiting and gives the cooldown back", async () => {
        const { service, searched, queue } = setup();
        service.handle(from("a", "!play A"), music);
        await vi.advanceTimersByTimeAsync(2_000);

        service.handle(from("b", "!play A"), music);
        await vi.advanceTimersByTimeAsync(0);
        service.handle(from("c", "!play B"), music);
        await vi.advanceTimersByTimeAsync(0);

        expect(searched()).toEqual(["A", "A", "B"]);
        expect(queue()).toEqual(["A (playing)", "B"]);
      });

      it("drops the song the player is playing outside the queue and gives the cooldown back", async () => {
        const { service, provider, searched, played, queue } = setup();
        provider.playerStatus.mockResolvedValue({
          ...song("A", 10_000),
          playing: true,
          time: 4_000,
        });

        service.handle(from("a", "!play A"), music);
        await vi.advanceTimersByTimeAsync(0);
        service.handle(from("b", "!play B"), music);
        await vi.advanceTimersByTimeAsync(0);

        expect(searched()).toEqual(["A", "B"]);
        expect(queue()).toEqual(["A (playing)", "B"]);
        expect(played()).toEqual([]);
      });

      it("keeps the cooldown of a command taken while the duplicate searched", async () => {
        const { service, provider, searched } = setup();
        service.handle(from("a", "!play A"), music);
        await vi.advanceTimersByTimeAsync(2_000);
        provider.searchSong.mockImplementationOnce(async (query) => {
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          return song(query);
        });
        service.handle(from("b", "!play A"), music);
        await vi.advanceTimersByTimeAsync(2_500);
        service.handle(from("c", "!next"), music);
        await vi.advanceTimersByTimeAsync(500);

        // 1 s after !next took the cooldown
        service.handle(from("d", "!play D"), music);
        await vi.advanceTimersByTimeAsync(0);

        expect(searched()).toEqual(["A", "A"]);
      });

      it("changes nothing while it's off", async () => {
        const { request, queue } = setup();

        await request("!play A");
        await request("!play A");
        await request("!play B");

        expect(queue()).toEqual(["A (playing)", "A", "B"]);
      });
    });

    describe("limited controls", () => {
      const music = settings((m) => {
        m.protection.limit_controls = true;
      });
      const from = (handle: string, content: string, user = {}) =>
        chat(content, { handle, ...user });

      it("lets only the song's requester skip it", async () => {
        const { service, played } = setup();
        service.handle(from("a", "!play A"), music);
        service.handle(from("b", "!play B"), music);
        await vi.advanceTimersByTimeAsync(0);

        service.handle(from("b", "!next"), music);
        await vi.advanceTimersByTimeAsync(0);
        expect(played()).toEqual(["A"]);

        service.handle(from("A", "!next"), music);
        await vi.advanceTimersByTimeAsync(0);
        expect(played()).toEqual(["A", "B"]);
      });

      it("lets moderators and the host use Next and Last", async () => {
        const { service, played, queue } = setup();
        service.handle(from("a", "!play A"), music);
        service.handle(from("a", "!play B"), music);
        await vi.advanceTimersByTimeAsync(0);

        service.handle(from("mod", "!next", { moderator: true }), music);
        await vi.advanceTimersByTimeAsync(0);
        service.handle(from("Host", "!last"), music, "@host");
        await vi.advanceTimersByTimeAsync(0);

        expect(played()).toEqual(["A", "B", "A"]);
        expect(queue()).toEqual(["A (playing)", "B"]);
      });

      it("refuses Last from viewers", async () => {
        const { service, queue } = setup();
        service.handle(from("a", "!play A"), music);
        service.handle(from("a", "!play B"), music);
        await vi.advanceTimersByTimeAsync(0);
        service.handle(from("a", "!next"), music);
        await vi.advanceTimersByTimeAsync(0);

        service.handle(from("a", "!last"), music);
        await vi.advanceTimersByTimeAsync(0);

        expect(queue()).toEqual(["A", "B (playing)"]);
      });

      it("lets viewers revoke only their own requests, and moderators any", async () => {
        const { service, queue } = setup();
        service.handle(from("a", "!play A"), music);
        service.handle(from("b", "!play B"), music);
        service.handle(from("c", "!play B"), music);
        await vi.advanceTimersByTimeAsync(0);

        service.handle(from("c", "!revoke B"), music);
        service.handle(from("", "!revoke B"), music);
        await vi.advanceTimersByTimeAsync(0);
        expect(queue()).toEqual(["A (playing)", "B"]);

        service.handle(from("mod", "!revoke B", { moderator: true }), music);
        await vi.advanceTimersByTimeAsync(0);
        expect(queue()).toEqual(["A (playing)"]);
      });

      it("keeps the cooldown free when it refuses a command", async () => {
        const { service, searched } = setup();
        const cooled = settings((m) => {
          m.protection.limit_controls = true;
          m.protection.cooldown = 2;
        });
        service.handle(from("a", "!play A"), cooled);
        await vi.advanceTimersByTimeAsync(2_000);

        service.handle(from("b", "!next"), cooled);
        service.handle(from("b", "!last"), cooled);
        service.handle(from("b", "!play B"), cooled);
        await vi.advanceTimersByTimeAsync(0);

        expect(searched()).toEqual(["A", "B"]);
      });
    });
  });

  describe("play", () => {
    it("searches, queues and plays the requested song", async () => {
      const { request, provider, changes } = setup();

      await request("!play Song");

      expect(provider.play).toHaveBeenCalledExactlyOnceWith(song("Song"));
      expect(changes).toHaveBeenLastCalledWith([
        { title: "Song", thumbnail: "Song.jpg", playing: true, played: false },
      ]);
    });

    it("plays the requests one after another", async () => {
      const { request, played } = setup();

      await request("!play A");
      await request("!play B");
      expect(played()).toEqual(["A"]);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(played()).toEqual(["A", "B"]);
    });

    it("calls onSongChange when a song starts, not when one is queued", async () => {
      const { service, request } = setup();
      const onSongChange = vi.fn<(songs: MusicInfo[]) => void>();
      service.onSongChange(onSongChange);

      await request("!play A");
      await request("!play B");
      expect(onSongChange).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({ title: "A", playing: true }),
      ]);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(onSongChange).toHaveBeenCalledTimes(2);
      expect(onSongChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ title: "A", playing: false }),
        expect.objectContaining({ title: "B", playing: true }),
      ]);
    });

    it("keeps the track the provider is playing and plays the request after it", async () => {
      const { request, provider, played, queue } = setup();
      provider.playerStatus.mockResolvedValueOnce({
        ...song("Current", 10_000),
        playing: true,
        time: 4_000,
      });

      await request("!play New");

      expect(queue()).toEqual(["Current (playing)", "New"]);
      expect(played()).toEqual([]);

      await vi.advanceTimersByTimeAsync(5_999);
      expect(played()).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      expect(played()).toEqual(["New"]);
    });

    it("doesn't call onSongChange for the track the provider was playing", async () => {
      const { service, request, provider } = setup();
      const onSongChange = vi.fn<(songs: MusicInfo[]) => void>();
      service.onSongChange(onSongChange);
      provider.playerStatus.mockResolvedValueOnce({
        ...song("Current"),
        playing: true,
        time: 4_000,
      });

      await request("!play New");
      await vi.advanceTimersByTimeAsync(5_999);
      expect(onSongChange).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(onSongChange).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({ title: "Current", played: true }),
        expect.objectContaining({ title: "New", playing: true }),
      ]);
    });

    it("plays a request at once over the player's track with a queue length of 1", async () => {
      const { request, provider, played, queue } = setup();
      provider.playerStatus.mockResolvedValueOnce({
        ...song("Current"),
        playing: true,
        time: 4_000,
      });

      await request(
        "!play New",
        settings((m) => {
          m.protection.queue_length = 1;
        }),
      );

      expect(played()).toEqual(["New"]);
      expect(queue()).toEqual(["New (playing)"]);
    });

    it("plays the track the provider was playing again on !last", async () => {
      const { request, provider, played, queue } = setup();
      provider.playerStatus.mockResolvedValueOnce({
        ...song("Current", 10_000),
        playing: true,
        time: 4_000,
      });
      await request("!play New");
      await vi.advanceTimersByTimeAsync(6_000);
      expect(played()).toEqual(["New"]);

      await request("!last");

      expect(played()).toEqual(["New", "Current"]);
      expect(queue()).toEqual(["Current (playing)", "New"]);
    });

    it("leaves out a track the provider has paused", async () => {
      const { request, provider, played, queue } = setup();
      provider.playerStatus.mockResolvedValueOnce({
        ...song("Paused"),
        playing: false,
        time: 4_000,
      });

      await request("!play New");

      expect(queue()).toEqual(["New (playing)"]);
      expect(played()).toEqual(["New"]);
    });

    it("plays the next song as the player's ends, like after an ad", async () => {
      const { request, provider, played } = setup();
      await request("!play A");
      await request("!play B");
      // A 10 s song that started 3 s late
      const start = Date.now() + 3_000;
      provider.playerStatus.mockImplementation(async () => ({
        ...song("A"),
        playing: true,
        time: Date.now() - start,
      }));

      await vi.advanceTimersByTimeAsync(12_699);
      expect(played()).toEqual(["A"]);

      await vi.advanceTimersByTimeAsync(1);
      expect(played()).toEqual(["A", "B"]);
    });

    it("allows for the time the player takes to answer", async () => {
      const { request, provider, played } = setup();
      const start = Date.now();
      await request("!play A");
      await request("!play B");
      // Answers in 400 ms, with the time it read halfway through
      provider.playerStatus.mockImplementation(async () => {
        const time = Date.now() - start + 200;
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { ...song("A"), playing: true, time };
      });

      // 300 ms before A's end, not 200 ms later
      await vi.advanceTimersByTimeAsync(9_699);
      expect(played()).toEqual(["A"]);
      await vi.advanceTimersByTimeAsync(1);
      expect(played()).toEqual(["A", "B"]);
    });

    it("plays the next song as soon as the player moved on", async () => {
      const { request, provider, played } = setup();
      await request("!play A");
      await request("!play B");
      provider.playerStatus.mockResolvedValueOnce({
        ...song("Other"),
        playing: true,
        time: 1_000,
      });

      await vi.advanceTimersByTimeAsync(4_999);
      expect(played()).toEqual(["A"]);
      await vi.advanceTimersByTimeAsync(1);
      expect(played()).toEqual(["A", "B"]);
    });

    it("plays the next song at the listed end while the song is paused", async () => {
      const { request, provider, played } = setup();
      await request("!play A");
      await request("!play B");
      provider.playerStatus.mockResolvedValue({
        ...song("A"),
        playing: false,
        time: 2_000,
      });

      await vi.advanceTimersByTimeAsync(9_999);
      expect(played()).toEqual(["A"]);
      await vi.advanceTimersByTimeAsync(1);
      expect(played()).toEqual(["A", "B"]);
    });

    it("doesn't read the player while a request is playing", async () => {
      const { request, provider } = setup();

      await request("!play A");
      await request("!play B");

      expect(provider.playerStatus).toHaveBeenCalledOnce();
    });

    it("skips a request the search finds nothing for", async () => {
      const { request, provider, changes } = setup();
      provider.searchSong.mockResolvedValue(null);

      await request("!play Nothing");

      expect(provider.playerStatus).not.toHaveBeenCalled();
      expect(provider.play).not.toHaveBeenCalled();
      expect(changes).not.toHaveBeenCalled();
    });

    it("ignores a !play or !revoke without a song, keeping the cooldown free", async () => {
      const { request, provider, searched } = setup();
      const music = settings((m) => {
        m.protection.cooldown = 2;
      });

      await request("!play", music);
      await request("!play   ", music);
      await request("!revoke", music);
      expect(provider.searchSong).not.toHaveBeenCalled();
      expect(provider.playerStatus).not.toHaveBeenCalled();

      await request("!play A", music);
      expect(searched()).toEqual(["A"]);
    });
  });

  describe("controls", () => {
    it("skips to the next song", async () => {
      const { request, played, queue } = setup();
      await request("!play A");
      await request("!play B");

      await request("!next");

      expect(played()).toEqual(["A", "B"]);
      expect(queue()).toEqual(["A", "B (playing)"]);
    });

    it("goes back to the last song", async () => {
      const { request, played, queue } = setup();
      await request("!play A");
      await request("!play B");
      await request("!next");

      await request("!last");

      expect(played()).toEqual(["A", "B", "A"]);
      expect(queue()).toEqual(["A (playing)", "B"]);
    });

    it("removes a request by its text", async () => {
      const { request, played, queue } = setup();
      await request("!play A");
      await request("!play B");

      await request("!revoke B");
      expect(queue()).toEqual(["A (playing)"]);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(played()).toEqual(["A"]);
    });

    it("removes a request by the song's title", async () => {
      const { request, provider, queue } = setup();
      await request("!play A");
      provider.searchSong.mockResolvedValueOnce(song("Song B - Artist"));
      await request("!play b");

      await request("!revoke song b - artist");

      expect(queue()).toEqual(["A (playing)"]);
    });
  });

  describe("lifecycle", () => {
    it("clearHandler drops waiting requests and empties the queue", async () => {
      const { service, provider, request, searched, played } = setup();
      await request("!play A");
      // B's search never ends, so C waits behind it
      provider.searchSong.mockImplementationOnce(() => new Promise(() => {}));
      await request("!play B");
      await request("!play C");
      expect(searched()).toEqual(["A", "B"]);

      service.clearHandler();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(searched()).toEqual(["A", "B"]);
      expect(played()).toEqual(["A"]);
    });

    it("plays nothing for a search that ends after clearHandler", async () => {
      const { service, provider, request, played, changes } = setup();
      let found = (_song: SongInfo | null) => {};
      provider.searchSong.mockImplementationOnce(
        () => new Promise((resolve) => (found = resolve)),
      );
      await request("!play A");

      service.clearHandler();
      found(song("A"));
      await vi.advanceTimersByTimeAsync(30_000);

      expect(provider.playerStatus).not.toHaveBeenCalled();
      expect(played()).toEqual([]);
      expect(changes).not.toHaveBeenCalled();
    });

    it("empties the queue on disconnect", async () => {
      const { service, request, played, queue } = setup();
      await request("!play A");
      await request("!play B");

      service.disconnect();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(played()).toEqual(["A"]);

      await request("!play C");
      expect(queue()).toEqual(["C (playing)"]);
    });

    it("starts over after clearHandler", async () => {
      const { service, request, provider, played, queue } = setup();
      await request("!play A");
      service.clearHandler();

      await request("!play B");

      expect(provider.playerStatus).toHaveBeenCalledTimes(2);
      expect(played()).toEqual(["A", "B"]);
      expect(queue()).toEqual(["B (playing)"]);
    });

    it("on and off reach both the provider and the queue", async () => {
      const { service, provider, request } = setup();
      const listener = vi.fn<(songs: MusicInfo[]) => void>();

      service.on(TOKIO_EVENTS.MUSIC_CHANGE, listener);
      provider.emit(TOKIO_EVENTS.MUSIC_CHANGE, []);
      await request("!play A");

      expect(listener).toHaveBeenCalledWith([]);
      expect(listener).toHaveBeenLastCalledWith([
        expect.objectContaining({ title: "A" }),
      ]);

      listener.mockClear();
      service.off(TOKIO_EVENTS.MUSIC_CHANGE, listener);
      provider.emit(TOKIO_EVENTS.MUSIC_CHANGE, []);
      await request("!play B");

      expect(listener).not.toHaveBeenCalled();
    });

    it("connects, disconnects and reports activity through the provider", async () => {
      const { service, provider } = setup();
      const error = new Error("closed");
      provider.connect.mockResolvedValue({ success: false, error });
      provider.isActive.mockReturnValue(false);

      await expect(service.connect()).resolves.toEqual({
        success: false,
        error,
      });
      expect(service.isActive()).toBe(false);

      service.disconnect();

      expect(provider.connect).toHaveBeenCalledOnce();
      expect(provider.disconnect).toHaveBeenCalledOnce();

      provider.isActive.mockReturnValue(true);
      expect(service.isActive()).toBe(true);
    });

    it("gives its log file to the providers", () => {
      const { service, provider } = setup();
      const setLogFile = vi.spyOn(provider, "setLogFile");

      service.setLogFile("music.log");

      expect(setLogFile).toHaveBeenCalledExactlyOnceWith("music.log");
    });
  });

  describe("errors", () => {
    const listen = () => {
      const { service, ...rest } = setup();
      service.setLogFile("music.log");
      const onPlaybackError = vi.fn<(id: string, error: unknown) => void>();
      service.onPlaybackError(onPlaybackError);
      const logError = vi.spyOn(Logger, "error").mockImplementation(() => {});
      return { service, onPlaybackError, logError, ...rest };
    };

    it("reports a track the provider throws on, logs it and moves on", async () => {
      const { request, provider, onPlaybackError, logError, played } = listen();
      const error = new Error("player crashed");
      provider.play.mockImplementationOnce(() => {
        throw error;
      });

      await request("!play A");
      await request("!play B");
      await vi.advanceTimersByTimeAsync(10_000);

      expect(onPlaybackError).toHaveBeenCalledExactlyOnceWith("A", error);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("Unable to play track [A]"),
        "music.log",
        error,
      );
      expect(played()).toEqual(["A", "B"]);
    });

    it("reports a track the provider fails to play", async () => {
      const { request, provider, onPlaybackError, logError } = listen();
      const error = new Error(
        "No active devices. Play a song on Spotify first.",
      );
      provider.play.mockImplementation(() => rejected(error));

      await request("!play Song");

      expect(onPlaybackError).toHaveBeenCalledWith("Song", error);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("<Music>"),
        "music.log",
        error,
      );
    });

    it("reports a failed search and logs it", async () => {
      const { request, provider, onPlaybackError, logError } = listen();
      const error = new Error("search failed");
      provider.searchSong.mockImplementation(() => rejected(error));

      await request("!play Song");

      expect(onPlaybackError).toHaveBeenCalledWith("Song", error);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("<Music>"),
        "music.log",
        error,
      );
    });

    it("doesn't report a search that fails after clearHandler", async () => {
      const { service, request, provider, onPlaybackError, logError } =
        listen();
      let fail = (_error: Error) => {};
      provider.searchSong.mockImplementationOnce(
        () => new Promise((_, reject) => (fail = reject)),
      );
      await request("!play Song");

      service.clearHandler();
      fail(new Error("search failed"));
      await vi.advanceTimersByTimeAsync(0);

      expect(onPlaybackError).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it("reports a failed player read and logs it", async () => {
      const { request, provider, onPlaybackError, logError } = listen();
      const error = new Error("Not authenticated. Call authenticate() first.");
      provider.playerStatus.mockImplementation(() => rejected(error));

      await request("!play Song");

      expect(onPlaybackError).toHaveBeenCalledWith("Song", error);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("<Music>"),
        "music.log",
        error,
      );
    });
  });

  describe("command matching", () => {
    it("matches a command followed by whitespace, or alone", async () => {
      const { request, searched, played } = setup();

      await request("!play song");
      await request("!play\tother");
      await request("!next");

      expect(searched()).toEqual(["song", "other"]);
      expect(played()).toEqual(["song", "other"]);
    });

    it("matches commands in any case and keeps the song's", async () => {
      const { request, searched, queue } = setup();

      await request("!Play Song A");
      await request("!PLAY Song B");
      await request("!NEXT");

      expect(searched()).toEqual(["Song A", "Song B"]);
      expect(queue()).toEqual(["Song A", "Song B (playing)"]);
    });

    it("doesn't take a longer word for a command", async () => {
      const { request, provider } = setup();

      await request("!player");

      expect(provider.searchSong).not.toHaveBeenCalled();
    });

    it("never matches a control whose command is empty", async () => {
      const { request, provider } = setup();
      const music = settings((m) => {
        m.controls.play.command = "";
      });

      await request("hello everyone", music);

      expect(provider.searchSong).not.toHaveBeenCalled();
    });
  });
});
