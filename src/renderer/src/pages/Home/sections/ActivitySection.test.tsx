import { ActivityItem } from "@/common/types";
import { Avatar } from "@/components";
import { renderWithProviders } from "@test/render";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivitySection } from "./ActivitySection";

// Counts the rows' renders: each row draws one Avatar
vi.mock("@/components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components")>();
  return { ...actual, Avatar: vi.fn(actual.Avatar) };
});

const user = (name: string) => ({ handle: name, name, picture: "" });

const feed = (joined: number): ActivityItem[] => [
  { id: 3, type: "join", users: [user("Ann"), user("Bo")], count: joined },
  { id: 2, type: "chat", user: user("Cy"), text: "hi", emotes: [] },
  { id: 1, type: "follow", user: user("Di") },
];

const section = (activity: ActivityItem[]) => (
  <ActivitySection
    connected
    activity={activity}
    feedOff={false}
    onFeedSettings={() => {}}
  />
);

describe("ActivitySection", () => {
  it("renders a row again only when its item changed", () => {
    const { rerender } = renderWithProviders(section(feed(2)));
    const avatar = vi.mocked(Avatar);
    expect(avatar).toHaveBeenCalledTimes(3);

    // A push brings the same items as new objects
    avatar.mockClear();
    rerender(section(feed(2)));
    expect(avatar).not.toHaveBeenCalled();

    // Another viewer joined
    rerender(section(feed(3)));
    expect(avatar).toHaveBeenCalledOnce();
  });

  it("shows a gift's price in its sender's platform's currency", () => {
    const gift = (
      id: number,
      platform: "tiktok" | "youtube",
      coins: number,
    ): ActivityItem => ({
      id,
      type: "gift",
      user: { ...user(platform), platform },
      gift: { name: "Rose", image: "", count: 1, coins },
    });
    renderWithProviders(section([gift(3, "youtube", 5), gift(1, "tiktok", 1)]));

    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual([
      // YouTube's Gifts have no price
      "Yyoutube sent Rose ",
      "Ttiktok sent Rose 1 coin",
    ]);
  });

  it("shows Kicks with the message pinned with them", () => {
    renderWithProviders(
      section([
        {
          id: 1,
          type: "kicks",
          user: { ...user("mia"), platform: "kick" },
          kicks: 100,
          text: "gg",
        },
      ]),
    );

    expect(screen.getByRole("listitem")).toHaveTextContent(
      "Mmia sent 100 Kicksgg",
    );
  });

  it("shows a chat's translation under it, led for screen readers", () => {
    const chat: ActivityItem = {
      id: 1,
      type: "chat",
      user: user("Kenji"),
      text: "where are you streaming from?",
      emotes: [],
      translation: { text: "¿desde dónde transmites?", from: "en", to: "es" },
    };
    renderWithProviders(section([chat]));

    expect(screen.getByText("where are you streaming from?")).toBeVisible();
    expect(screen.getByText("¿desde dónde transmites?")).toHaveAttribute(
      "lang",
      "es",
    );
    expect(screen.getByText("Translated from English:")).toBeInTheDocument();
  });

  it("shows no translation line for a chat without one", () => {
    renderWithProviders(section(feed(2)));

    expect(screen.queryByText(/Translated from/)).not.toBeInTheDocument();
  });
});
