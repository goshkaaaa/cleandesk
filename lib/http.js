import { Problem } from "./store.js";
export async function limitedBody(request, limit = 32000) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new Problem(413, "This upload is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new Problem(400, "A request body is required.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Problem(413, "This upload is too large.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export function checkOrigin(request) {
  const expected = new URL(
    process.env.APP_ORIGIN ||
      `${new URL(request.url).protocol}//${request.headers.get("host") || new URL(request.url).host}`,
  ).origin;
  if (request.headers.get("origin") !== expected)
    throw new Problem(403, "The request origin is not allowed.");
}
