import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import {
  CHARACTER_EFFECTS,
  CHARACTER_VOICES,
} from "../src/audio/character-effects.ts";
import { groups } from "../src/game/model.ts";
import coverage from "../assets/character-voices/coverage.json";
import choices from "../assets/character-voices/choices.json";
const events = ["drop", "merge", "win"] as const;
test("only 34 merge and 5 final-tier win recordings are shipped, with no unused assets", () => {
  assert.equal(Object.keys(CHARACTER_VOICES).length, 34);
  assert.equal(Object.keys(CHARACTER_EFFECTS).length, 34);
  const members = new Map(
    groups
      .flatMap((group) => group.members)
      .map((member) => [member.id, member]),
  );
  const finalIds = new Set(groups.at(-1)!.members.map((member) => member.id));
  const expectedWav: string[] = [];
  const expectedMp3: string[] = [];
  let count = 0;
  for (const [id, role] of Object.entries(CHARACTER_VOICES)) {
    assert.equal(members.get(id)?.name, role.name);
    const expectedEvents = finalIds.has(id) ? ["merge", "win"] : ["merge"];
    assert.deepEqual(
      events.filter((event) => role[event]),
      expectedEvents,
    );
    assert.deepEqual(
      Object.keys(CHARACTER_EFFECTS[id]!).sort(),
      expectedEvents,
    );
    const chosen = choices[role.characterId as keyof typeof choices];
    assert.ok(chosen);
    assert.deepEqual(Object.keys(chosen).sort(), expectedEvents);
    assert.equal(new Set(Object.values(chosen)).size, expectedEvents.length);
    for (const event of events) {
      const clip = role[event];
      if (!clip) continue;
      count++;
      assert.equal(
        clip.sourceFile,
        (chosen as Partial<Record<typeof event, string>>)[event],
      );
      assert.ok(clip.sourceFile.includes(role.characterId.slice(4)));
      assert.ok([...clip.text].length > 0 && [...clip.text].length <= 10);
      assert.ok(clip.durationSeconds > 0 && clip.durationSeconds <= 5);
      const wavPath = `assets/character-voices/wav/${id}/${event}.wav`;
      expectedWav.push(wavPath);
      const wav = readFileSync(wavPath);
      assert.equal(wav.subarray(0, 4).toString(), "RIFF");
      assert.equal(
        createHash("sha256").update(wav).digest("hex"),
        clip.sourceSha256,
      );
      assert.equal(clip.src, `/audio/characters/${id}/${event}.mp3`);
      expectedMp3.push(`public${clip.src}`);
      assert.ok(readFileSync(`public${clip.src}`).length > 0);
      assert.equal(CHARACTER_EFFECTS[id]?.[event], clip.src);
    }
  }
  assert.equal(count, 39);
  for (const [root, expected] of [
    ["assets/character-voices/wav", expectedWav],
    ["public/audio/characters", expectedMp3],
  ] as const) {
    const actual = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `${entry.parentPath}/${entry.name}`);
    assert.deepEqual(actual.sort(), expected.sort());
  }
});
test("coverage is derived from all 43 unique game members, including the 9 missing members", () => {
  const members = new Map(
    groups
      .flatMap((group) => group.members)
      .map((member) => [member.id, member]),
  );
  const missing = [...members.values()].filter(
    (member) => !CHARACTER_VOICES[member.id],
  );
  assert.equal(coverage.totalTalents, members.size);
  assert.equal(coverage.coveredTalents, Object.keys(CHARACTER_VOICES).length);
  assert.equal(coverage.selectedClips, 39);
  assert.deepEqual(coverage.events, ["merge", "win"]);
  assert.deepEqual(coverage.eventClips, { merge: 34, win: 5 });
  assert.equal(coverage.missing.length, 9);
  assert.deepEqual(
    coverage.missing.map((m) => m.id),
    missing.map((m) => m.id),
  );
  for (const group of groups) {
    const entry = coverage.groups.find((g) => g.id === group.id)!;
    assert.equal(entry.total, group.members.length);
    assert.equal(
      entry.covered,
      group.members.filter((m) => CHARACTER_VOICES[m.id]).length,
    );
  }
  assert.equal(
    createHash("sha256").update(readFileSync(coverage.sourceCsv)).digest("hex"),
    coverage.sourceCsvSha256,
  );
});
