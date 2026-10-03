import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import express from "express";
import { registerPhotoRoutes } from "../src/photos/routes.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==", "base64");

test("photo upload validates authority and bytes, persists a readable image, and bounds storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "chatroom-photos-test-"));
  const directory = join(root, ".private", "photos");
  const app = express();
  app.use(express.json());
  registerPhotoRoutes(app, {
    directory,
    maxStoredBytes: png.length * 2,
    roomExists: (room) => room === "photos",
    authorize: (req, res) => {
      if (req.header("x-chatroom-token") === "test-token") return true;
      res.sendStatus(401);
      return false;
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const upload = (body: Uint8Array, type = "image/png", token = "test-token", room = "photos") =>
    fetch(`${origin}/rooms/${room}/attachments`, { method: "POST", headers: { "content-type": type, "x-chatroom-token": token }, body: new Uint8Array(body).buffer });
  try {
    assert.equal((await upload(png, "image/png", "wrong")).status, 401);
    assert.equal((await upload(png, "image/svg+xml")).status, 415);
    assert.equal((await upload(Buffer.from("not an image"))).status, 415);
    assert.equal((await upload(png, "image/jpeg")).status, 415);
    assert.equal((await upload(png, "image/png", "test-token", "absent")).status, 404);
    assert.equal((await upload(Buffer.alloc(8 * 1024 * 1024 + 1))).status, 413);
    const response = await upload(png);
    assert.equal(response.status, 201);
    const image = await response.json() as { id: string; url: string; path: string };
    assert.match(image.url, /^\/attachments\/[a-f0-9-]{36}\.png$/);
    assert.deepEqual(await readFile(image.path), png, "agents can read the exact uploaded bytes");
    assert.equal((await stat(image.path)).mode & 0o777, 0o600);
    const retrieved = await fetch(origin + image.url);
    assert.equal(retrieved.headers.get("content-type"), "image/png");
    assert.equal(retrieved.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await retrieved.arrayBuffer()), png);
    assert.equal((await fetch(origin + "/attachments/not-a-photo")).status, 404);
    assert.equal((await upload(png)).status, 201);
    assert.equal((await upload(png)).status, 507);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
