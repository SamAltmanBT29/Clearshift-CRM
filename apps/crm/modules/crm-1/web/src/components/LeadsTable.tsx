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
import type { CRM1LeadRead } from '@clearshift/contracts';

export interface LeadsTableProps {
  leads: CRM1LeadRead[];
  onSelectLead?: ((lead: CRM1LeadRead) => void) | undefined;
  onEditLead?: ((lead: CRM1LeadRead) => void) | undefined;
  isLoading?: boolean | undefined;
}

export function LeadsTable({
  leads,
  onSelectLead,
  onEditLead,
  isLoading = false,
}: LeadsTableProps) {
  const getStatusBadgeVariant = (st?: string | null): 'info' | 'warning' | 'success' | 'neutral' => {
    switch (st) {
      case 'New':
        return 'info';
      case 'Working':
        return 'warning';
      case 'Qualified':
        return 'success';
      case 'Closed':
        return 'neutral';
      default:
        return 'neutral';
    }
  };

  return (
    <div className="cs-table-responsive" style={{ overflowX: 'auto', width: '100%' }}>
      <Table aria-label="Leads table">
        <TableHeader>
          <TableRow>
            <TableHead>Associated Contact</TableHead>
            <TableHead>Pipeline Stage</TableHead>
            <TableHead>Contact ID</TableHead>
            <TableHead>Created</TableHead>
            <TableHead style={{ textAlign: 'right' }}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} style={{ textAlign: 'center', padding: '32px', color: '#64748b' }}>
                No records found. No leads match the current filter.
              </TableCell>
            </TableRow>
          ) : (
            leads.map((l) => (
            <TableRow key={l.id}>
              <TableCell style={{ fontWeight: 600, color: '#0f172a' }}>
                {onSelectLead ? (
                  <button
                    type="button"
                    onClick={() => onSelectLead(l)}
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
                    aria-label={`View details for lead ${l.contactName || l.id}`}
                  >
                    {l.contactName || `Lead ${l.id.slice(0, 8)}...`}
                  </button>
                ) : (
                  l.contactName || `Lead ${l.id.slice(0, 8)}...`
                )}
              </TableCell>
              <TableCell>
                <Badge variant={getStatusBadgeVariant(l.status)}>
                  {l.status}
                </Badge>
              </TableCell>
              <TableCell>
                <code style={{ fontSize: '0.8125rem', color: '#475569' }}>
                  {l.contactId}
                </code>
              </TableCell>
              <TableCell style={{ color: '#64748b', fontSize: '0.8125rem' }}>
                {new Date(l.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell style={{ textAlign: 'right' }}>
                <div style={{ display: 'inline-flex', gap: '8px' }}>
                  {onSelectLead && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onSelectLead(l)}
                      aria-label={`View lead ${l.id}`}
                    >
                      View
                    </Button>
                  )}
                  {onEditLead && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onEditLead(l)}
                      aria-label={`Advance status for lead ${l.id}`}
                    >
                      Advance Status
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
