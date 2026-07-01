import { Logo } from '@/components/Brand.jsx';

// Minimal, dependency-free Markdown renderer for our legal docs (#, ##, **bold**, - list).
function inline(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={k++} className="font-semibold text-ink">{m[1]}</strong>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function LegalDoc({ markdown }) {
  const lines = markdown.split('\n');
  const blocks = [];
  let para = [];
  const flush = (i) => { if (para.length) { blocks.push(<p key={`p${i}`} className="text-[15px] leading-7 text-ink-soft mb-3">{inline(para.join(' '))}</p>); para = []; } };
  lines.forEach((raw, i) => {
    const s = raw.trim();
    if (s.startsWith('# ')) { flush(i); blocks.push(<h1 key={i} className="text-3xl font-bold text-ink tracking-tight">{inline(s.slice(2))}</h1>); blocks.push(<div key={`hr${i}`} className="h-[3px] w-full rounded bg-brand-gradient-r my-4" />); }
    else if (s.startsWith('## ')) { flush(i); blocks.push(<h2 key={i} className="text-lg font-semibold text-brand-700 mt-7 mb-2">{inline(s.slice(3))}</h2>); }
    else if (s.startsWith('**Last updated')) { flush(i); blocks.push(<p key={i} className="text-sm text-ink-faint mb-4">{inline(s)}</p>); }
    else if (s.startsWith('- ')) { flush(i); blocks.push(<li key={i} className="text-[15px] leading-7 text-ink-soft ml-5 list-disc mb-1.5">{inline(s.slice(2))}</li>); }
    else if (s === '') { flush(i); }
    else { para.push(s); }
  });
  flush('end');

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="mx-auto max-w-3xl px-5 py-4"><Logo size={30} /></div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10">
        <article>{blocks}</article>
        <footer className="mt-12 pt-6 border-t border-line text-xs text-ink-faint">
          © {new Date().getFullYear()} L R Technology. All rights reserved.
        </footer>
      </main>
    </div>
  );
}
