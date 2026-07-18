import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(async () => {
  cleanup();
  const { resetDocumentSessions } = await import("../documents/sessionRegistry");
  await resetDocumentSessions({ discard: true });
});
