import { expect, test } from "nsh/test";
import { splitBrIntoParagraphs } from "./parse";

// The exact tag pairing does not matter — html5ever tolerates and corrects
// unclosed tags as a browser does. What matters is that every `<br>` becomes a
// paragraph boundary, so each visual line is its own block for the selection's
// hit-test.
test("each <br> becomes a paragraph boundary", () => {
  expect(splitBrIntoParagraphs("第一行<br>第二行")).toBe("第一行</p><p>第二行");
  expect(splitBrIntoParagraphs("a<br />b<br/>c")).toBe("a</p><p>b</p><p>c");
});

test("a <br> inside a quote is split, but a code block keeps its own line breaks", () => {
  expect(splitBrIntoParagraphs('<blockquote>a<br>b</blockquote>')).toBe("<blockquote>a</p><p>b</blockquote>");
  expect(splitBrIntoParagraphs("<pre><code>x<br>y</code></pre>tail<br>end")).toBe("<pre><code>x<br>y</code></pre>tail</p><p>end");
});

test("no <br> leaves the html untouched", () => {
  const html = "<p>one</p><p>two</p>";
  expect(splitBrIntoParagraphs(html)).toBe(html);
});

test("two consecutive <br> keep the blank line as an empty paragraph", () => {
  expect(splitBrIntoParagraphs("a<br><br>b")).toBe("a</p><p></p><p>b");
});
