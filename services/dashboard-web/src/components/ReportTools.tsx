'use client';
import { useState } from 'react';

/** Copy-as-markdown + print for a report. Operates entirely client-side. */
export function ReportTools({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="actions">
      <button
        type="button"
        className="btn btn-ghost"
        style={{ padding: '6px 12px', fontSize: 12.5 }}
        onClick={async () => { try { await navigator.clipboard.writeText(markdown); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }}
      >
        {copied ? 'Copied ✓' : 'Copy markdown'}
      </button>
      <button type="button" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={() => window.print()}>Print</button>
    </div>
  );
}
