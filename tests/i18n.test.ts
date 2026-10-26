import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTranslator,
  detectLocale,
  dictionaries,
  LANGUAGES,
  groupName,
  talentName,
} from "../src/i18n/core.ts";
import { API_ERRORS } from "../src/shared/api-errors.ts";
import { groups } from "../src/game/model.ts";
import type { MessageKey } from "../src/i18n/types.ts";
const slots = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
test("all locales have complete, nonempty messages with matching interpolation parameters", () => {
  const keys = Object.keys(dictionaries["zh-CN"]).sort() as MessageKey[];
  for (const { id } of LANGUAGES) {
    const messages = dictionaries[id];
    assert.deepEqual(Object.keys(messages).sort(), keys, id);
    for (const key of keys) {
      assert.ok(messages[key].trim(), `${id}: ${key}`);
      assert.deepEqual(
        slots(messages[key]),
        slots(dictionaries["zh-CN"][key]),
        `${id}: ${key}`,
      );
    }
    for (const code of Object.keys(API_ERRORS))
      assert.ok(messages[`error.${code}` as MessageKey]);
    for (const group of groups)
      assert.ok(messages[`group.${group.id}` as MessageKey]);
  }
});
test("language matching, interpolation and member labels work for Chinese, Japanese and English", () => {
  assert.equal(detectLocale(["fr-FR", "ja-JP"]), "ja");
  assert.equal(detectLocale(["en-GB"]), "en");
  assert.equal(detectLocale(["zh-TW", "en"]), "zh-CN");
  assert.equal(detectLocale(["de"]), "zh-CN");
  assert.equal(
    createTranslator("en")("score.improved", { score: "20,680" }),
    "Submitted 20,680 points. Your best score was updated.",
  );
  // Interpolation treats player-controlled names as literal text, including replacement tokens.
  assert.equal(
    createTranslator("en")("game.merged", { name: "$&{name}" }),
    "Merged: $&{name}",
  );
  assert.equal(
    talentName(groups[10].members[0], "en"),
    groups[10].members[0].en,
  );
  assert.equal(
    talentName(groups[10].members[0], "ja"),
    groups[10].members[0].name,
  );
  assert.equal(groupName(groups[10], "en"), "Generation 0");
});
