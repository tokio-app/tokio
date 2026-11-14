export type Model = {
  _id: string;
  type: "svc" | "tts";
  title: string;
  state: "created" | "training" | "trained" | "failed";
  languages?: string[];
};

export type VoicesResponse = {
  total: number;
  items: Model[];
  has_more?: boolean | null;
};

export type ErrorResponse = {
  status?: number;
  message?: string;
  reason?: string;
};

export type CloneResponse = {
  _id: string;
  state: string;
};
