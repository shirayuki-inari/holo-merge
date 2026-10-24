import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import {
  CHARACTER_EFFECTS,
  CHARACTER_VOICES,
} from "../src/audio/character-effects.ts";
import { groups } from "../src/game/model.ts";
import coverage from "../assets/character-voices/coverage.json";
import choices from "../assets/character-voices/choices.json";
const events = ["drop", "merge", "win"] as const;
test("34 supplied members each have three distinct clips backed by the copied original WAV", () => {
  assert.equal(Object.keys(CHARACTER_VOICES).length, 34);
  assert.equal(Object.keys(CHARACTER_EFFECTS).length, 34);
  const members = new Map(
    groups
      .flatMap((group) => group.members)
      .map((member) => [member.id, member]),
  );
  let count = 0;
  for (const [id, role] of Object.entries(CHARACTER_VOICES)) {
    assert.equal(members.get(id)?.name, role.name);
    assert.equal(
      new Set(events.map((event) => role[event].sourceFile)).size,
      3,
    );
    const chosen = choices[role.characterId as keyof typeof choices];
    assert.ok(chosen);
    for (const event of events) {
      const clip = role[event];
      count++;
      assert.equal(clip.sourceFile, chosen[event]);
      assert.ok(clip.sourceFile.includes(role.characterId.slice(4)));
      assert.ok([...clip.text].length > 0 && [...clip.text].length <= 10);
      assert.ok(clip.durationSeconds > 0 && clip.durationSeconds <= 5);
      const wav = readFileSync(
        `assets/character-voices/wav/${id}/${event}.wav`,
      );
      assert.equal(wav.subarray(0, 4).toString(), "RIFF");
      assert.equal(
        createHash("sha256").update(wav).digest("hex"),
        clip.sourceSha256,
      );
      assert.equal(clip.src, `/audio/characters/${id}/${event}.mp3`);
      assert.ok(existsSync(`public${clip.src}`));
      assert.equal(CHARACTER_EFFECTS[id]?.[event], clip.src);
    }
  }
  assert.equal(count, 102);
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
  assert.equal(coverage.selectedClips, 102);
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
