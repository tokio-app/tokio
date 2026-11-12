import { ActivityItem } from "@/common/types";
import { Avatar } from "@/components";
import { renderWithProviders } from "@test/render";
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
});
