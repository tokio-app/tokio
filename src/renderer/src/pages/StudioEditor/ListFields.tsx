import { StudioElementOf } from "@/common/schemas";

type Props = {
  element: StudioElementOf<"list">;
  onChange: (element: StudioElementOf<"list">) => void;
};

/** A list's own fields (PR 4's list work adds them). */
export function ListFields(_: Props) {
  return null;
}
