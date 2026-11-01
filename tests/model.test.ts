import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  clampDrop,
  createLineup,
  groups,
  HEIGHT,
  mergeLevel,
  mergePoints,
  RADII,
  randomDrop,
  WIDTH,
} from "../src/game/model.ts";
test("lineup contains one member from each Japanese debut group, newest to oldest", () => {
  assert.deepEqual(
    groups.map((g) => g.id),
    [
      "asobi-mawari-tai",
      "flow-glow",
      "regloss",
      "holox",
      "gen-5",
      "gen-4",
      "gen-3",
      "gamers",
      "gen-2",
      "1stgen",
      "gen-0",
    ],
  );
  for (const random of [() => 0, () => 0.499, () => 0.999999]) {
    const lineup = createLineup(random);
    assert.equal(lineup.length, 11);
    assert.equal(new Set(lineup.map((m) => m.id)).size, 11);
    lineup.forEach((member, i) =>
      assert.ok(groups[i].members.some((m) => m.id === member.id)),
    );
  }
});
test("all portraits have official PNG sources and deployed WebP files", () => {
  for (const member of groups.flatMap((g) => g.members)) {
    assert.ok(
      member.source.startsWith(
        "https://hololive.hololivepro.com/wp-content/uploads/",
      ),
    );
    assert.ok(
      member.url.startsWith("https://hololive.hololivepro.com/talents/"),
    );
    const source = `assets/avatars/${member.id}.png`;
    assert.ok(existsSync(source), member.id);
    assert.deepEqual(
      [...readFileSync(source).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.equal(member.image, `/avatars/${member.id}.webp`);
    const path = "public" + member.image;
    assert.ok(existsSync(path), member.id);
    const webp = readFileSync(path);
    assert.equal(webp.subarray(0, 4).toString("latin1"), "RIFF");
    assert.equal(webp.subarray(8, 12).toString("latin1"), "WEBP");
    // Deployed portraits stay small; the PNG originals are ~150 KB each.
    assert.ok(webp.length < 60_000, `${member.id}: ${webp.length} bytes`);
  }
});
test("only matching levels merge, maximum level stays on the board", () => {
  for (let a = 0; a < groups.length; a++)
    for (let b = 0; b < groups.length; b++)
      assert.equal(mergeLevel(a, b), a === b && a < 10 ? a + 1 : null);
  assert.equal(mergePoints(1), 4);
  assert.equal(mergePoints(10), 2048);
});
test("drop bounds keep every circular member inside the side walls", () => {
  assert.equal(RADII.length, groups.length);
  RADII.forEach((radius, level) => {
    assert.ok(level === 0 || radius > RADII[level - 1]);
    assert.ok(radius * 2 < WIDTH && radius * 2 < HEIGHT);
    assert.ok(clampDrop(-1000, level) - radius > 6);
    assert.ok(clampDrop(1000, level) + radius < WIDTH - 6);
  });
});
test("new drops are restricted to the three newest Japanese groups", () => {
  assert.equal(
    randomDrop(() => 0),
    0,
  );
  assert.equal(
    randomDrop(() => 0.649),
    0,
  );
  assert.equal(
    randomDrop(() => 0.65),
    1,
  );
  assert.equal(
    randomDrop(() => 0.919),
    1,
  );
  assert.equal(
    randomDrop(() => 0.92),
    2,
  );
  assert.equal(
    randomDrop(() => 0.99999),
    2,
  );
});
