import { describe, expect, test } from "vitest";
import {
  normalizeAvatarImage,
  normalizeProjectAvatar,
  PROJECT_AVATAR_IMAGE_MAX_CHARS,
  PROJECT_AVATAR_IMAGE_MAX_MB,
} from "../projectAvatar";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("项目头像：自定义图片", () => {
  test("认内联图片 data URL", () => {
    expect(normalizeAvatarImage(PNG)).toBe(PNG);
    expect(normalizeAvatarImage("data:image/jpeg;base64,AAAA")).toBe("data:image/jpeg;base64,AAAA");
  });

  test("路径、非图片 data URL、空值一律当作没设置", () => {
    expect(normalizeAvatarImage("/Users/me/avatar.png")).toBeUndefined();
    expect(normalizeAvatarImage("data:text/plain;base64,AAAA")).toBeUndefined();
    expect(normalizeAvatarImage("")).toBeUndefined();
    expect(normalizeAvatarImage(undefined)).toBeUndefined();
    expect(normalizeAvatarImage(123)).toBeUndefined();
  });

  test("超过上限的图不收（projects.json 不该被一张图撑爆）", () => {
    const huge = PNG + "A".repeat(PROJECT_AVATAR_IMAGE_MAX_CHARS);
    expect(normalizeAvatarImage(huge)).toBeUndefined();
  });

  test("归一化时带着图片一起过，且能单独只剩图片", () => {
    expect(normalizeProjectAvatar({ image: PNG })).toEqual({ image: PNG });
    expect(normalizeProjectAvatar({ color: "blue", image: PNG, label: "ab" })).toEqual({
      color: "blue",
      image: PNG,
      label: "ab",
    });
    // 无效图片不会混进结果
    expect(normalizeProjectAvatar({ label: "ab", image: "/tmp/x.png" })).toEqual({ label: "ab" });
  });
});

describe("头像上限的两道闸要对得上", () => {
  test("后端允许的最大原图 base64 后仍在前端 3MB 的 data URL 上限内", () => {
    // 以前后端收 4MB、前端只认 3MB data URL：2.25MB 以上的图会被后端读出来、又被
    // normalizeAvatarImage 静默丢掉（用户点了选图却什么都没发生）。
    const rawBytes = PROJECT_AVATAR_IMAGE_MAX_MB * 1024 * 1024;
    const dataUrlChars = Math.ceil(rawBytes / 3) * 4 + "data:image/png;base64,".length;
    expect(dataUrlChars).toBeLessThan(PROJECT_AVATAR_IMAGE_MAX_CHARS);
    // 反过来也确认这个上限真的能过归一化（拿刚好到顶的 data URL 试）
    const atLimit = "data:image/png;base64," + "A".repeat(Math.ceil(rawBytes / 3) * 4);
    expect(normalizeAvatarImage(atLimit)).toBe(atLimit);
  });
});
