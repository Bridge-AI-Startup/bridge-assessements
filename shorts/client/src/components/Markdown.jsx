/**
 * Minimal markdown renderer for challenge prompts.
 *
 * Deliberately dependency-free and JSX-only: the Shorts client keeps a very
 * small dependency list, and returning React elements (never
 * dangerouslySetInnerHTML) means there is no HTML-injection surface at all.
 *
 * Supported: headings (#–####), bold, italic, inline code, fenced code blocks,
 * unordered + ordered lists, blockquotes, horizontal rules, links, paragraphs.
 * Not supported: tables, images, footnotes, nested lists. If prompts start
 * needing those, swap this for `react-markdown` — the call sites take a plain
 * `text` prop, so nothing else changes.
 */

const BLOCK_STARTER = /^(```|#{1,4}\s|>\s?|\s*[-*+]\s|\s*\d+[.)]\s)/;
const HR = /^(-{3,}|\*{3,}|_{3,})\s*$/;

// Only these schemes are turned into anchors — keeps `javascript:` out.
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))/g;

/** Parse inline spans into React nodes. */
function renderInline(text, keyPrefix = "i") {
  const nodes = [];
  let lastIndex = 0;
  let match;
  let n = 0;

  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${n++}`;

    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-mist px-1 py-0.5 font-mono text-[0.9em] text-ink"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={key} className="font-medium text-ink">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      nodes.push(
        SAFE_HREF.test(href) ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink underline"
          >
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function parseBlocks(input) {
  const lines = String(input || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence (or EOF)
      blocks.push({ type: "code", content: buf.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        content: heading[2],
      });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", content: buf.join(" ") });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Paragraph: soft-wrapped lines join until a blank line or a new block.
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !BLOCK_STARTER.test(lines[i]) &&
      !HR.test(lines[i])
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    if (buf.length) blocks.push({ type: "p", content: buf.join(" ") });
    else i++; // safety: never spin on an unconsumed line
  }

  return blocks;
}

const HEADING_CLASS = {
  1: "text-[19px] font-medium tracking-tight text-ink",
  2: "text-[17px] font-medium tracking-tight text-ink",
  3: "text-[15px] font-medium text-ink",
  4: "text-[14px] font-medium text-ink",
};

/**
 * @param {{ text?: string, className?: string }} props
 */
export default function Markdown({ text, className = "" }) {
  const blocks = parseBlocks(text);

  if (blocks.length === 0) return null;

  return (
    <div
      className={`space-y-3 text-[15px] leading-relaxed text-fog ${className}`}
    >
      {blocks.map((block, idx) => {
        const key = `b-${idx}`;
        switch (block.type) {
          case "heading": {
            const Tag = `h${Math.min(block.level + 1, 6)}`;
            return (
              <Tag key={key} className={HEADING_CLASS[block.level]}>
                {renderInline(block.content, key)}
              </Tag>
            );
          }
          case "code":
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-xl bg-mist p-3 font-mono text-[13px] leading-relaxed text-ink"
              >
                {block.content}
              </pre>
            );
          case "ul":
            return (
              <ul key={key} className="list-disc space-y-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="list-decimal space-y-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote
                key={key}
                className="border-l-2 border-line pl-3 italic"
              >
                {renderInline(block.content, key)}
              </blockquote>
            );
          case "hr":
            return <hr key={key} className="border-line" />;
          default:
            return <p key={key}>{renderInline(block.content, key)}</p>;
        }
      })}
    </div>
  );
}
