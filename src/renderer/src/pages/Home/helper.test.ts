import { createAlert } from "@/pages/Alerts/helper";
import { describe, expect, it } from "vitest";
import { alertsStatus, joinedText, serverStatus, statText } from "./helper";

describe("statText", () => {
  it("gives the short number with the exact one for the title", () => {
    expect(statText(1234, true, "en")).toEqual({
      text: "1.2K",
      title: "1,234",
    });
  });

  it("gives dashes while offline", () => {
    expect(statText(1234, false, "en")).toEqual({
      text: "--",
      title: undefined,
    });
  });
});

describe("feature status", () => {
  it("counts one alert or overlay in the singular", () => {
    expect(alertsStatus([createAlert()], "en")).toBe("1 of 1 alert on");
    expect(serverStatus(true, 1, "en")).toBe("Running · 1 overlay");
  });
});

describe("joinedText", () => {
  const user = (name: string) => ({ handle: name, name, picture: "" });

  it("puts the verb in the number of viewers who joined", () => {
    expect(joinedText([user("kai")], 1, "es-419")).toBe("kai se unió");
    expect(joinedText([user("kai"), user("yui")], 2, "es-419")).toBe(
      "kai y yui se unieron",
    );
  });
});
