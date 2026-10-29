import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPOSER_FOCUS_ATTACHMENT_LIMIT,
  COMPOSER_MATERIALS_MENU_ITEMS,
  composerAttachmentAccessLabel,
  composerFocusCapacityHint,
  composerMaterialsTierLabel
} from "./composer-materials-policy.ts";

test("exposes three-tier materials menu copy", () => {
  assert.equal(COMPOSER_MATERIALS_MENU_ITEMS.length, 3);
  assert.deepEqual(
    COMPOSER_MATERIALS_MENU_ITEMS.map((item) => item.tier),
    ["focus", "workspace", "data"]
  );
  assert.match(COMPOSER_MATERIALS_MENU_ITEMS[0].detail, /光标处/);
  assert.match(COMPOSER_MATERIALS_MENU_ITEMS[1].detail, /不占用焦点/);
  assert.match(COMPOSER_MATERIALS_MENU_ITEMS[2].detail, /不走聊天附件/);
});

test("formats focus capacity hints without encouraging attachment stuffing", () => {
  assert.equal(composerFocusCapacityHint(0), "");
  assert.equal(composerFocusCapacityHint(2), `焦点材料 2/${COMPOSER_FOCUS_ATTACHMENT_LIMIT}`);
  assert.match(composerFocusCapacityHint(5), /指针不是集装箱/);
  assert.match(composerFocusCapacityHint(COMPOSER_FOCUS_ATTACHMENT_LIMIT), /已满/);
  assert.match(composerFocusCapacityHint(COMPOSER_FOCUS_ATTACHMENT_LIMIT), /数据场景/);
});

test("labels local vs copied attachment access", () => {
  assert.equal(composerAttachmentAccessLabel("local"), "本地引用");
  assert.equal(composerAttachmentAccessLabel("copied"), "已缓存");
  assert.equal(composerAttachmentAccessLabel(undefined), "已缓存");
  assert.equal(composerMaterialsTierLabel("data"), "大数据");
});
