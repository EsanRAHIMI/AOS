/**
 * Renders a parsed assistant reply (D-189).
 *
 * Builds React elements from `parseBlocks` output — never
 * `dangerouslySetInnerHTML`. Model output is untrusted text; giving it an HTML
 * channel to the DOM would be a real injection path, and the structure we need
 * (headings, lists, key/value rows) does not require one.
 *
 * Every text node carries its own direction, so a Persian sentence and a Latin
 * identifier in the same reply each read correctly.
 */
import type { Block, Inline } from '@/lib/richtext';
import { parseBlocks } from '@/lib/richtext';
import { bidiProps } from '@/lib/rtl';

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.t === 'strong') return <strong key={i} {...bidiProps(s.v)}>{s.v}</strong>;
        if (s.t === 'code') return <code key={i} className="rt-code" dir="ltr">{s.v}</code>;
        return <span key={i} {...bidiProps(s.v)}>{s.v}</span>;
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading':
      return <h4 className="rt-h" {...bidiProps(block.text)}>{block.text}</h4>;

    case 'paragraph':
      return <p className="rt-p"><Spans spans={block.spans} /></p>;

    case 'quote':
      return <blockquote className="rt-quote"><Spans spans={block.spans} /></blockquote>;

    case 'code':
      return <pre className="rt-pre" dir="ltr"><code>{block.text}</code></pre>;

    case 'bullets':
      return (
        <ul className="rt-ul">
          {block.items.map((item, i) => <li key={i}><Spans spans={item} /></li>)}
        </ul>
      );

    case 'numbers':
      return (
        <ol className="rt-ol">
          {block.items.map((item, i) => <li key={i}><Spans spans={item} /></li>)}
        </ol>
      );

    case 'facts':
      return (
        <dl className="rt-facts">
          {block.rows.map((r, i) => (
            <div className="rt-fact" key={i}>
              {r.label && <dt {...bidiProps(r.label)}>{r.label}</dt>}
              <dd><Spans spans={r.value} /></dd>
            </div>
          ))}
        </dl>
      );
  }
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) return null;
  return (
    <div className={`rt${className ? ` ${className}` : ''}`}>
      {blocks.map((b, i) => <BlockView key={i} block={b} />)}
    </div>
  );
}
