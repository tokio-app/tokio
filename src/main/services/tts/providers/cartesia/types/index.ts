export type VoicesResponse = {
  data: { id: string; name: string; language?: string }[];
  has_more: boolean;
  next_page?: string | null;
};

export type CloneResponse = { id: string };

// The format isn't documented: read every shape seen
export type ErrorResponse = {
  error?: string | { message?: string; code?: string };
  message?: string;
  detail?: string;
  title?: string;
  code?: string;
};
