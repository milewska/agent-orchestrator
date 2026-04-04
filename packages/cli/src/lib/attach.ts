import { spawn } from "node:child_process";
import { shellEscape, type AttachInfo } from "@composio/ao-core";

export function formatAttachCommand(
  info: AttachInfo | null | undefined,
  fallbackCommand: string,
): string {
  if (!info) return fallbackCommand;
  if (info.command) return info.command;
  if (info.program) {
    return [info.program, ...(info.args ?? [])].map(shellEscape).join(" ");
  }
  return fallbackCommand;
}

export async function runAttachCommand(
  info: AttachInfo | null | undefined,
  fallback: { program: string; args: string[] },
): Promise<void> {
  const program = info?.program ?? fallback.program;
  const args = info?.program ? (info.args ?? []) : fallback.args;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`attach command exited with code ${code}`));
    });
  });
}
