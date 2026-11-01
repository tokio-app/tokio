import { MessageKey } from "@/common/i18n";

// Result of the last test events sent to a test overlay
export type TestStatus = "sent" | "no-client";

export const STATUS_LABELS: Record<TestStatus, MessageKey> = {
  sent: "tools.test.sent",
  "no-client": "tools.test.noClient",
};
