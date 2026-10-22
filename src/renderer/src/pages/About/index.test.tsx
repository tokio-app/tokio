import {
  AboutInfo,
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  LicenseText,
  UpdateStatus,
} from "@/common/types";
import { REPOSITORY_URL } from "@/common/util";
import { failure, packageLicense } from "@test/fixtures";
import { send, sent, sentEvents } from "@test/ipc";
import { section } from "@test/queries";
import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { About } from ".";
import { COMPONENTS, SERVICES } from "./helper";

const PACKAGES = [
  packageLicense("gpl-tool", {
    id: "gpl-tool@2.4.1",
    version: "2.4.1",
    license: "GPL-3.0-only",
    copyleft: true,
    author: "Jane Doe",
    url: "https://github.com/example/gpl-tool",
  }),
  packageLicense("react", { id: "react@19.2.1", version: "19.2.1" }),
  packageLicense("zod", { id: "zod@4.1.0", version: "4.1.0" }),
];

const ABOUT: AboutInfo = {
  versions: { electron: "39.2.0", chrome: "142.0.7444.59", node: "22.20.0" },
  packages: PACKAGES,
  documents: [
    { id: "LGPL-3.0", title: "GNU Lesser General Public License v3.0" },
    { id: "notices", title: "Third-party notices" },
  ],
};

const MIT: LicenseText = {
  id: "tokio",
  title: "Tokio (MIT License)",
  text: "MIT License\n\nCopyright (c) 2026\n\n# Not a heading",
};

const LGPL: LicenseText = {
  id: "LGPL-3.0",
  title: "GNU Lesser General Public License v3.0",
  text: "GNU LESSER GENERAL PUBLIC LICENSE\n   Version 3, 29 June 2007",
};

const NOTICES: LicenseText = {
  id: "notices",
  title: "Third-party notices",
  markdown: true,
  text: [
    "# Third-party notices",
    "",
    "- [GNU LGPL v3](LICENSES/LGPL-3.0.txt)",
    "- [Tokio's license](LICENSE)",
    "- [edge-tts](https://github.com/rany2/edge-tts)",
    "- [Release notes](docs/RELEASES.md)",
  ].join("\n"),
};

const about = (data = ABOUT) =>
  send(APP_EVENTS_RESPONSE.GET_ABOUT, { success: true, data });

const status = (data: UpdateStatus) =>
  send(APP_EVENTS_RESPONSE.UPDATE_STATUS, data);

const license = (data: LicenseText) =>
  send(APP_EVENTS_RESPONSE.GET_LICENSE_TEXT, {
    success: true,
    id: data.id,
    data,
  });

const dialog = () => within(screen.getByRole("dialog"));

const packages = () => section("Open-source packages");

const loading = (el: HTMLElement) =>
  within(el).queryByRole("status", { name: "Loading" }) !== null;

const opened = () => sent(APP_EVENTS.GET_LICENSE_TEXT).map(({ id }) => id);

