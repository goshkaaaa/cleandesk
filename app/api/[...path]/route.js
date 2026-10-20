import { cookies } from "next/headers";
import sharp from "sharp";
import { store, Problem } from "../../../lib/store.js";
import { checkOrigin, limitedBody } from "../../../lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cookieName = "cleandesk_session";
const json = (value) =>
  Response.json(value, { headers: { "Cache-Control": "no-store" } });
async function handle(request, context) {
  try {
    const { path } = await context.params;
    const route = path.join("/");
    const database = store();
    const jar = await cookies();
    const token = jar.get(cookieName)?.value;
    if (request.method === "GET" && route === "session")
      return json({
        user: database.userFromToken(token),
        setupRequired: !database.workspace(),
      });
    if (request.method !== "GET") checkOrigin(request);
    let body = {};
    const photoUpload =
      request.method === "POST" && path[0] === "jobs" && path[2] === "photos";
    if (request.method !== "GET" && !photoUpload) {
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw new Problem(415, "Use JSON for this request.");
      try {
        body = JSON.parse((await limitedBody(request)).toString("utf8"));
      } catch (error) {
        if (error instanceof Problem) throw error;
        throw new Problem(400, "Invalid JSON request.");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new Problem(400, "A JSON object is required.");
    }
    if (
      request.method === "POST" &&
      ["setup", "login", "accept-invite"].includes(route)
    ) {
      const result =
        await database[route === "accept-invite" ? "acceptInvite" : route](
          body,
        );
      jar.set(cookieName, result.token, {
        httpOnly: true,
        secure:
          process.env.COOKIE_SECURE === "false"
            ? false
            : process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 30 * 86400,
      });
      return json({ user: result.user });
    }
    const user = database.requireUser(token);
    if (request.method === "POST" && route === "logout") {
      database.logout(token);
      jar.delete(cookieName);
      return json({ ok: true });
    }
    if (request.method === "GET" && route === "dashboard")
      return json(database.dashboard(user));
    if (request.method === "POST" && route === "homes")
      return json({ id: database.addHome(user, body) });
    if (request.method === "POST" && route === "invites")
      return json({ token: database.invite(user) });
    if (request.method === "POST" && route === "jobs")
      return json({ id: database.addJob(user, body) });
    if (request.method === "PATCH" && path[0] === "jobs" && path.length === 2) {
      database.updateJob(user, path[1], body);
      return json({ ok: true });
    }
    if (photoUpload && path.length === 3) {
      database.authorizeUpload(user, path[1]);
      const bytes = await limitedBody(request, 6 * 1024 * 1024);
      const form = await new Response(bytes, {
        headers: { "Content-Type": request.headers.get("content-type") || "" },
      }).formData();
      const file = form.get("photo");
      if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024)
        throw new Problem(400, "Choose a photo up to 5 MB.");
      let image;
      try {
        const processor = sharp(Buffer.from(await file.arrayBuffer()), {
          limitInputPixels: 20000000,
        });
        const metadata = await processor.metadata();
        if (!["jpeg", "png", "webp"].includes(metadata.format))
          throw new Error("Unsupported image type.");
        image = await processor
          .rotate()
          .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
      } catch {
        throw new Problem(
          400,
          "This image could not be decoded. Use a JPEG, PNG, or WebP photo.",
        );
      }
      return json({ id: database.addPhoto(user, path[1], image) });
    }
    if (path[0] === "photos" && path.length === 2) {
      if (request.method === "GET")
        return new Response(database.readPhoto(user, path[1]), {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      if (request.method === "DELETE") {
        database.removePhoto(user, path[1]);
        return json({ ok: true });
      }
    }
    throw new Problem(404, "Endpoint not found.");
  } catch (error) {
    if (error instanceof Problem)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    console.error("CleanDesk request failed:", error.message);
    return Response.json(
      { error: "The request could not be completed. Please try again." },
      { status: 500 },
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
