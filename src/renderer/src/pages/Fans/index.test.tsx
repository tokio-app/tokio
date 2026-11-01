import { APP_EVENTS, APP_EVENTS_RESPONSE, Fan } from "@/common/types";
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

    expect(sent(APP_EVENTS.GET_FANS)).toEqual([undefined]);
    expect(screen.getByRole("heading", { name: "Fans" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Back to Tools" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
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

  it("asks again when the profile changes", async () => {
    renderWithProviders(<Fans />);
    await fans([jules]);

    await send(APP_EVENTS_RESPONSE.GET_PROFILE, { success: false });
    expect(sent(APP_EVENTS.GET_FANS)).toHaveLength(1);

    await send(APP_EVENTS_RESPONSE.GET_PROFILE, profileReply());
    expect(sent(APP_EVENTS.GET_FANS)).toHaveLength(2);

    await fans([sofi]);
    expect(names()).toEqual(["Sofi Rose"]);
  });

  it("goes back to Tools", async () => {
    const { user, router } = await renderApp("/tools/fans");

    await user.click(screen.getByRole("button", { name: "Back to Tools" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/tools"));
  });
});