describe("About", () => {
  it("asks main for the app info, the connection and the update status", () => {
    renderWithProviders(<About />);

    expect(sentEvents()).toEqual([
      APP_EVENTS.GET_UPDATE_STATUS,
      APP_EVENTS.GET_ABOUT,
      APP_EVENTS.IS_CONNECTED,
    ]);
  });

  it("shows the version, then the versions Tokio runs on", async () => {
    renderWithProviders(<About />);
    expect(
      screen.getByText(`Version ${__APP_VERSION__}`, { exact: true }),
    ).toBeInTheDocument();

    await about();

    expect(
      screen.getByText(
        `Version ${__APP_VERSION__} · Electron 39.2.0 · Chromium 142.0.7444.59 · Node 22.20.0`,
      ),
    ).toBeInTheDocument();
  });

  it("says where updates stand", async () => {
    renderWithProviders(<About />);
    expect(
      screen.getByText("Tokio hasn't checked for updates yet."),
    ).toBeInTheDocument();

    await status({ state: "none", checkedAt: Date.now() });
    expect(screen.getByText("Tokio is up to date.")).toBeInTheDocument();

    await status({ state: "downloading", version: "1.2.0", percent: 40 });
    expect(
      screen.getByText("Downloading Tokio 1.2.0… 40%"),
    ).toBeInTheDocument();
  });

  it("checks for updates, loading until main answers", async () => {
    const { user } = renderWithProviders(<About />);
    const check = screen.getByRole("button", { name: "Check for updates" });

    await user.click(check);

    expect(sent(APP_EVENTS.CHECK_UPDATES)).toHaveLength(1);
    expect(check).toHaveAttribute("aria-busy", "true");

    await send(APP_EVENTS_RESPONSE.CHECK_UPDATES, { success: true });

    expect(check).not.toHaveAttribute("aria-busy");
    expect(check).toHaveTextContent("Check for updates");
  });

  it("loads while the updater checks or downloads", async () => {
    renderWithProviders(<About />);
    const check = screen.getByRole("button", { name: "Check for updates" });

    await status({ state: "checking" });
    expect(check).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Checking for updates…")).toBeInTheDocument();

    await status({ state: "downloading", version: "1.2.0", percent: 5 });
    expect(check).toHaveAttribute("aria-busy", "true");

    await status({ state: "none", checkedAt: Date.now() });
    expect(check).not.toHaveAttribute("aria-busy");
  });

  it("shows why a check failed until the next one", async () => {
    const { user } = renderWithProviders(<About />);
    await status({ state: "none", checkedAt: Date.now() });
    const check = screen.getByRole("button", { name: "Check for updates" });

    await user.click(check);
    await send(
      APP_EVENTS_RESPONSE.CHECK_UPDATES,
      failure("Couldn't check for updates. Check your connection."),
    );

    expect(
      screen.getByText("Couldn't check for updates. Check your connection."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Tokio is up to date.")).not.toBeInTheDocument();

    await user.click(check);

    expect(
      screen.queryByText("Couldn't check for updates. Check your connection."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Tokio is up to date.")).toBeInTheDocument();
  });

  it("can't check for updates in a build without them", async () => {
    renderWithProviders(<About />);

    await status({ state: "unsupported" });

    expect(
      screen.getByText("Updates aren't available in this build."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeDisabled();
  });

  it("offers to restart instead of checking once an update is ready", async () => {
    const { user } = renderWithProviders(<About />);

    await status({ state: "ready", version: "1.2.0" });

    expect(
      screen.getByText("Tokio 1.2.0 is ready to install."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Check for updates" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Restart to update/ }));

    expect(sent(APP_EVENTS.INSTALL_UPDATE)).toHaveLength(1);
  });

  it("asks before restarting while a LIVE is connected", async () => {
    const { user } = renderWithProviders(<About />);
    await status({ state: "ready", version: "1.2.0" });
    await send(APP_EVENTS_RESPONSE.CONNECTED, {
      success: true,
      stats: { views: 0, viewers: 0, likes: 0 },
    });

    await user.click(screen.getByRole("button", { name: /Restart to update/ }));

    expect(dialog().getByText("Restart to update?")).toBeInTheDocument();
    expect(sent(APP_EVENTS.INSTALL_UPDATE)).toEqual([]);
  });

  it("links the release page next to Check for updates on macOS", async () => {
    renderWithProviders(<About />);

    await status({
      state: "available",
      version: "1.2.0",
      manual: true,
      url: "https://github.com/tokio-app/tokio/releases/tag/v1.2.0",
    });

    expect(
      screen.getByText(
        "Tokio 1.2.0 is available. Download it from the release page.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Download update/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeEnabled();
  });

  it("opens the source code", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { user } = renderWithProviders(<About />);

    await user.click(screen.getByRole("button", { name: "Source code" }));

    expect(open).toHaveBeenCalledWith(REPOSITORY_URL);
  });

  it("opens Tokio's licenses and the notices", async () => {
    const { user } = renderWithProviders(<About />);

    for (const name of ["MIT license", "Third-party notices"]) {
      await user.click(screen.getByRole("button", { name }));
      await user.click(dialog().getByRole("button", { name: "Close" }));
    }

    expect(opened()).toEqual(["tokio", "notices"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("loads a license, then shows its plain text", async () => {
    const { user } = renderWithProviders(<About />);

    await user.click(screen.getByRole("button", { name: "MIT license" }));

    expect(dialog().getByRole("heading", { name: "License" })).toBeVisible();
    expect(loading(screen.getByRole("dialog"))).toBe(true);

    await license(MIT);

    expect(loading(screen.getByRole("dialog"))).toBe(false);
    expect(
      dialog().getByRole("heading", { name: MIT.title }),
    ).toBeInTheDocument();
    const text = screen.getByRole("dialog").querySelector("pre");
    expect(text?.textContent).toBe(MIT.text);
    expect(
      dialog().queryByRole("heading", { name: "Not a heading" }),
    ).not.toBeInTheDocument();
  });

  it("renders the notices' markdown", async () => {
    const { user } = renderWithProviders(<About />);
    await user.click(
      screen.getByRole("button", { name: "Third-party notices" }),
    );

    await license(NOTICES);

    expect(
      dialog().getByRole("heading", { level: 1, name: "Third-party notices" }),
    ).toBeInTheDocument();
    expect(dialog().getByRole("link", { name: "edge-tts" })).toHaveAttribute(
      "href",
      "https://github.com/rany2/edge-tts",
    );
    expect(screen.getByRole("dialog").querySelector("pre")).toBeNull();
  });

  it("opens the licenses the notices link to", async () => {
    const { user } = renderWithProviders(<About />);
    await user.click(
      screen.getByRole("button", { name: "Third-party notices" }),
    );
    await license(NOTICES);

    await user.click(dialog().getByRole("link", { name: "GNU LGPL v3" }));

    expect(opened()).toEqual(["notices", "LGPL-3.0"]);
    expect(dialog().getByRole("heading", { name: "License" })).toBeVisible();
    expect(loading(screen.getByRole("dialog"))).toBe(true);

    await license({ id: "LGPL-3.0", title: "GNU LGPL v3", text: "LGPL" });
    await user.click(
      screen.getByRole("button", { name: "Third-party notices" }),
    );
    await license(NOTICES);
    await user.click(dialog().getByRole("link", { name: "Tokio's license" }));

    expect(opened()).toEqual(["notices", "LGPL-3.0", "notices", "tokio"]);
  });

  it("opens the notices' other links in the browser", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { user } = renderWithProviders(<About />);
    await user.click(
      screen.getByRole("button", { name: "Third-party notices" }),
    );
    await license(NOTICES);

    await user.click(dialog().getByRole("link", { name: "edge-tts" }));
    await user.click(dialog().getByRole("link", { name: "Release notes" }));

    expect(open.mock.calls).toEqual([
      ["https://github.com/rany2/edge-tts"],
      [`${REPOSITORY_URL}/blob/main/docs/RELEASES.md`],
    ]);
    expect(opened()).toEqual(["notices"]);
    expect(
      dialog().getByRole("heading", { name: "Third-party notices", level: 3 }),
    ).toBeInTheDocument();
  });

  it("closes the license when it can't be loaded", async () => {
    const { user } = renderWithProviders(<About />);
    await user.click(screen.getByRole("button", { name: "MIT license" }));

    await send(APP_EVENTS_RESPONSE.GET_LICENSE_TEXT, {
      ...failure(),
      id: "tokio",
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the license open when another one fails", async () => {
    const { user } = renderWithProviders(<About />);
    await user.click(screen.getByRole("button", { name: "MIT license" }));

    await send(APP_EVENTS_RESPONSE.GET_LICENSE_TEXT, {
      ...failure(),
      id: "LGPL-3.0",
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ignores the text of another license", async () => {
    const { user } = renderWithProviders(<About />);
    await user.click(screen.getByRole("button", { name: "MIT license" }));

    await license(LGPL);

    expect(dialog().getByRole("heading", { name: "License" })).toBeVisible();
    expect(loading(screen.getByRole("dialog"))).toBe(true);
  });

  it("shows a loader until the packages arrive", async () => {
    renderWithProviders(<About />);
    const list = screen
      .getByRole("heading", { name: "Open-source packages" })
      .closest("section")!;
    expect(loading(list)).toBe(true);
    expect(
      packages().getByText(
        "The npm packages shipped with Tokio and their licenses.",
      ),
    ).toBeInTheDocument();

    await about();

    expect(loading(list)).toBe(false);
    expect(
      packages().getByText(
        "The 3 npm packages shipped with Tokio and their licenses. Copyleft licenses are listed first.",
      ),
    ).toBeInTheDocument();
    for (const { name, version, license: spdx } of PACKAGES) {
      expect(packages().getByText(name)).toBeInTheDocument();
      expect(packages().getByText(version)).toBeInTheDocument();
      expect(packages().getAllByText(spdx).length).toBeGreaterThan(0);
    }
    expect(packages().getByText("Jane Doe")).toBeInTheDocument();
    expect(
      packages().getByRole("link", { name: "Repository" }),
    ).toHaveAttribute("href", "https://github.com/example/gpl-tool");
  });

  it("says when the packages couldn't be loaded", async () => {
    renderWithProviders(<About />);

    await send(APP_EVENTS_RESPONSE.GET_ABOUT, failure());

    expect(
      packages().getByText("The package list couldn't be loaded."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Version ${__APP_VERSION__}`, { exact: true }),
    ).toBeInTheDocument();
  });

  it("searches the packages by name or license", async () => {
    const { user } = renderWithProviders(<About />);
    await about();
    const search = packages().getByPlaceholderText("Search by name or license");
    const shown = () =>
      PACKAGES.map(({ name }) => name).filter(
        (name) => packages().queryByText(name) !== null,
      );

    await user.type(search, "React");
    expect(shown()).toEqual(["react"]);

    await user.clear(search);
    await user.type(search, " gpl ");
    expect(shown()).toEqual(["gpl-tool"]);

    await user.clear(search);
    await user.type(search, "lodash ");
    expect(shown()).toEqual([]);
    expect(
      packages().getByText('No package matches "lodash".'),
    ).toBeInTheDocument();

    await user.clear(search);
    expect(shown()).toHaveLength(3);
  });

  it("opens a package's license", async () => {
    const { user } = renderWithProviders(<About />);
    await about();

    const buttons = packages().getAllByRole("button", { name: "View license" });
    await user.click(buttons[1]);

    expect(opened()).toEqual(["react@19.2.1"]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("lists the components, with the licenses Tokio ships", async () => {
    const { user } = renderWithProviders(<About />);
    const components = section("Third-party components");

    for (const { name, author } of COMPONENTS) {
      expect(components.getByText(name)).toBeInTheDocument();
      expect(components.getAllByText(author).length).toBeGreaterThan(0);
    }

    const docs = COMPONENTS.flatMap(({ doc }) => (doc ? [doc] : []));
    const buttons = components.getAllByRole("button", { name: "View license" });
    expect(buttons).toHaveLength(docs.length);
    expect(docs.length).toBeLessThan(COMPONENTS.length);

    for (const button of buttons) {
      await user.click(button);
      await user.click(dialog().getByRole("button", { name: "Close" }));
    }
    expect(opened()).toEqual(docs);
  });

  it("lists the online services Tokio talks to", () => {
    renderWithProviders(<About />);
    const services = section("Online services");

    for (const { name, note } of SERVICES) {
      expect(services.getByText(name)).toBeInTheDocument();
      expect(services.getByText(note)).toBeInTheDocument();
    }
  });
});
