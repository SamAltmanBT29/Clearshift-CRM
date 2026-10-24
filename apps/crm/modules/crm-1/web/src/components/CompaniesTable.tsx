import React from 'react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Button,
} from '@clearshift/ui';
import type { CRM1Company } from '@clearshift/contracts';

export interface CompaniesTableProps {
  companies: CRM1Company[];
  onSelectCompany?: ((company: CRM1Company) => void) | undefined;
  onEditCompany?: ((company: CRM1Company) => void) | undefined;
  isLoading?: boolean | undefined;
}

export function CompaniesTable({
  companies,
  onSelectCompany,
  onEditCompany,
  isLoading = false,
}: CompaniesTableProps) {
  return (
    <div className="cs-table-responsive" style={{ overflowX: 'auto', width: '100%' }}>
      <Table aria-label="Companies table">
        <TableHeader>
          <TableRow>
            <TableHead>Company Name</TableHead>
            <TableHead>Tax ID</TableHead>
            <TableHead>Corporate Email</TableHead>
            <TableHead>Main Phone</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Architecture</TableHead>
            <TableHead>Origin</TableHead>
            <TableHead style={{ textAlign: 'right' }}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} style={{ textAlign: 'center', padding: '32px', color: '#64748b' }}>
                No records found. No companies match the current query.
              </TableCell>
            </TableRow>
          ) : (
            companies.map((c) => (
            <TableRow key={c.id}>
              <TableCell style={{ fontWeight: 600, color: '#0f172a' }}>
                {onSelectCompany ? (
                  <button
                    type="button"
                    onClick={() => onSelectCompany(c)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#0284c7',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0,
                      textAlign: 'left',
                      textDecoration: 'underline',
                    }}
                    aria-label={`View details for ${c.name}`}
                  >
                    {c.name}
                  </button>
                ) : (
                  c.name
                )}
              </TableCell>
              <TableCell style={{ color: '#334155' }}>
                {c.taxNumber ? (
                  <code style={{ fontSize: '0.8125rem' }}>{c.taxNumber}</code>
                ) : (
                  <span style={{ color: '#94a3b8' }}>None</span>
                )}
              </TableCell>
              <TableCell style={{ color: '#334155' }}>
                {c.email || <span style={{ color: '#94a3b8' }}>None</span>}
              </TableCell>
              <TableCell style={{ color: '#475569' }}>
                {c.phone || <span style={{ color: '#94a3b8' }}>None</span>}
              </TableCell>
              <TableCell style={{ color: '#475569', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.address || <span style={{ color: '#94a3b8' }}>None</span>}
              </TableCell>
              <TableCell>
                <Badge variant="info">Flat Company</Badge>
              </TableCell>
              <TableCell style={{ color: '#64748b', fontSize: '0.8125rem' }}>
                {c.sourceSystem ? `${c.sourceSystem}` : 'Direct Entry'}
              </TableCell>
              <TableCell style={{ textAlign: 'right' }}>
                <div style={{ display: 'inline-flex', gap: '8px' }}>
                  {onSelectCompany && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onSelectCompany(c)}
                      aria-label={`View ${c.name}`}
                    >
                      View
                    </Button>
                  )}
                  {onEditCompany && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onEditCompany(c)}
                      aria-label={`Edit ${c.name}`}
                    >
                      Edit
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )))}
        </TableBody>
      </Table>
    </div>
  );
}
