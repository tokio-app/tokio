import { AlertSound } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  MyInstantsSound,
  Reply,
} from "@/common/types";
import { intersect } from "@test/dom";
import { alertSound, failure, instantSound } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { MyInstantsTab } from "./MyInstantsTab";

const BRUH = instantSound("Bruh");
const VINE_BOOM = instantSound("Vine Boom");
const AIRHORN = instantSound("Airhorn");

type Props = ComponentProps<typeof MyInstantsTab>;

function setup(props: Partial<Props> = {}) {
  const all: Props = {
    id: "alert-1",
    hidden: false,
    library: [],
    testing: null,
    onTest: vi.fn(),
    onRequest: vi.fn(() => 4),
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    ...props,
  };
  const view = render(<MyInstantsTab {...all} />);
  const rerender = (patch: Partial<Props>) =>
    view.rerender(<MyInstantsTab {...all} {...patch} />);
  return { ...view, ...all, rerender, user: userEvent.setup() };
}

const results = (
  data: MyInstantsSound[],
  { query = "", page = 1, hasNextPage = false } = {},
) =>
  send(APP_EVENTS_RESPONSE.SEARCH_SOUNDS, {
    success: true,
    query,
    page,
    data,
    hasNextPage,
  });

const failed = (
  { query = "", page = 1 } = {},
  reply: Reply = failure("MyInstants is down."),
) =>
  send(APP_EVENTS_RESPONSE.SEARCH_SOUNDS, {
    ...reply,
    query,
    page,
    data: [],
    hasNextPage: false,
  });

const searches = () => sent(APP_EVENTS.SEARCH_SOUNDS);

const NAMES = ["Bruh", "Vine Boom", "Airhorn"];

const listed = () => NAMES.filter((name) => screen.queryByTitle(name) !== null);

// The row of a sound, by its name
const row = (name: string) => within(screen.getByTitle(name).parentElement!);

const downloads = () =>
  screen.queryAllByRole("button", { name: "Download and use this sound" });

const search = () => screen.getByPlaceholderText("Search sounds... (Enter)");

