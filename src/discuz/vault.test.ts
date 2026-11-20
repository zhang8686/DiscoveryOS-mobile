import { expect, test } from "nsh/test";
import { parseVault } from "./vault";

test("a missing or damaged item reads as empty", () => {
  expect(parseVault(null)).toEqual({ creds: null, cookies: {} });
  expect(parseVault("not json")).toEqual({ creds: null, cookies: {} });
});

test("cookies come back, a password is never kept on Android", () => {
  const v = parseVault(JSON.stringify({ creds: { name: "u", pass: "a:b" }, cookies: { abc_auth: "x" } }));
  expect(v.creds).toBe(null);
  expect(v.cookies).toEqual({ abc_auth: "x" });
});

test("entries of the wrong shape are dropped", () => {
  const v = parseVault(JSON.stringify({ creds: { name: 1 }, cookies: { a: 1, b: "2" } }));
  expect(v.creds).toBe(null);
  expect(v.cookies).toEqual({ b: "2" });
});
