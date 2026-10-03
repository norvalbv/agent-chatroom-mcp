import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PHOTO_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(png|jpg|webp|gif)$/;
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export function photoDirectory(identity: string): string {
  return join(homedir(), ".local", "share", "agent-chatroom", "attachments", createHash("sha256").update(identity).digest("hex").slice(0, 24));
}

function matchesImage(bytes: Buffer, type: string): boolean {
  if (type === "image/png") return bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString("ascii", 12, 16) === "IHDR";
  if (type === "image/jpeg") return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (type === "image/gif") return bytes.length >= 13 && /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6));
  return type === "image/webp" && bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

export function registerPhotoRoutes(app: Express, options: {
  directory: string;
  maxStoredBytes?: number;
  roomExists: (room: string) => boolean;
  authorize: (req: Request, res: Response) => boolean;
}): void {
  const limit = options.maxStoredBytes ?? 256 * 1024 * 1024;
  let used = 0, windowStart = 0, uploads = 0;
  let storageReady: Promise<void> | undefined;
  const prepare = () => storageReady ??= (async () => {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    for (const file of await readdir(options.directory)) {
      if (PHOTO_ID.test(file)) used += (await stat(join(options.directory, file))).size;
    }
  })();
  app.post("/rooms/:room/attachments", (req: Request, res: Response, next: NextFunction) => {
    if (!options.authorize(req, res)) return;
    if (!options.roomExists(String(req.params.room))) { res.status(404).send("Room not found"); return; }
    if (!TYPES[req.header("content-type") ?? ""]) { res.status(415).send("Choose a PNG, JPEG, WebP or GIF photo"); return; }
    if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); uploads = 0; }
    if (++uploads > 30) { res.status(429).set("Retry-After", "60").send("Too many photo uploads; try again in a minute"); return; }
    next();
  }, express.raw({ type: Object.keys(TYPES), limit: MAX_IMAGE_BYTES }), async (req: Request, res: Response) => {
    const bytes = req.body;
    const type = req.header("content-type")!;
    if (!Buffer.isBuffer(bytes) || !matchesImage(bytes, type)) { res.status(415).send("The file does not match a supported photo format"); return; }
    try { await prepare(); } catch { res.status(503).send("Photo storage is unavailable"); return; }
    if (used + bytes.length > limit) { res.status(507).send("Photo storage is full"); return; }
    used += bytes.length;
    const id = `${randomUUID()}.${TYPES[type]}`, path = join(options.directory, id);
    try {
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      res.status(201).json({ id, url: `/attachments/${id}`, path });
    } catch {
      used -= bytes.length;
      res.status(503).send("The photo could not be saved; please retry");
    }
  }, (error: { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.type === "entity.too.large" ? 413 : 400).send(error.type === "entity.too.large" ? "Each photo must be no larger than 8 MB" : "The photo upload could not be read");
  });
  app.get("/attachments/:id", (req, res) => {
    const id = String(req.params.id);
    if (!PHOTO_ID.test(id)) { res.sendStatus(404); return; }
    res.set({ "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, max-age=86400" });
    res.sendFile(id, { root: options.directory, dotfiles: "allow" }, (error) => { if (error && !res.headersSent) res.sendStatus(404); });
  });
}
