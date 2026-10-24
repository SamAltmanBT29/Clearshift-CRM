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
import type { CRM1ContactRead } from '@clearshift/contracts';

export interface ContactsTableProps {
  contacts: CRM1ContactRead[];
  onSelectContact?: ((contact: CRM1ContactRead) => void) | undefined;
  onEditContact?: ((contact: CRM1ContactRead) => void) | undefined;
  isLoading?: boolean | undefined;
}

export function ContactsTable({
  contacts,
  onSelectContact,
  onEditContact,
  isLoading = false,
}: ContactsTableProps) {
  const getStatusBadgeVariant = (st?: string | null): 'info' | 'success' | 'warning' | 'neutral' => {
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

  const getConsentBadgeVariant = (st?: string | null): 'success' | 'danger' | 'neutral' => {
    switch (st) {
      case 'granted':
        return 'success';
      case 'withdrawn':
        return 'danger';
      default:
        return 'neutral';
    }
  };

  return (
    <div className="cs-table-responsive" style={{ overflowX: 'auto', width: '100%' }}>
      <Table aria-label="Contacts table">
        <TableHeader>
          <TableRow>
            <TableHead>Contact Name</TableHead>
            <TableHead>Email Address</TableHead>
            <TableHead>Phone Number</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Lead Status</TableHead>
            <TableHead>Golden Identity</TableHead>
            <TableHead>Consent</TableHead>
            <TableHead style={{ textAlign: 'right' }}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} style={{ textAlign: 'center', padding: '32px', color: '#64748b' }}>
                No records found. No contacts match the current query.
              </TableCell>
            </TableRow>
          ) : (
            contacts.map((c) => {
              const fullName = `${c.firstName} ${c.lastName}`.trim();
              return (
              <TableRow key={c.id}>
                <TableCell style={{ fontWeight: 600, color: '#0f172a' }}>
                  {onSelectContact ? (
                    <button
                      type="button"
                      onClick={() => onSelectContact(c)}
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
                      aria-label={`View details for ${fullName}`}
                    >
                      {fullName}
                    </button>
                  ) : (
                    fullName
                  )}
                </TableCell>
                <TableCell style={{ color: '#334155' }}>
                  {c.email || <span style={{ color: '#94a3b8' }}>None</span>}
                </TableCell>
                <TableCell style={{ color: '#475569' }}>
                  {c.phone || <span style={{ color: '#94a3b8' }}>None</span>}
                </TableCell>
                <TableCell style={{ color: '#475569' }}>
                  {c.companyName || (c.companyId ? <code style={{ fontSize: '0.75rem' }}>{c.companyId.slice(0, 8)}...</code> : <span style={{ color: '#94a3b8' }}>Unassigned</span>)}
                </TableCell>
                <TableCell>
                  {c.leadStatus ? (
                    <Badge variant={getStatusBadgeVariant(c.leadStatus)}>
                      {c.leadStatus}
                    </Badge>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>None</span>
                  )}
                </TableCell>
                <TableCell>
                  <code style={{ fontSize: '0.8125rem', color: '#0369a1' }}>
                    {c.goldenId || 'PENDING'}
                  </code>
                </TableCell>
                <TableCell>
                  <Badge variant={getConsentBadgeVariant(c.consentStatus)}>
                    {c.consentStatus || 'unknown'}
                  </Badge>
                  {c.unsubscribed && (
                    <span style={{ marginLeft: '4px' }}>
                      <Badge variant="danger">Opted Out</Badge>
                    </span>
                  )}
                </TableCell>
                <TableCell style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: '8px' }}>
                    {onSelectContact && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onSelectContact(c)}
                        aria-label={`View ${fullName}`}
                      >
                        View
                      </Button>
                    )}
                    {onEditContact && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onEditContact(c)}
                        aria-label={`Edit ${fullName}`}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          }))}
        </TableBody>
      </Table>
    </div>
  );
}
