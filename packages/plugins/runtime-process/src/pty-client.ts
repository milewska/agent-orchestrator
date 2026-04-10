/**
 * pty-client.ts
 *
 * Client library for connecting to a pty-host's Windows named pipe.
 *
 * Used by:
 *   - runtime-process/src/index.ts  (sendMessage, getOutput, isAlive, destroy)
 *   - direct-terminal-ws.ts         (raw socket relay via connectPtyHost)
 */

import { connect, type Socket } from "node:net";
import {
  MSG_TERMINAL_INPUT,
  MSG_TERMINAL_DATA,
  MSG_RESIZE,
  MSG_GET_OUTPUT_REQ,
  MSG_GET_OUTPUT_RES,
  MSG_STATUS_REQ,
  MSG_STATUS_RES,
  MSG_KILL_REQ,
  encodeMessage,
  MessageParser,
} from "./pty-host.js";

// ---------------------------------------------------------------------------
// Re-exports for direct-terminal-ws
// ---------------------------------------------------------------------------

export { MSG_TERMINAL_DATA, MSG_TERMINAL_INPUT, MSG_RESIZE, MessageParser, encodeMessage };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PtyHostStatus {
  alive: boolean;
  pid: number;
  exitCode?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the Windows named pipe path for a given session ID.
 */
export function getPipePath(sessionId: string): string {
  return `\\\\.\\pipe\\ao-pty-${sessionId}`;
}

// ---------------------------------------------------------------------------
// connectPtyHost
// ---------------------------------------------------------------------------

/**
 * Connect to the pty-host named pipe. Resolves with the socket on success,
 * rejects on error or timeout.
 */
export function connectPtyHost(pipePath: string, timeoutMs = 3000): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    let settled = false;

    const sock = connect(pipePath);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(new Error(`Timed out connecting to pty-host at ${pipePath} (${timeoutMs}ms)`));
    }, timeoutMs);

    sock.once("connect", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(sock);
    });

    sock.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// ptyHostSendMessage
// ---------------------------------------------------------------------------

/**
 * Send a message (text command) to the PTY via a short-lived connection.
 * Appends a newline so the shell processes the command immediately.
 */
export async function ptyHostSendMessage(pipePath: string, message: string): Promise<void> {
  const sock = await connectPtyHost(pipePath);
  await new Promise<void>((resolve, reject) => {
    sock.once("error", reject);
    const frame = encodeMessage(MSG_TERMINAL_INPUT, message + "\r");
    sock.write(frame, (err) => {
      if (err) {
        sock.destroy();
        reject(err);
        return;
      }
      sock.end();
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// ptyHostGetOutput
// ---------------------------------------------------------------------------

/**
 * Request the last N lines of PTY output from the host.
 * Uses MessageParser to skip any MSG_TERMINAL_DATA frames that arrive before
 * the MSG_GET_OUTPUT_RES response.
 * Returns "" on timeout (3 s) or connection failure.
 */
export async function ptyHostGetOutput(pipePath: string, lines = 50): Promise<string> {
  let sock: Socket;
  try {
    sock = await connectPtyHost(pipePath, 3000);
  } catch {
    return "";
  }

  return new Promise<string>((resolve) => {
    let settled = false;

    const finish = (result: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => finish(""), 3000);

    const parser = new MessageParser((type, payload) => {
      if (type === MSG_GET_OUTPUT_RES) {
        finish(payload.toString("utf-8"));
      }
      // MSG_TERMINAL_DATA and other types are silently ignored
    });

    sock.on("data", (chunk: Buffer) => parser.feed(chunk));
    sock.once("error", () => finish(""));
    sock.once("close", () => finish(""));

    const req = encodeMessage(MSG_GET_OUTPUT_REQ, JSON.stringify({ lines }));
    sock.write(req);
  });
}

// ---------------------------------------------------------------------------
// ptyHostIsAlive
// ---------------------------------------------------------------------------

/**
 * Check whether the pty-host process is still alive.
 * Returns false if the pipe is unreachable (host has exited).
 */
export async function ptyHostIsAlive(pipePath: string): Promise<boolean> {
  let sock: Socket;
  try {
    sock = await connectPtyHost(pipePath, 2000);
  } catch {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), 2000);

    const parser = new MessageParser((type, payload) => {
      if (type === MSG_STATUS_RES) {
        try {
          const status = JSON.parse(payload.toString("utf-8")) as PtyHostStatus;
          finish(status.alive === true);
        } catch {
          finish(false);
        }
      }
      // Skip MSG_TERMINAL_DATA and other types
    });

    sock.on("data", (chunk: Buffer) => parser.feed(chunk));
    sock.once("error", () => finish(false));
    sock.once("close", () => finish(false));

    sock.write(encodeMessage(MSG_STATUS_REQ, ""));
  });
}

// ---------------------------------------------------------------------------
// ptyHostKill
// ---------------------------------------------------------------------------

/**
 * Send a kill request to the pty-host. Silently ignores errors — if the
 * pipe is unreachable the process is already dead.
 */
export async function ptyHostKill(pipePath: string): Promise<void> {
  let sock: Socket;
  try {
    sock = await connectPtyHost(pipePath, 2000);
  } catch {
    // Already dead — nothing to do
    return;
  }

  await new Promise<void>((resolve) => {
    sock.once("error", () => resolve());
    const frame = encodeMessage(MSG_KILL_REQ, "");
    sock.write(frame, () => {
      sock.end();
      resolve();
    });
  });
}
