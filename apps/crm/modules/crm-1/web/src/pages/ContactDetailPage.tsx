import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Badge,
  Alert,
  Spinner,
} from '@clearshift/ui';
import { type CRM1ContactRead } from '@clearshift/contracts';
import { getContactById, Crm1ApiError } from '../api/crm-1.js';

export interface ContactDetailPageProps {
  contactId: string;
  initialContact?: CRM1ContactRead | null | undefined;
  onBackToList: () => void;
  onEditContact: (contact: CRM1ContactRead) => void;
}

export function ContactDetailPage({
  contactId,
  initialContact,
  onBackToList,
  onEditContact,
}: ContactDetailPageProps) {
  const [contact, setContact] = useState<CRM1ContactRead | null>(initialContact ?? null);
  const [isLoading, setIsLoading] = useState(!initialContact);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getContactById(contactId);
      setContact(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load contact record.');
    } finally {
      setIsLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    if (!initialContact) {
      loadData();
    }
  }, [loadData, initialContact]);

  const fullName = contact ? `${contact.firstName} ${contact.lastName}` : 'Contact Details';

  return (
    <div className="cs-page-container max-w-4xl mx-auto p-6" style={{ maxWidth: '56rem', margin: '0 auto', padding: '24px' }}>
      <div className="mb-6 flex items-center justify-between" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBackToList}
            aria-label="Back to contacts list"
            style={{ marginBottom: '12px' }}
          >
            ← Back to Contacts
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              {fullName}
            </h1>
            {contact?.leadStatus && (
              <Badge variant="info">{contact.leadStatus}</Badge>
            )}
            {contact?.unsubscribed && (
              <Badge variant="danger">Unsubscribed</Badge>
            )}
          </div>
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '4px' }}>
            Contact Record ID: <code style={{ fontSize: '0.8125rem' }}>{contactId}</code>
          </p>
        </div>

        {contact && (
          <Button
            type="button"
            variant="primary"
            onClick={() => onEditContact(contact)}
            aria-label="Edit this contact"
          >
            Edit Contact
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="error" style={{ marginBottom: '24px' }}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px' }}>
            <Spinner size="lg" />
            <p style={{ marginTop: '16px', fontSize: '0.875rem', color: '#64748b' }}>
              Loading contact details...
            </p>
          </div>
        </Card>
      ) : contact ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Identity & Golden Resolution Card */}
          <Card>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#0f172a', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
              Identity & Golden Resolution
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Golden Identity ID
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 600, color: '#0284c7', fontSize: '1rem' }}>
                  {contact.goldenId || 'PENDING_RESOLVE'}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Source Origin
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 500, color: '#334155' }}>
                  {contact.sourceSystem ? `${contact.sourceSystem} (${contact.sourceId || 'No ID'})` : 'Direct Web Entry'}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Consent Status
                </span>
                <p style={{ margin: '4px 0 0' }}>
                  <Badge variant={contact.consentStatus === 'granted' ? 'success' : 'neutral'}>
                    {contact.consentStatus || 'unknown'}
                  </Badge>
                </p>
              </div>
            </div>
          </Card>

          {/* Primary Information */}
          <Card>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#0f172a', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
              Contact Information
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                  Email Address
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 500, color: '#0f172a' }}>
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} style={{ color: '#0284c7', textDecoration: 'none' }}>
                      {contact.email}
                    </a>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>Not provided</span>
                  )}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                  Phone Number
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 500, color: '#0f172a' }}>
                  {contact.phone || <span style={{ color: '#94a3b8' }}>Not provided</span>}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                  Associated Company
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 500, color: '#0f172a' }}>
                  {contact.companyName ? (
                    <span>
                      {contact.companyName}{' '}
                      <small style={{ color: '#64748b' }}>({contact.companyId})</small>
                    </span>
                  ) : contact.companyId ? (
                    <span>Company ID: {contact.companyId}</span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>No Company Linked</span>
                  )}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                  Physical Address
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 500, color: '#0f172a' }}>
                  {contact.address || <span style={{ color: '#94a3b8' }}>Not provided</span>}
                </p>
              </div>
            </div>
          </Card>

          {/* Audit Timestamps */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: '#64748b' }}>
              <span>Created: {new Date(contact.createdAt).toLocaleString()}</span>
              <span>Last Modified: {new Date(contact.updatedAt).toLocaleString()}</span>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
