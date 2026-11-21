import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type { PlatformAccount } from "../../../common";
import config from "../config";
import { NO_ACCOUNT, TwitchAuth } from "./auth";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

type FetchInit = { body?: string; headers?: Record<string, string> };

type Call = { url: string; form: URLSearchParams; auth: string };

// Routes each request by its URL, recording what it sent
function stubFetch(route: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: FetchInit = {}) => {
      const headers = init.headers ?? {};
      const call = {
        url,
        form: new URLSearchParams(init.body ?? ""),
        auth: headers.Authorization ?? "",
      };
      calls.push(call);
      return route(call);
    }),
  );
  return calls;
}

const tokenCalls = (calls: Call[]) =>
  calls.filter((c) => c.url === config.TOKEN_URL);

describe("TwitchAuth", () => {
  let auth: TwitchAuth;
  let saved: Mock<(account: PlatformAccount) => Promise<boolean>>;

  beforeEach(() => {
    auth = new TwitchAuth({ ...config, CLIENT_ID: "client" }, () => "");
    saved = vi.fn(async () => true);
    auth.onAccount(saved);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("signIn", () => {
    const device = {
      device_code: "device-1",
      user_code: "ABCD-EFGH",
      verification_uri: "https://www.twitch.tv/activate?device-code=ABCD-EFGH",
      expires_in: 1800,
      interval: 5,
    };

    it("polls while pending, slows down when told, then saves the account", async () => {
      vi.useFakeTimers();
      const answers = [
        json(400, { status: 400, message: "authorization_pending" }),
        json(400, { status: 400, message: "slow_down" }),
        json(200, { access_token: "access-1", refresh_token: "refresh-1" }),
      ];
      const calls = stubFetch(({ url }) => {
        if (url === config.DEVICE_URL) return json(200, device);
        if (url === config.TOKEN_URL) return answers.shift()!;
        return json(200, { login: "twitchdev", user_id: "141981764" });
      });
      const onCode = vi.fn();

      const signIn = auth.signIn(onCode, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(onCode).toHaveBeenCalledWith({
        code: "ABCD-EFGH",
        uri: device.verification_uri,
        expiresAt: Date.now() + 1_800_000,
      });
      expect(calls[0].form.get("client_id")).toBe("client");
      expect(calls[0].form.get("scopes")).toBe(config.SCOPES);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(tokenCalls(calls)).toHaveLength(2);
      // 5 s more after slow_down
      await vi.advanceTimersByTimeAsync(5000);
      expect(tokenCalls(calls)).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(5000);

      const account = { id: "141981764", login: "twitchdev", key: "refresh-1" };
      await expect(signIn).resolves.toEqual(account);
      expect(tokenCalls(calls)[0].form.get("grant_type")).toBe(
        "urn:ietf:params:oauth:grant-type:device_code",
      );
      expect(tokenCalls(calls)[0].form.get("device_code")).toBe("device-1");
      expect(calls.at(-1)?.auth).toBe("OAuth access-1");
      expect(saved).toHaveBeenCalledWith(account);
      expect(auth.account).toEqual(account);
    });

    it("fails when the code expired", async () => {
      vi.useFakeTimers();
      stubFetch(({ url }) =>
        url === config.DEVICE_URL
          ? json(200, device)
          : json(400, { status: 400, message: "invalid device code" }),
      );

      const signIn = auth.signIn(vi.fn(), new AbortController().signal);
      const failed = expect(signIn).rejects.toThrow("invalid device code");
      await vi.advanceTimersByTimeAsync(5000);

      await failed;
      expect(saved).not.toHaveBeenCalled();
    });

    it("stops when aborted, with no request after", async () => {
      vi.useFakeTimers();
      const calls = stubFetch(() => json(200, device));
      const controller = new AbortController();

      const signIn = auth.signIn(vi.fn(), controller.signal);
      const failed = expect(signIn).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(1000);
      controller.abort();
      await vi.advanceTimersByTimeAsync(60_000);

      await failed;
      expect(calls).toHaveLength(1);
    });

    it("needs Tokio's client ID", async () => {
      const calls = stubFetch(() => json(200, device));
      auth = new TwitchAuth(config, () => "");

      await expect(
        auth.signIn(vi.fn(), new AbortController().signal),
      ).rejects.toThrow("client ID");
      expect(calls).toEqual([]);
    });
  });

  describe("refresh", () => {
    it("shares one refresh between two 401s, and saves the new token before using it", async () => {
      const tokens = [
        { access_token: "access-1", refresh_token: "refresh-2" },
        { access_token: "access-2", refresh_token: "refresh-3" },
      ];
      const calls = stubFetch(({ url, auth: header }) => {
        if (url === config.TOKEN_URL) return json(200, tokens.shift());
        return header === "Bearer access-2" ? json(200, {}) : json(401, {});
      });
      auth.setAccount({ id: "1", login: "streamer", key: "refresh-1" });
      await auth.refresh();
      let save!: (ok: boolean) => void;
      saved.mockImplementation(() => new Promise((r) => (save = r)));

      const requests = Promise.all([
        auth.request(`${config.HELIX_URL}/a`),
        auth.request(`${config.HELIX_URL}/b`),
      ]);
      await vi.waitFor(() => expect(tokenCalls(calls)).toHaveLength(2));
      await new Promise((r) => setTimeout(r, 10));
      // Nothing uses the new token until it's saved
      expect(calls.some((c) => c.auth === "Bearer access-2")).toBe(false);
      save(true);

      const res = await requests;
      expect(res.map((r) => r.status)).toEqual([200, 200]);
      expect(tokenCalls(calls)).toHaveLength(2);
      expect(tokenCalls(calls)[1].form.get("refresh_token")).toBe("refresh-2");
      expect(tokenCalls(calls)[1].form.get("grant_type")).toBe("refresh_token");
      expect(tokenCalls(calls)[1].form.has("client_secret")).toBe(false);
      expect(saved).toHaveBeenLastCalledWith({
        id: "1",
        login: "streamer",
        key: "refresh-3",
      });
    });

    it("clears the account Twitch refuses, and fails as badKey", async () => {
      stubFetch(() =>
        json(400, { status: 400, message: "Invalid refresh token" }),
      );
      auth.setAccount({ id: "1", login: "streamer", key: "refresh-1" });
      const onLost = vi.fn();
      auth.onLost = onLost;

      await expect(auth.request(`${config.HELIX_URL}/a`)).rejects.toMatchObject(
        { kind: "badKey" },
      );
      expect(saved).toHaveBeenCalledWith(NO_ACCOUNT);
      expect(auth.account).toEqual(NO_ACCOUNT);
      expect(auth.lost).toBe(true);
      expect(onLost).toHaveBeenCalled();
    });

    it("tells a rate limit with when to try again", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("{}", {
              status: 429,
              headers: {
                "Ratelimit-Reset": String(Math.ceil(Date.now() / 1000) + 30),
              },
            }),
        ),
      );
      auth.setAccount({ id: "1", login: "streamer", key: "refresh-1" });

      const failure = await auth.refresh().catch((err: unknown) => err);

      expect(failure).toMatchObject({
        kind: "rateLimited",
        retryAfterSeconds: expect.toBeOneOf([30, 31]),
      });
    });
  });

  it("revokes the token on sign-out and clears the account", async () => {
    const calls = stubFetch(({ url }) =>
      url === config.TOKEN_URL
        ? json(200, { access_token: "access-1", refresh_token: "refresh-2" })
        : json(200, {}),
    );
    auth.setAccount({ id: "1", login: "streamer", key: "refresh-1" });
    await auth.refresh();

    await auth.signOut();

    const revoke = calls.find((c) => c.url === config.REVOKE_URL);
    expect(revoke?.form.get("token")).toBe("access-1");
    expect(revoke?.form.get("client_id")).toBe("client");
    expect(saved).toHaveBeenLastCalledWith(NO_ACCOUNT);
    expect(auth.lost).toBe(false);
  });
});
