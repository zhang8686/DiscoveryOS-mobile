// Uploaded avatars live at a path derived from the numeric uid on the image
// host. A static .jpg URL is loaded directly by <Image>: no JS request, no
// runtime base64, no per-author profile lookup. Members without a picture get
// a 404 and the embedded placeholder stays visible.
const AVATAR_BASE = "https://img02.4d4y.com/forum/uc_server/data/avatar/";

/**
 * `undefined` when the row has no usable numeric uid. The file is written per size: `small` is
 * 48 px (a list row), `middle` 120 px (a floor's card, which is drawn larger and on a denser
 * screen). Both are static files — no PHP request, and cacheable — while `avatar.php` on the
 * forum host renders the same picture through a script, one request at a time.
 */
export function avatarUrlForUid(uid?: string, size: "small" | "middle" = "small"): string | undefined {
  if (!uid || !/^\d+$/.test(uid)) return undefined;
  // UCenter pads to at least nine digits and segments the FIRST nine; a longer uid is not cut
  // from the end, which would build a path for a different member.
  const n = uid.padStart(9, "0").slice(0, 9);
  return `${AVATAR_BASE}${n.slice(0, 3)}/${n.slice(3, 5)}/${n.slice(5, 7)}/${n.slice(7, 9)}_avatar_${size}.jpg`;
}
