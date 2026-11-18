import { StudioCounter, StudioElementOf } from "@/common/schemas";

type Props = {
  element: StudioElementOf<"bar">;
  // The overlay's counters, which a bar can fill toward its goal too
  counters: StudioCounter[];
  onChange: (element: StudioElementOf<"bar">) => void;
};

/** A goal bar's own fields (PR 4's bar work adds them). */
export function BarFields(_: Props) {
  return null;
}
