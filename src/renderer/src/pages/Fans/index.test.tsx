import { APP_EVENTS, APP_EVENTS_RESPONSE, Fan, Platform } from "@/common/types";
import { fan, profileReply } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderApp, renderWithProviders } from "@test/render";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Fans } from ".";

// Local time, so the date reads the same in any time zone
const SATURDAY = new Date(2026, 9, 31, 19, 0).getTime();

const jules = fan("Jules Pixel", 32, { handle: "jules.pixel10" });
const sofi = fan("Sofi Rose", 28, { handle: "sofi.rose21" });
const kai = fan("Kai", 3, { username: "", handle: "kai_r" });

const fans = (list: Fan[]) => send(APP_EVENTS_RESPONSE.FANS, { data: list });

const list = () => screen.getByRole("list", { name: "Fans" });
const rows = () => within(list()).getAllByRole("listitem");
const row = (name: string) =>
  within(rows().find((r) => r.textContent?.includes(name))!);
const names = () =>
  rows().map((r) => r.querySelector("[class*=name]")?.textContent);

describe("Fans", () => {
  it("shows the header and a spinner until the fans come", () => {
    renderWithProviders(<Fans />);

    expect(sent(APP_EVENTS.GET_PROFILE)).toEqual([undefined]);
    expect(screen.getByRole("heading", { name: "Fans" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Back to Tools" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("says who is a Super Fan, next to their name", async () => {
    renderWithProviders(<Fans />);
    await fans([{ ...jules, superfan: true }, sofi]);

    expect(row("Jules Pixel").getByText("Super Fan")).toBeInTheDocument();
    expect(row("Sofi Rose").queryByText("Super Fan")).toBeNull();
    // The name stays apart from the word
    expect(names()).toEqual(["Jules Pixel", "Sofi Rose"]);
  });

  it("shows only the Super Fans while the toggle is on, with the search", async () => {
    const { user } = renderWithProviders(<Fans />);
    await fans([
      { ...jules, superfan: true },
      sofi,
      { ...fan("Kai Moon", 2), superfan: true },
    ]);
    const only = screen.getByRole("checkbox", { name: "Super Fans only" });

    await user.click(only);
    expect(names()).toEqual(["Jules Pixel", "Kai Moon"]);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText("Name or @handle"), "kai");
    expect(names()).toEqual(["Kai Moon"]);

    await user.click(only);
    await user.clear(screen.getByPlaceholderText("Name or @handle"));
    expect(names()).toEqual(["Jules Pixel", "Sofi Rose", "Kai Moon"]);
  });

  it("says when there are no Super Fans yet", async () => {
    const { user } = renderWithProviders(<Fans />);
    await fans([sofi]);

    await user.click(screen.getByRole("checkbox", { name: "Super Fans only" }));

    expect(screen.getByText(/^No Super Fans yet\./)).toBeInTheDocument();
  });

  it("keeps main's order", async () => {
    renderWithProviders(<Fans />);
    // Main sorts by level, then by when they were seen
    await fans([sofi, jules, kai]);

    expect(names()).toEqual(["Sofi Rose", "Jules Pixel", "kai_r"]);
    expect(row("Jules Pixel").getByText("@jules.pixel10")).toBeInTheDocument();
  });

  it("shows the level with its badge, and names it for screen readers", async () => {
    renderWithProviders(<Fans />);
    await fans([jules, fan("Ana", 5, { fanBadge: "" })]);

    const badge = rows()[0].querySelector("img")!;
    expect(badge).toHaveAttribute("src", jules.fanBadge);
    expect(badge).toHaveAttribute("alt", "");
    expect(row("Jules Pixel").getByText("32")).toHaveAttribute("aria-hidden");
    expect(row("Jules Pixel").getByText("Level 32")).toBeInTheDocument();
    // No badge leaves the level alone
    expect(row("Ana").getByText("Level 5")).toBeInTheDocument();
    expect(rows()[1].querySelector("img")).toBeNull();

    fireEvent.error(badge);

    expect(rows()[0].querySelector("img")).toBeNull();
    expect(row("Jules Pixel").getByText("Level 32")).toBeInTheDocument();
  });

  it("says when Tokio last saw them", async () => {
    renderWithProviders(<Fans />);
    await fans([{ ...jules, seenAt: SATURDAY }]);

    expect(row("Jules Pixel").getByText("Seen Oct 31, 2026")).toBeVisible();
  });

  it("searches by name or handle, with or without the @", async () => {
    const { user } = renderWithProviders(<Fans />);
    await fans([jules, sofi, kai]);

    await user.click(screen.getByRole("button", { name: "Search" }));
    const input = screen.getByPlaceholderText("Name or @handle");

    await user.type(input, "ROSE");
    expect(names()).toEqual(["Sofi Rose"]);

    await user.clear(input);
    await user.type(input, "@kai_");
    expect(names()).toEqual(["kai_r"]);

    await user.clear(input);
    await user.type(input, "pixel10");
    expect(names()).toEqual(["Jules Pixel"]);

    await user.clear(input);
    await user.type(input, "zed");
    expect(screen.getByText("No fans match “zed”.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close search" }));
    expect(names()).toEqual(["Jules Pixel", "Sofi Rose", "kai_r"]);
  });

  it("says what fills the list when there are no fans", async () => {
    renderWithProviders(<Fans />);
    await fans([]);

    expect(screen.getByText(/^No fans yet\./)).toBeInTheDocument();
  });

  it("asks for the fans with the profile, and again on each switch", async () => {
    renderWithProviders(<Fans />);
    expect(sent(APP_EVENTS.GET_FANS)).toHaveLength(0);

    // Even a failed one, so the list never waits on the profile
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, { success: false });
    expect(sent(APP_EVENTS.GET_FANS)).toEqual([undefined]);
    await fans([jules]);

    await send(APP_EVENTS_RESPONSE.GET_PROFILE, profileReply());
    expect(sent(APP_EVENTS.GET_FANS)).toHaveLength(2);

    await fans([sofi]);
    expect(names()).toEqual(["Sofi Rose"]);
  });

  describe("platforms", () => {
    const profile = (...platforms: Platform[]) =>
      send(
        APP_EVENTS_RESPONSE.GET_PROFILE,
        profileReply((p) => {
          p.platforms = platforms;
        }),
      );
    const tabs = () =>
      within(screen.getByRole("tablist", { name: "Platform" }))
        .getAllByRole("tab")
        .map((tab) => tab.textContent);
    const pick = (name: string) => screen.getByRole("tab", { name });
    // Another platform's fan, as main records them
    const sub = (name: string, platform: Platform, patch: Partial<Fan> = {}) =>
      fan(name, 0, { platform, superfan: true, fanBadge: "", ...patch });

    const ana = sub("Ana Twitch", "twitch", { months: 14, seenAt: 3 });
    const leo = sub("Leo Twitch", "twitch", { seenAt: 5 });
    const mia = sub("Mia Tube", "youtube", { months: 1, seenAt: 4 });
    const max = sub("Max Kick", "kick", { seenAt: 1 });

    it("has no tab row with one platform", async () => {
      renderWithProviders(<Fans />);
      await profile("twitch");
      await fans([ana]);

      expect(screen.queryByRole("tablist")).toBeNull();
      expect(names()).toEqual(["Ana Twitch"]);
      expect(
        screen.queryByRole("checkbox", { name: "Super Fans only" }),
      ).toBeNull();
    });

    it("has a tab for the profile's platforms and the fans', then All", async () => {
      renderWithProviders(<Fans />);
      await profile("kick", "tiktok");
      await fans([jules, mia]);

      expect(tabs()).toEqual(["TikTok", "YouTube", "Kick", "All"]);
      expect(pick("TikTok")).toHaveAttribute("aria-selected", "true");
      expect(names()).toEqual(["Jules Pixel"]);
    });

    it("keeps the picked tab while it's there", async () => {
      const { user } = renderWithProviders(<Fans />);
      await profile("tiktok");
      await fans([jules, mia]);

      await user.click(pick("YouTube"));
      await fans([sofi, mia]);
      expect(pick("YouTube")).toHaveAttribute("aria-selected", "true");
      expect(names()).toEqual(["Mia Tube"]);

      // YouTube's fan went, and its tab with them
      await fans([sofi]);
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(names()).toEqual(["Sofi Rose"]);
    });

    it("leads another platform's rows with their months, else what they are", async () => {
      const { user } = renderWithProviders(<Fans />);
      await profile("tiktok", "twitch", "youtube", "kick");
      await fans([jules, ana, leo, mia, max]);

      await user.click(pick("Twitch"));
      // Main's order
      expect(names()).toEqual(["Ana Twitch", "Leo Twitch"]);
      expect(row("Ana Twitch").getByText("14")).toBeInTheDocument();
      expect(row("Ana Twitch").getByText("14").parentElement).toHaveTextContent(
        /^14 months$/,
      );
      expect(row("Leo Twitch").getByText("Subscriber")).toBeInTheDocument();
      expect(row("Ana Twitch").getByText("@ana-twitch")).toBeInTheDocument();
      // Every one is a subscriber, so the word stays TikTok's
      expect(screen.queryByText("Super Fan")).toBeNull();
      expect(rows()[0].querySelector("img")).toBeNull();

      await user.click(pick("YouTube"));
      expect(row("Mia Tube").getByText("1").parentElement).toHaveTextContent(
        /^1 month$/,
      );

      await user.click(pick("Kick"));
      expect(row("Max Kick").getByText("Subscriber")).toBeInTheDocument();
    });

    it("says YouTube's are members", async () => {
      const { user } = renderWithProviders(<Fans />);
      await profile("tiktok", "youtube");
      await fans([{ ...mia, months: undefined }]);

      await user.click(pick("YouTube"));
      expect(row("Mia Tube").getByText("Member")).toBeInTheDocument();
    });

    it("lists everyone on All, the most recently seen first, with their platform", async () => {
      const { user } = renderWithProviders(<Fans />);
      await profile("tiktok", "twitch", "youtube", "kick");
      await fans([{ ...jules, seenAt: 2, superfan: true }, ana, leo, mia, max]);

      await user.click(pick("All"));

      expect(names()).toEqual([
        "Leo Twitch",
        "Mia Tube",
        "Ana Twitch",
        "Jules Pixel",
        "Max Kick",
      ]);
      expect(row("Jules Pixel").getByText("Level 32")).toBeInTheDocument();
      expect(row("Jules Pixel").getByText("Super Fan")).toBeInTheDocument();
      expect(row("Jules Pixel").getByTitle("TikTok")).toBeInTheDocument();
      // The icon stands in for the badge
      expect(rows()[3].querySelector("img")).toBeNull();
      expect(row("Ana Twitch").getByTitle("Twitch")).toBeInTheDocument();
      expect(row("Ana Twitch").getByText("14")).toBeInTheDocument();
      expect(row("Mia Tube").getByTitle("YouTube")).toBeInTheDocument();
      expect(row("Max Kick").getByTitle("Kick")).toBeInTheDocument();
      expect(row("Max Kick").getByText("Subscriber")).toBeInTheDocument();
    });

    it("shows the Super Fans switch on TikTok's tab alone", async () => {
      const { user } = renderWithProviders(<Fans />);
      await profile("tiktok", "twitch");
      await fans([{ ...jules, superfan: true }, sofi, ana]);
      const only = () =>
        screen.queryByRole("checkbox", { name: "Super Fans only" });

      await user.click(only()!);
      expect(names()).toEqual(["Jules Pixel"]);

      await user.click(pick("Twitch"));
      expect(only()).toBeNull();
      expect(names()).toEqual(["Ana Twitch"]);

      // All lists everyone, whatever TikTok's switch says
      await user.click(pick("All"));
      expect(only()).toBeNull();
      expect(names()).toHaveLength(3);
    });

    it("says what fills each tab when it's empty", async () => {
      const { user } = renderWithProviders(<Fans />);
      await profile("tiktok", "twitch", "youtube", "kick");
      await fans([]);

      expect(screen.getByText(/^No fans yet\. Viewers/)).toBeInTheDocument();
      await user.click(pick("Twitch"));
      expect(screen.getByText(/^No subscribers yet\./)).toBeInTheDocument();
      await user.click(pick("Kick"));
      expect(screen.getByText(/^No subscribers yet\./)).toBeInTheDocument();
      await user.click(pick("YouTube"));
      expect(screen.getByText(/^No members yet\./)).toBeInTheDocument();
      await user.click(pick("All"));
      expect(
        screen.getByText(/^No fans yet\. TikTok fans/),
      ).toBeInTheDocument();
    });

    it("searches the tab shown", async () => {
      const { user } = renderWithProviders(<Fans />);
      await profile("tiktok", "twitch");
      await fans([jules, ana, leo]);

      await user.click(pick("Twitch"));
      await user.click(screen.getByRole("button", { name: "Search" }));
      const input = screen.getByPlaceholderText("Name or @handle");

      await user.type(input, "leo");
      expect(names()).toEqual(["Leo Twitch"]);

      await user.clear(input);
      await user.type(input, "jules");
      expect(screen.getByText("No fans match “jules”.")).toBeInTheDocument();

      await user.click(pick("All"));
      expect(names()).toEqual(["Jules Pixel"]);
    });
  });

  it("goes back to Tools", async () => {
    const { user, router } = await renderApp("/tools/fans");

    await user.click(screen.getByRole("button", { name: "Back to Tools" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/tools"));
  });
});
