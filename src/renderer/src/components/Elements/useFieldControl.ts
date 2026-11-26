import { createContext, useContext, useEffect, useId } from "react";

type FieldValue = {
  labelId: string;
  // The field's one control, which its label names
  control?: string;
  // Counts a control in, and returns its way out
  claim: (id: string) => () => void;
};

// Given by Field (components/Page), which ties its label to its control when
// it has one; null where a field's label shouldn't reach, like in a Modal
export const FieldContext = createContext<FieldValue | null>(null);

/**
 * A control's id in a Field, so the field's label can name it, and the
 * label's id when the control can't take a `<label for>` (a Select).
 */
export function useFieldControl(own?: string) {
  const field = useContext(FieldContext);
  const generated = useId();
  const id = own ?? generated;
  const claim = field?.claim;
  useEffect(() => claim?.(id), [claim, id]);
  return {
    id: field ? id : own,
    labelledBy: field?.control === id ? field.labelId : undefined,
  };
}
