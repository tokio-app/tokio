import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "../Modal";
import { DateTimePicker, DateTimeValue, NO_DATE } from ".";

// Holds the value, as the LIVEs page does
function Form({
  initial = NO_DATE,
  withTime,
  onChange,
}: {
  initial?: DateTimeValue;
  withTime?: boolean;
  onChange: (value: DateTimeValue) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateTimePicker
      aria-label="From"
      value={value}
      withTime={withTime}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function setup(props: { initial?: DateTimeValue; withTime?: boolean } = {}) {
  const onChange = vi.fn();
  const result = renderWithProviders(<Form {...props} onChange={onChange} />);
  const trigger = screen.getByRole("button", { name: "From" });
  return { ...result, onChange, trigger };
}

const title = () => screen.getByRole("grid").getAttribute("aria-labelledby");
const month = () => document.getElementById(title() ?? "")?.textContent;
const day = (name: string) => screen.getByRole("button", { name });

describe("DateTimePicker", () => {
  beforeEach(() => {
    // Only Date, user-event still waits on real timers
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 21, 15, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
    history.replaceState(null, "", "/");
  });

  it("shows the value in English", () => {
    const { trigger } = setup({ initial: { date: "2026-10-10", time: "" } });
    expect(trigger).toHaveTextContent("Oct 10, 2026");
  });

  it("shows the time with the date", () => {
    const { trigger } = setup({
      initial: { date: "2026-10-10", time: "18:00" },
      withTime: true,
    });
    expect(trigger).toHaveTextContent("Oct 10, 2026, 6:00 PM");
    expect(trigger).toHaveAccessibleDescription("Oct 10, 2026, 6:00 PM");
  });

  it("shows the value in Spanish", () => {
    history.replaceState(null, "", "/?lang=es-419");
    const { trigger } = setup({
      initial: { date: "2026-10-10", time: "18:00" },
    });
    expect(trigger).toHaveTextContent("10 oct 2026, 6:00 p.m.");
  });

  it("shows a placeholder without a date", () => {
    const { trigger } = setup();
    expect(trigger).toHaveTextContent("Pick a date");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on a click, on today, and closes on a click outside", async () => {
    const { user, trigger } = setup();

    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "From" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(month()).toBe("October 2026");
    const today = day("Wednesday, October 21, 2026");
    expect(today).toHaveFocus();
    expect(today).toHaveAttribute("aria-current", "date");

    await user.click(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on the keys and gives the focus back on Escape", async () => {
    const { user, trigger } = setup({
      initial: { date: "2026-03-05", time: "" },
    });
    trigger.focus();

    await user.keyboard("{ArrowDown}");
    expect(month()).toBe("March 2026");
    expect(day("Thursday, March 5, 2026")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.keyboard(" ");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape before a modal it's in", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <Modal title="Filter" onClose={onClose}>
        <DateTimePicker aria-label="From" value={NO_DATE} onChange={vi.fn()} />
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "From" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "From" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves between months", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);

    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(month()).toBe("November 2026");
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(month()).toBe("September 2026");
  });

  it("picks a day and closes", async () => {
    const { user, trigger, onChange } = setup();
    await user.click(trigger);

    await user.click(day("Saturday, October 10, 2026"));

    expect(onChange).toHaveBeenCalledWith({ date: "2026-10-10", time: "" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveTextContent("Oct 10, 2026");
  });

  it("marks the picked day as selected", async () => {
    const { user, trigger } = setup({
      initial: { date: "2026-10-10", time: "" },
    });
    await user.click(trigger);

    const cell = day("Saturday, October 10, 2026").closest("td");
    expect(cell).toHaveAttribute("aria-selected", "true");
  });

  it("moves by days, weeks and months with the keys", async () => {
    const { user, trigger, onChange } = setup({
      initial: { date: "2026-10-10", time: "" },
    });
    await user.click(trigger);

    await user.keyboard("{ArrowRight}");
    expect(day("Sunday, October 11, 2026")).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(day("Friday, October 9, 2026")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(day("Friday, October 16, 2026")).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(day("Friday, October 2, 2026")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(month()).toBe("September 2026");
    expect(day("Friday, September 25, 2026")).toHaveFocus();

    await user.keyboard("{PageDown}{PageDown}");
    expect(month()).toBe("November 2026");
    expect(day("Wednesday, November 25, 2026")).toHaveFocus();
    await user.keyboard("{PageUp}");
    expect(day("Sunday, October 25, 2026")).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({
      date: "2026-10-25",
      time: "",
    });
  });

  it("keeps the last day of a shorter month", async () => {
    const { user, trigger } = setup({
      initial: { date: "2026-10-31", time: "" },
    });
    await user.click(trigger);

    await user.keyboard("{PageDown}");
    expect(day("Monday, November 30, 2026")).toHaveFocus();
  });

  it("goes to the week's start and end", async () => {
    const { user, trigger } = setup({
      initial: { date: "2026-10-14", time: "" },
    });
    await user.click(trigger);

    await user.keyboard("{Home}");
    expect(day("Sunday, October 11, 2026")).toHaveFocus();
    await user.keyboard("{End}");
    expect(day("Saturday, October 17, 2026")).toHaveFocus();
  });

  it("keeps one day in the Tab order", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);

    const days = within(screen.getByRole("grid")).getAllByRole("button");
    expect(days).toHaveLength(42);
    expect(days.filter((el) => el.tabIndex === 0)).toHaveLength(1);
  });

  it("starts the week on Sunday in English", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);

    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveAccessibleName("Sunday");
    expect(headers[0]).toHaveTextContent("S");
    const days = within(screen.getByRole("grid")).getAllByRole("button");
    expect(days[0]).toHaveAccessibleName("Sunday, September 27, 2026");
  });

  it("starts the week on Monday in Spanish", async () => {
    history.replaceState(null, "", "/?lang=es-419");
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "From" }));

    expect(month()).toBe("Octubre de 2026");
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveAccessibleName("lunes");
    expect(headers[0]).toHaveTextContent("L");
    const days = within(screen.getByRole("grid")).getAllByRole("button");
    expect(days[0]).toHaveAccessibleName("lunes, 28 de septiembre de 2026");
    expect(screen.getByRole("button", { name: "Mes siguiente" })).toBeVisible();
  });

  describe("with a time", () => {
    it("keeps the time fields off until a day is picked", async () => {
      const { user, trigger } = setup({ withTime: true });
      await user.click(trigger);

      expect(screen.getByRole("textbox", { name: "Hours" })).toBeDisabled();
    });

    it("stays open on a day, and sets the time on the 12-hour clock", async () => {
      const { user, trigger, onChange } = setup({ withTime: true });
      await user.click(trigger);

      await user.click(day("Saturday, October 10, 2026"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(onChange).toHaveBeenLastCalledWith({
        date: "2026-10-10",
        time: "",
      });

      const time = within(screen.getByRole("group", { name: "Time" }));
      await user.type(time.getByRole("textbox", { name: "Hours" }), "6");
      expect(onChange).toHaveBeenLastCalledWith({
        date: "2026-10-10",
        time: "06:00",
      });
      expect(time.getByRole("button", { name: "AM" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await user.click(time.getByRole("button", { name: "PM" }));
      expect(onChange).toHaveBeenLastCalledWith({
        date: "2026-10-10",
        time: "18:00",
      });

      const minutes = time.getByRole("textbox", { name: "Minutes" });
      await user.type(minutes, "5");
      expect(onChange).toHaveBeenLastCalledWith({
        date: "2026-10-10",
        time: "18:05",
      });
      await user.tab();
      expect(minutes).toHaveValue("05");

      await user.keyboard("{Escape}");
      expect(trigger).toHaveTextContent("Oct 10, 2026, 6:05 PM");
    });

    it("reads 12 as noon and midnight", async () => {
      const { user, trigger, onChange } = setup({
        initial: { date: "2026-10-10", time: "18:30" },
        withTime: true,
      });
      await user.click(trigger);

      const hours = screen.getByRole("textbox", { name: "Hours" });
      expect(hours).toHaveValue("6");
      await user.clear(hours);
      await user.type(hours, "12");
      expect(onChange).toHaveBeenLastCalledWith({
        date: "2026-10-10",
        time: "12:30",
      });

      await user.click(screen.getByRole("button", { name: "AM" }));
      expect(onChange).toHaveBeenLastCalledWith({
        date: "2026-10-10",
        time: "00:30",
      });
    });

    it("ignores an hour out of range", async () => {
      const { user, trigger, onChange } = setup({
        initial: { date: "2026-10-10", time: "" },
        withTime: true,
      });
      await user.click(trigger);

      await user.type(screen.getByRole("textbox", { name: "Hours" }), "13");
      expect(onChange).toHaveBeenLastCalledWith({
        date: "2026-10-10",
        time: "01:00",
      });
    });

    it("steps the time with the arrow keys, around the clock", async () => {
      const { user, trigger, onChange } = setup({
        initial: { date: "2026-10-10", time: "12:59" },
        withTime: true,
      });
      await user.click(trigger);

      await user.click(screen.getByRole("textbox", { name: "Minutes" }));
      await user.keyboard("{ArrowUp}");
      expect(onChange).toHaveBeenLastCalledWith({
        date: "2026-10-10",
        time: "12:00",
      });

      await user.click(screen.getByRole("textbox", { name: "Hours" }));
      await user.keyboard("{ArrowUp}");
      expect(onChange).toHaveBeenLastCalledWith({
        date: "2026-10-10",
        time: "13:00",
      });
    });

    it("clears the time, for the whole day", async () => {
      const { user, trigger, onChange } = setup({
        initial: { date: "2026-10-10", time: "18:00" },
        withTime: true,
      });
      await user.click(trigger);

      await user.click(screen.getByRole("button", { name: "Clear the time" }));

      expect(onChange).toHaveBeenLastCalledWith({
        date: "2026-10-10",
        time: "",
      });
      const hours = screen.getByRole("textbox", { name: "Hours" });
      expect(hours).toHaveValue("");
      expect(hours).toHaveFocus();
      expect(screen.getByRole("button", { name: "PM" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("uses a 24-hour clock where the language does", async () => {
      history.replaceState(null, "", "/?lang=en-GB");
      const { user, trigger, onChange } = setup({
        initial: { date: "2026-10-10", time: "" },
        withTime: true,
      });
      await user.click(trigger);

      await user.type(screen.getByRole("textbox", { name: "Hours" }), "18");

      expect(onChange).toHaveBeenLastCalledWith({
        date: "2026-10-10",
        time: "18:00",
      });
      expect(screen.queryByRole("button", { name: "PM" })).toBeNull();
    });
  });

  it("picks today", async () => {
    const { user, trigger, onChange } = setup({
      initial: { date: "2025-01-15", time: "" },
    });
    await user.click(trigger);

    await user.click(screen.getByRole("button", { name: "Today" }));

    expect(onChange).toHaveBeenLastCalledWith({ date: "2026-10-21", time: "" });
    expect(trigger).toHaveFocus();
  });

  it("shows today's month with a time", async () => {
    const { user, trigger, onChange } = setup({
      initial: { date: "2025-01-15", time: "09:00" },
      withTime: true,
    });
    await user.click(trigger);

    await user.click(screen.getByRole("button", { name: "Today" }));

    expect(onChange).toHaveBeenLastCalledWith({
      date: "2026-10-21",
      time: "09:00",
    });
    expect(month()).toBe("October 2026");
  });

  it("clears the value", async () => {
    const { user, trigger, onChange } = setup({
      initial: { date: "2026-10-10", time: "18:00" },
      withTime: true,
    });
    await user.click(trigger);

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(onChange).toHaveBeenLastCalledWith(NO_DATE);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent("Pick a date");
    expect(trigger).toHaveFocus();
  });
});
