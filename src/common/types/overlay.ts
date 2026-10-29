export type CustomGift = {
  value: number;
  label: string;
  img: string;
  coins: number;
};

// What an overlay reads for a field, or a table's cell
type FieldValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | CustomGift
  | CustomGift[]
  | undefined;

// A table gives its rows, each cell keyed by its column's id
type ConfigValue = FieldValue | { [id: string]: FieldValue }[];

export type OverlayConfigRedux = {
  [id: string]: ConfigValue;
};
