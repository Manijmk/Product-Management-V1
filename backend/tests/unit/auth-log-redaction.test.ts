import { describe, expect, it } from "@jest/globals";
import { Writable } from "node:stream";
import pino from "pino";
import { SENSITIVE_LOG_PATHS } from "../../src/infrastructure/infrastructure.module.js";

describe("authentication log redaction", () => {
  it("redacts bearer tokens, passwords, and password hashes", () => {
    let output = "";
    const stream = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    const logger = pino({ redact: [...SENSITIVE_LOG_PATHS] }, stream);
    logger.info({
      req: { headers: { authorization: "Bearer jwt-secret" }, body: { password: "plain-secret" } },
      accessToken: "jwt-secret",
      password: "plain-secret",
      passwordHash: "argon-secret",
      password_hash: "argon-secret"
    });
    expect(output).not.toContain("jwt-secret");
    expect(output).not.toContain("plain-secret");
    expect(output).not.toContain("argon-secret");
  });
});
