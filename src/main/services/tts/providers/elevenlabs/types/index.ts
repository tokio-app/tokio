export type VoicesResponse = {
  voices: { voice_id: string; name: string }[];
  has_more: boolean;
  next_page_token?: string | null;
};

export type CloneResponse = {
  voice_id: string;
  requires_verification?: boolean;
};

// A 422's detail is a list, and older errors' a string
export type ErrorResponse = {
  detail?:
    | string
    | { code?: string; status?: string; message?: string }
    | { msg?: unknown }[];
};
