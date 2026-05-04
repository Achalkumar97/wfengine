import { spawn } from "node:child_process";
import { z } from "zod";

const BridgeResultSchema = z.object({
  success: z.boolean().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  transcript: z
    .array(
      z.object({
        agent: z.string(),
        content: z.string(),
      }),
    )
    .optional(),
  finalAnswer: z.string().optional(),
});

/**
 * Optional bridge: run a Python module with JSON on stdin, JSON on stdout.
 * Your module should read stdin, run AutoGen/ag2, and print one JSON object.
 */
export async function runPythonAutogenBridge(opts: {
  pythonExecutable: string;
  modulePath: string;
  payload: unknown;
  timeoutMs: number;
}): Promise<z.infer<typeof BridgeResultSchema>> {
  const py = opts.pythonExecutable.trim() || "python3";
  const mod = opts.modulePath.trim();
  if (!mod) {
    throw new Error(
      "autogen: pythonModulePath is required for python_autogen / python bridge runtime",
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(py, ["-m", mod], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Python bridge timeout after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.stdout?.on("data", (d) => out.push(d));
    child.stderr?.on("data", (d) => err.push(d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stderr = Buffer.concat(err).toString("utf8");
      const stdout = Buffer.concat(out).toString("utf8");
      if (code !== 0 && code !== null) {
        reject(
          new Error(
            `Python bridge exited ${code}: ${stderr.slice(0, 1500) || stdout.slice(0, 1500)}`,
          ),
        );
        return;
      }
      try {
        const j = JSON.parse(stdout.trim()) as unknown;
        const parsed = BridgeResultSchema.safeParse(j);
        if (!parsed.success) {
          reject(new Error("Python bridge stdout was not valid bridge JSON"));
          return;
        }
        resolve(parsed.data);
      } catch (e) {
        reject(
          new Error(
            `Python bridge invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    });

    try {
      child.stdin?.write(JSON.stringify(opts.payload));
      child.stdin?.end();
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}
