import React from 'react';

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
}

/**
 * Accessible table component supporting loading skeleton states and empty state views.
 */
export function Table({ children, className = '', ...props }: TableProps) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className={`w-full text-left text-sm text-slate-700 border-collapse ${className}`} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={`bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500 ${className}`} {...props}>
      {children}
    </thead>
  );
}

export function TableBody({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={`divide-y divide-slate-100 bg-white ${className}`} {...props}>
      {children}
    </tbody>
  );
}

export function TableRow({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={`hover:bg-slate-50/75 transition-colors focus-within:bg-indigo-50/40 ${className}`} {...props}>
      {children}
    </tr>
  );
}

export function TableHead({
  children,
  className = '',
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th scope="col" className={`px-4 py-3 text-left font-semibold text-slate-600 ${className}`} {...props}>
      {children}
    </th>
  );
}

export function TableCell({
  children,
  className = '',
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-4 py-3.5 align-middle text-slate-800 ${className}`} {...props}>
      {children}
    </td>
  );
}
