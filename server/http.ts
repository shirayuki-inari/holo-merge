import { API_ERRORS, type ApiErrorCode } from "../src/shared/api-errors.ts";
import { groups } from "../src/game/model.ts";
const avatars = new Set(groups.flatMap((g) => g.members.map((m) => m.id)));
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
  ) {
    super(API_ERRORS[code]);
  }
}
export function fail(status: number, code: ApiErrorCode): never {
  throw new ApiError(status, code);
}
export async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function profile(body: Record<string, unknown>) {
  if (typeof body.name !== "string" || typeof body.avatar !== "string")
    fail(400, "profileRequired");
  const name = body.name.normalize("NFKC").trim();
  if ([...name].length < 1 || [...name].length > 16 || /[\p{C}<>]/u.test(name))
    fail(400, "invalidName");
  if (!avatars.has(body.avatar)) fail(400, "invalidAvatar");
  return { name, avatar: body.avatar };
}
export async function readBody(
  request: Request,
  maxBody = 160_000,
): Promise<Record<string, unknown>> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    fail(415, "jsonRequired");
  if (Number(request.headers.get("content-length")) > maxBody)
    fail(413, "bodyTooLarge");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "bodyRequired");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBody) {
      await reader.cancel();
      fail(413, "bodyTooLarge");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(400, "invalidBody");
    return value;
  } catch {
    return fail(400, "invalidBody");
  }
}
