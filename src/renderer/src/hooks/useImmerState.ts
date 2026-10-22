import { produce } from "immer";
import { useCallback, useState } from "react";

// Mutates a draft of the value. Settings types have no readonly fields, so the
// draft has the value's own type.
export type Recipe<T> = (draft: T) => void;

// Applies a recipe to the value.
export type Updater<T> = (recipe: Recipe<T>) => void;

/**
 * useState whose updater takes an immer recipe, so nested fields can be
 * changed in place.
 */
export function useImmerState<T>(initial: T | (() => T)) {
  const [state, setState] = useState(initial);

  const update: Updater<T> = useCallback(
    (recipe) => setState((current) => produce<T, T>(current, recipe)),
    [],
  );

  return [state, update, setState] as const;
}

/**
 * Narrows an updater to one field, for components that edit part of a value.
 */
export function scopeUpdater<T, K extends keyof T>(
  update: Updater<T>,
  key: K,
): Updater<T[K]> {
  return (recipe) => update((draft) => recipe(draft[key]));
}
