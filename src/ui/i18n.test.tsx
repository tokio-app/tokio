import { APP_EVENTS_RESPONSE } from "@/common/types";
import { send } from "@test/ipc";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider, rich, useLanguage, useOptions, useT } from "./i18n";

function Shown() {
  const t = useT();
  const [option] = useOptions([{ value: 1, label: "nav.home" }] as const);
  return (
    <p>
      {useLanguage()} {t("nav.settings")} {option.label}
    </p>
  );
}

describe("LanguageProvider", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("gives English without a provider", () => {
    render(<Shown />);

    expect(screen.getByText("en Settings Home")).toBeInTheDocument();
  });

  it("starts in the language main loaded the page in, then follows main", async () => {
    window.history.replaceState(null, "", "/?lang=es-419");
    render(
      <LanguageProvider>
        <Shown />
      </LanguageProvider>,
    );

    expect(screen.getByText("es-419 Configuración Inicio")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("es-419");

    await send(APP_EVENTS_RESPONSE.LANGUAGE, "en");

    expect(screen.getByText("en Settings Home")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("works without the preload, as in the splash", () => {
    const api = window.api;
    // @ts-expect-error The splash window has no preload
    delete window.api;
    try {
      render(
        <LanguageProvider>
          <Shown />
        </LanguageProvider>,
      );
      expect(screen.getByText("en Settings Home")).toBeInTheDocument();
    } finally {
      window.api = api;
    }
  });
});

describe("rich", () => {
  const html = (nodes: ReturnType<typeof rich>) =>
    render(<p>{nodes}</p>).container.firstElementChild!.innerHTML;

  it("puts elements where the text has their tags and names", () => {
    expect(
      html(
        rich("Get a key from <link>Euler Stream</link>, then {input}.", {
          link: (children) => <a href="#">{children}</a>,
          input: <input />,
        }),
      ),
    ).toBe('Get a key from <a href="#">Euler Stream</a>, then <input>.');
  });

  it("leaves the names it isn't given as they are", () => {
    expect(
      html(
        rich("Add <script> or {username} to <b>{count}</b>", {
          count: <i>3</i>,
        }),
      ),
    ).toBe("Add &lt;script&gt; or {username} to &lt;b&gt;<i>3</i>&lt;/b&gt;");
    expect(rich("Plain", {})).toEqual(["Plain"]);
  });
});
