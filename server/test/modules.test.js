// Modules partagés par les routes : cache mémoire, adresses Plex, mise en forme, validation.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryCache } from "../memory-cache.js";
import { createPlex, formatMediaItem, formatTrack, plexClientId, CLIENT_ID } from "../plex.js";
import { isPartKey, isPlexImagePath, clampInt } from "../validate.js";

describe("cache mémoire", () => {
  test("expiration et plafond d'entrées", async () => {
    const cache = createMemoryCache({ maxEntries: 2 });
    cache.set("a", 1, 60);
    cache.set("b", 2, 0.05);
    assert.equal(cache.get("a"), 1);
    cache.set("c", 3, 60); // "a", la plus ancienne, part
    assert.equal(cache.get("a"), null);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(cache.get("b"), null, "expirée");
    assert.equal(cache.get("c"), 3);
  });

  test("suppression par préfixe", () => {
    const cache = createMemoryCache();
    cache.set("show_detail_1", 1, 60);
    cache.set("show_detail_2", 2, 60);
    cache.set("api_hubs", 3, 60);
    cache.deletePrefix("show_detail_");
    assert.equal(cache.get("show_detail_1"), null);
    assert.equal(cache.get("show_detail_2"), null);
    assert.equal(cache.get("api_hubs"), 3);
  });
});

describe("Plex", () => {
  test("adresses signées par le token, identifiant par appareil", () => {
    const { plexUrl } = createPlex({ url: "http://plex:32400/", token: "t0k" });
    const u = new URL(plexUrl("/library/sections/1/all?sort=titleSort", { a: "1" }, plexClientId("abcdef12")));
    assert.equal(u.origin + u.pathname, "http://plex:32400/library/sections/1/all");
    assert.equal(u.searchParams.get("sort"), "titleSort");
    assert.equal(u.searchParams.get("X-Plex-Token"), "t0k");
    assert.equal(u.searchParams.get("X-Plex-Client-Identifier"), "nomad-abcdef12");
    assert.equal(plexClientId("../x"), CLIENT_ID);
  });

  test("piste mise en forme avec son flux audio", () => {
    const t = formatTrack({
      ratingKey: "7",
      type: "track",
      title: "One More Time",
      index: 1,
      thumb: "/library/metadata/7/thumb/1",
      Media: [{ Part: [{ id: 70, key: "/library/parts/70/file.mp3" }] }],
    });
    assert.equal(t.trackNumber, 1);
    assert.equal(t.streamUrl, "/api/stream/audio?key=%2Flibrary%2Fparts%2F70%2Ffile.mp3");
    assert.match(t.thumb, /width=300&height=300$/);
    assert.equal(formatMediaItem(null), null);
  });

  test("validation des chemins", () => {
    assert.ok(isPartKey("/library/parts/1/file.mp4"));
    assert.ok(!isPartKey("/library/parts/1/../../:/prefs"));
    assert.ok(isPlexImagePath("/library/metadata/1/thumb/2"));
    assert.ok(!isPlexImagePath("/:/prefs"));
    assert.equal(clampInt("9999", 300, 16, 2000), 2000);
    assert.equal(clampInt("abc", 300, 16, 2000), 300);
  });
});
