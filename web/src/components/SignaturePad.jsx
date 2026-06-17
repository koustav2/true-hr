import { useEffect, useRef, useState } from 'react';
import { Button } from './ui.jsx';

export default function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1c1c28';
  }, []);

  function pos(e) {
    const r = canvasRef.current.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }
  function start(e) { e.preventDefault(); drawing.current = true; const { x, y } = pos(e); const ctx = canvasRef.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(x, y); }
  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const { x, y } = pos(e); const ctx = canvasRef.current.getContext('2d'); ctx.lineTo(x, y); ctx.stroke();
    if (!hasInk) { setHasInk(true); }
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange?.(canvasRef.current.toDataURL('image/png'));
  }
  function clear() {
    const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height);
    setHasInk(false); onChange?.(null);
  }

  return (
    <div>
      <canvas ref={canvasRef}
        className="w-full h-44 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 touch-none cursor-crosshair"
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-ink-faint">{hasInk ? 'Signature captured' : 'Draw your signature above'}</span>
        <Button type="button" variant="ghost" onClick={clear} className="!py-1.5 !px-3 text-xs">Clear</Button>
      </div>
    </div>
  );
}
