import { expect, test } from "nsh/test";
import { avatarUrlForUid } from "./avatarUrl";

// UCenter pads to nine digits and segments the first nine; a longer uid keeps its leading digits.
test("a uid longer than nine digits uses its first nine digits", () => {
  expect(avatarUrlForUid("1234567890", "small")).toBe(
    "https://img02.4d4y.com/forum/uc_server/data/avatar/123/45/67/89_avatar_small.jpg",
  );
  expect(avatarUrlForUid("7", "middle")).toBe(
    "https://img02.4d4y.com/forum/uc_server/data/avatar/000/00/00/07_avatar_middle.jpg",
  );
  expect(avatarUrlForUid("abc")).toBe(undefined);
});