describe("MyInstantsTab", () => {
  it("loads trending sounds", () => {
    setup();

    expect(searches()).toEqual([{ query: "", page: 1 }]);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("No sounds found.")).not.toBeInTheDocument();
  });

  it("lists the sounds that come back", async () => {
    setup();

    await results([BRUH, VINE_BOOM]);

    expect(listed()).toEqual(["Bruh", "Vine Boom"]);
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("says when there are no sounds", async () => {
    setup();

    await results([]);

    expect(screen.getByText("No sounds found.")).toBeInTheDocument();
  });

  it("searches on Enter", async () => {
    const { user } = setup();
    await results([BRUH]);

    await user.type(search(), "vine{Enter}");

    expect(searches().at(-1)).toEqual({ query: "vine", page: 1 });
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await results([VINE_BOOM], { query: "vine" });
    expect(listed()).toEqual(["Vine Boom"]);
  });

  it("ignores results of another search or page", async () => {
    const { user } = setup();
    await user.type(search(), "vine{Enter}");

    await results([BRUH]);
    await results([AIRHORN], { query: "vine", page: 2 });

    expect(listed()).toEqual([]);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows a failure and tries the same page again", async () => {
    const { user } = setup();
    await user.type(search(), "vine{Enter}");

    await failed({ query: "vine" });

    expect(screen.getByText("MyInstants is down.")).toBeInTheDocument();
    expect(screen.queryByText("No sounds found.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(searches().at(-1)).toEqual({ query: "vine", page: 1 });
    expect(screen.queryByText("MyInstants is down.")).not.toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("says MyInstants can't be reached when the failure has no message", async () => {
    setup();

    await failed({}, { success: false });

    expect(screen.getByText("Unable to reach MyInstants.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("clears the last results when a new search fails", async () => {
    const { user } = setup();
    await results([BRUH, VINE_BOOM]);

    await user.type(search(), "air{Enter}");
    await failed({ query: "air" });

    expect(listed()).toEqual([]);
  });

  it("keeps the results when a next page fails, and retries that page", async () => {
    const { user } = setup();
    await results([BRUH], { hasNextPage: true });
    intersect();

    await failed({ page: 2 });

    expect(listed()).toEqual(["Bruh"]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(searches().at(-1)).toEqual({ query: "", page: 2 });
  });

  it("loads the next page at the end of the list", async () => {
    const { user } = setup();
    await user.type(search(), "b{Enter}");
    await results([BRUH, VINE_BOOM], { query: "b", hasNextPage: true });

    intersect();
    expect(searches().at(-1)).toEqual({ query: "b", page: 2 });
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    // MyInstants can list a sound again on the next page
    await results([VINE_BOOM, AIRHORN], {
      query: "b",
      page: 2,
      hasNextPage: true,
    });
    expect(listed()).toEqual(["Bruh", "Vine Boom", "Airhorn"]);
    expect(screen.getAllByTitle("Vine Boom")).toHaveLength(1);

    intersect();
    expect(searches().at(-1)).toEqual({ query: "b", page: 3 });
  });

  it("loads trending once first shown, and no next page while hidden", async () => {
    const { rerender } = setup({ hidden: true });
    expect(searches()).toEqual([]);

    rerender({ hidden: false });
    expect(searches()).toEqual([{ query: "", page: 1 }]);
    await results([BRUH], { hasNextPage: true });

    rerender({ hidden: true });
    intersect();
    expect(searches()).toHaveLength(1);

    rerender({ hidden: false });
    intersect();
    expect(searches()).toEqual([
      { query: "", page: 1 },
      { query: "", page: 2 },
    ]);
  });

  it("doesn't load the next page while loading", async () => {
    setup();
    intersect();
    expect(searches()).toHaveLength(1);

    await results([BRUH], { hasNextPage: true });
    intersect();
    intersect();

    expect(searches()).toEqual([
      { query: "", page: 1 },
      { query: "", page: 2 },
    ]);
  });

  it("doesn't load the next page after a failure", async () => {
    setup();
    await results([BRUH], { hasNextPage: true });
    intersect();
    await failed({ page: 2 });

    intersect();

    expect(searches()).toHaveLength(2);
  });

  it("doesn't load past the last page", async () => {
    setup();
    await results([BRUH], { hasNextPage: false });

    intersect();

    expect(searches()).toHaveLength(1);
  });

  it("plays a sound at the preview volume", async () => {
    const { user, onTest } = setup();
    await results([BRUH]);

    await user.click(row("Bruh").getByRole("button", { name: "Play" }));

    expect(onTest).toHaveBeenCalledWith({
      id: BRUH.url,
      url: BRUH.url,
      volume: 100,
    });
  });

  it("shows the sound being tested", async () => {
    setup({ testing: { id: BRUH.url, loading: true } });
    await results([BRUH, VINE_BOOM]);

    expect(row("Bruh").getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(
      row("Vine Boom").getByRole("button", { name: "Play" }),
    ).toBeVisible();
  });

  it("downloads a sound for the alert, one at a time", async () => {
    const library: AlertSound[] = [alertSound("Airhorn")];
    const { user, onRequest } = setup({ library });
    await results([BRUH, VINE_BOOM, AIRHORN]);
    const remove = screen.getByRole("button", {
      name: "Delete from your sounds",
    });

    await user.click(row("Bruh").getByRole("button", { name: /Download/ }));

    expect(sent(APP_EVENTS.DOWNLOAD_SOUND)).toEqual([
      { id: "alert-1", request: 4, url: BRUH.url, name: "Bruh" },
    ]);
    expect(onRequest).toHaveBeenCalledOnce();
    expect(downloads()).toHaveLength(2);
    for (const button of [...downloads(), remove]) {
      expect(button).toBeDisabled();
    }

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      success: true,
      id: "alert-2",
      request: 4,
      sound: alertSound("Bell"),
    });
    // A browsed file's reply for the alert
    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      success: true,
      id: "alert-1",
      request: 3,
      sound: alertSound("Bell"),
    });
    expect(remove).toBeDisabled();

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      ...failure(),
      id: "alert-1",
      request: 4,
    });
    for (const button of [...downloads(), remove]) {
      expect(button).toBeEnabled();
    }
  });

  it("picks a sound that's already in your sounds", async () => {
    const saved = { name: "My bruh", file: BRUH.file };
    const { user, onSelect } = setup({ library: [saved] });
    await results([BRUH, VINE_BOOM]);

    expect(
      row("Vine Boom").queryByRole("button", { name: "Vine Boom" }),
    ).not.toBeInTheDocument();
    expect(
      row("Bruh").queryByRole("button", { name: /Download/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Bruh" }));

    expect(onSelect).toHaveBeenCalledWith(saved);
  });

  it("asks to delete a sound from your sounds", async () => {
    const saved = alertSound("Bruh");
    const { user, onRemove } = setup({ library: [saved] });
    await results([BRUH]);

    await user.click(
      screen.getByRole("button", { name: "Delete from your sounds" }),
    );

    expect(onRemove).toHaveBeenCalledExactlyOnceWith(saved);
    expect(sent(APP_EVENTS.REMOVE_SOUND)).toEqual([]);
  });
});
