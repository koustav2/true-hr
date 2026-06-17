'use client';
import { useEffect, useRef, useState } from 'react';

const PEN_COLORS = [
  { name: 'Blue', value: '#1d4ed8' },
  { name: 'Black', value: '#111827' },
  { name: 'Emerald', value: '#059669' },
];
const TYPE_FONTS = ['"Brush Script MT", cursive', '"Segoe Script", cursive', 'Georgia, serif'];

/**
 * Advanced e-signature capture: Draw (with undo/clear/pen colour) or Type (cursive) mode.
 * Emits a PNG data URL via onChange (or null when cleared).
 */
export default function SignaturePad({ onChange }) {
  const [mode, setMode] = useState('draw'); // draw | type
  const [penColor, setPenColor] = useState(PEN_COLORS[0].value);
  const [typed, setTyped] = useState('');
  const [fontIdx, setFontIdx] = useState(0);
  const [hasInk, setHasInk] = useState(false);

  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const strokes = useRef([]);       // history of completed strokes
  const current = useRef([]);       // points of the in-progress stroke

  // ---- canvas setup (DPR aware) ----
  function ctx() { return canvasRef.current.getContext('2d'); }
  function setupCanvas() {
    const canvas = canvasRef.current;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const c = ctx();
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.lineCap = 'round'; c.lineJoin = 'round';
  }
  useEffect(() => { if (mode === 'draw') { setupCanvas(); redraw(); } }, [mode]);

  function redraw() {
    const canvas = canvasRef.current; if (!canvas) return;
    const c = ctx();
    c.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes.current) {
      c.strokeStyle = s.color; c.lineWidth = 2.4; c.beginPath();
      s.points.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
      c.stroke();
    }
  }
  function emit() {
    const url = (mode === 'type' ? renderTyped() : canvasRef.current?.toDataURL('image/png')) || null;
    onChange?.(strokes.current.length || (mode === 'type' && typed.trim()) ? url : null);
  }

  // ---- draw handlers ----
  function pos(e) {
    const r = canvasRef.current.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }
  function start(e) { e.preventDefault(); drawing.current = true; current.current = [pos(e)]; }
  function move(e) {
    if (!drawing.current) return; e.preventDefault();
    const p = pos(e); current.current.push(p);
    const c = ctx(); c.strokeStyle = penColor; c.lineWidth = 2.4;
    c.beginPath();
    const pts = current.current; const a = pts[pts.length - 2]; const b = pts[pts.length - 1];
    c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    if (!hasInk) setHasInk(true);
  }
  function end() {
    if (!drawing.current) return; drawing.current = false;
    if (current.current.length) strokes.current.push({ color: penColor, points: current.current });
    current.current = [];
    emit();
  }
  function undo() { strokes.current.pop(); redraw(); setHasInk(strokes.current.length > 0); emit(); }
  function clear() { strokes.current = []; current.current = []; redraw(); setHasInk(false); onChange?.(null); }

  // ---- typed signature → canvas PNG ----
  function renderTyped() {
    if (!typed.trim()) return null;
    const off = document.createElement('canvas');
    off.width = 600; off.height = 180;
    const c = off.getContext('2d');
    c.fillStyle = penColor; c.textBaseline = 'middle'; c.textAlign = 'center';
    c.font = `48px ${TYPE_FONTS[fontIdx]}`;
    c.fillText(typed, 300, 96);
    return off.toDataURL('image/png');
  }
  useEffect(() => { if (mode === 'type') emit(); }, [typed, fontIdx, penColor, mode]);

  const tabCls = (on) => `px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${on ? 'bg-brand-600 text-white' : 'text-ink-soft hover:bg-slate-100'}`;

  return (
    <div>
      {/* mode + pen controls */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          <button type="button" className={tabCls(mode === 'draw')} onClick={() => setMode('draw')}>✍️ Draw</button>
          <button type="button" className={tabCls(mode === 'type')} onClick={() => setMode('type')}>⌨️ Type</button>
        </div>
        <div className="flex items-center gap-2">
          {PEN_COLORS.map((p) => (
            <button key={p.value} type="button" onClick={() => setPenColor(p.value)} aria-label={p.name}
              className={`h-5 w-5 rounded-full ring-2 ${penColor === p.value ? 'ring-brand-400' : 'ring-transparent'}`}
              style={{ background: p.value }} />
          ))}
        </div>
      </div>

      {mode === 'draw' ? (
        <>
          <canvas ref={canvasRef}
            className="w-full h-44 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 touch-none cursor-crosshair"
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-ink-faint">{hasInk ? 'Signature captured' : 'Sign with your mouse or finger'}</span>
            <div className="flex gap-3">
              <button type="button" onClick={undo} disabled={!hasInk} className="text-xs font-medium text-ink-soft disabled:opacity-40 hover:text-brand-700">Undo</button>
              <button type="button" onClick={clear} className="text-xs font-medium text-rose-600 hover:text-rose-700">Clear</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full name"
            className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:shadow-focus" />
          <div className="mt-2 h-28 rounded-xl border border-line bg-slate-50 grid place-items-center overflow-hidden">
            <span style={{ fontFamily: TYPE_FONTS[fontIdx], color: penColor, fontSize: 36 }}>{typed || 'Your signature'}</span>
          </div>
          <div className="flex items-center justify-between mt-2">
            <div className="flex gap-2">
              {TYPE_FONTS.map((f, i) => (
                <button key={i} type="button" onClick={() => setFontIdx(i)}
                  className={`text-xs px-2 py-1 rounded-md border ${fontIdx === i ? 'border-brand-400 text-brand-700 bg-brand-50' : 'border-line text-ink-soft'}`}
                  style={{ fontFamily: f }}>Abc</button>
              ))}
            </div>
            <button type="button" onClick={() => setTyped('')} className="text-xs font-medium text-rose-600">Clear</button>
          </div>
        </>
      )}
    </div>
  );
}
