import { Card } from './ui.jsx';

// Modern-SaaS sectioned card: icon chip + title/subtitle header, divider, then content.
export default function SectionCard({ Icon, title, subtitle, children }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3.5 px-6 py-5 border-b border-line">
        {Icon && (
          <div className="grid place-items-center h-9 w-9 rounded-lg bg-brand-50 text-brand-700 shrink-0">
            <Icon width={18} height={18} />
          </div>
        )}
        <div>
          <h2 className="font-semibold text-ink leading-tight">{title}</h2>
          {subtitle && <p className="text-[13px] text-ink-faint mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </Card>
  );
}
