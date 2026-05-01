/** Resolve refs and fetch file contents via GitHub REST API (Contents API). */

import { ghJson } from "./gh-fetch.js";

export async function resolveCommitSha(
  owner: string,
  repo: string,
  ref: string,
  token: string | undefined,
): Promise<string> {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const tries = [
    `${base}/git/ref/heads/${encodeURIComponent(ref)}`,
    `${base}/git/ref/tags/${encodeURIComponent(ref)}`,
  ];
  for (const path of tries) {
    try {
      const r = await ghJson<{ object: { sha: string; type?: string } }>(
        path,
        token,
      );
      const typ = r.object.type;
      if (typ === "commit" || !typ) return r.object.sha;
      if (typ === "tag") {
        const tag = await ghJson<{ object: { sha: string; type: string } }>(
          `${base}/git/tags/${r.object.sha}`,
          token,
        );
        if (tag.object.type === "commit") return tag.object.sha;
      }
    } catch {
      /* try next */
    }
  }
  const commit = await ghJson<{ sha: string }>(
    `${base}/commits/${encodeURIComponent(ref)}`,
    token,
  );
  return commit.sha;
}

/**
 * Returns UTF-8 file text, or `null` if not a file or not base64 (e.g. submodule, directory).
 */
export async function fetchRepoFileUtf8(
  owner: string,
  repo: string,
  filePath: string,
  refSha: string,
  token: string | undefined,
): Promise<string | null> {
  const encoded = filePath
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  const data = await ghJson<{
    content?: string;
    encoding?: string;
    type?: string;
  }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encoded}?ref=${encodeURIComponent(refSha)}`,
    token,
  );
  if (data.type !== "file" || !data.content || data.encoding !== "base64") {
    return null;
  }
  return Buffer.from(data.content, "base64").toString("utf8");
}
