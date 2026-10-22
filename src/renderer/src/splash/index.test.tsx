import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplashScreen } from ".";

describe("SplashScreen", () => {
  it("shows the app starting, its version and the disclaimer", () => {
    render(<SplashScreen />);

    expect(screen.getByRole("img", { name: "Tokio" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.getByText("Starting up...")).toBeInTheDocument();
    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Not affiliated with, endorsed by, or associated with TikTok/,
      ),
    ).toBeInTheDocument();
  });
});
