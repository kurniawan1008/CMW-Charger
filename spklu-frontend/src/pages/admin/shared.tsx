// Primitif halaman admin: header, tabel, pagination, pencarian — satu gaya.
import { useEffect, useState, type ReactNode } from 'react';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui';

export function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[22px] font-extrabold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-[13px] text-ink-400">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Cari…' }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="relative block w-64">
      <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
      <span className="sr-only">{placeholder}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-control border border-line bg-white py-2.5 pl-9 pr-4 text-[13px] font-medium outline-none transition-colors placeholder:text-ink-300 focus:border-cmw-500 focus:ring-2 focus:ring-cmw-100"
      />
    </label>
  );
}

// Debounce nilai pencarian sebelum dipakai query server-side.
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card bg-white shadow-card">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-3.5 text-[11px] font-bold uppercase tracking-wider text-ink-400">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-3">
      <Button variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)} className="!px-3 !py-2" aria-label="Halaman sebelumnya">
        <ChevronLeft size={15} />
      </Button>
      <span className="font-mono text-[12.5px] font-bold tabular text-ink-600">{page} / {totalPages}</span>
      <Button variant="outline" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="!px-3 !py-2" aria-label="Halaman berikutnya">
        <ChevronRight size={15} />
      </Button>
    </div>
  );
}
