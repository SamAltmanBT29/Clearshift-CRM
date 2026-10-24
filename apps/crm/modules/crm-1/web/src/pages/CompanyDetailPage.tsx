import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Badge,
  Alert,
  Spinner,
} from '@clearshift/ui';
import { type CRM1Company } from '@clearshift/contracts';
import { getCompanyById } from '../api/crm-1.js';

export interface CompanyDetailPageProps {
  companyId: string;
  initialCompany?: CRM1Company | null | undefined;
  onBackToList: () => void;
  onEditCompany: (company: CRM1Company) => void;
}

export function CompanyDetailPage({
  companyId,
  initialCompany,
  onBackToList,
  onEditCompany,
}: CompanyDetailPageProps) {
  const [company, setCompany] = useState<CRM1Company | null>(initialCompany ?? null);
  const [isLoading, setIsLoading] = useState(!initialCompany);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getCompanyById(companyId);
      setCompany(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load company record.');
    } finally {
      setIsLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (!initialCompany) {
      loadData();
    }
  }, [loadData, initialCompany]);

  return (
    <div className="cs-page-container max-w-4xl mx-auto p-6" style={{ maxWidth: '56rem', margin: '0 auto', padding: '24px' }}>
      <div className="mb-6 flex items-center justify-between" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBackToList}
            aria-label="Back to companies list"
            style={{ marginBottom: '12px' }}
          >
            ← Back to Companies
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              {company?.name || 'Company Details'}
            </h1>
            <Badge variant="info">Flat Company</Badge>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '4px' }}>
            Company ID: <code style={{ fontSize: '0.8125rem' }}>{companyId}</code>
          </p>
        </div>

        {company && (
          <Button
            type="button"
            variant="primary"
            onClick={() => onEditCompany(company)}
            aria-label="Edit this company"
          >
            Edit Company
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
              Loading company details...
            </p>
          </div>
        </Card>
      ) : company ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Overview & Tax Identification */}
          <Card>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#0f172a', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
              Corporate Registration
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Tax Identification Number
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 600, color: '#0f172a', fontSize: '1rem' }}>
                  {company.taxNumber || <span style={{ color: '#94a3b8' }}>Unregistered</span>}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Source Origin
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 500, color: '#334155' }}>
                  {company.sourceSystem ? `${company.sourceSystem} (${company.sourceId || 'No ID'})` : 'Direct Web Entry'}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  V1 Hierarchy Model
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 500, color: '#334155' }}>
                  Flat (No Parent/Child in V1)
                </p>
              </div>
            </div>
          </Card>

          {/* Contact Details */}
          <Card>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#0f172a', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
              Contact Information
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                  Corporate Email
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 500, color: '#0f172a' }}>
                  {company.email ? (
                    <a href={`mailto:${company.email}`} style={{ color: '#0284c7', textDecoration: 'none' }}>
                      {company.email}
                    </a>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>Not provided</span>
                  )}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                  Main Phone
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 500, color: '#0f172a' }}>
                  {company.phone || <span style={{ color: '#94a3b8' }}>Not provided</span>}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                  Headquarters Address
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 500, color: '#0f172a' }}>
                  {company.address || <span style={{ color: '#94a3b8' }}>Not provided</span>}
                </p>
              </div>
            </div>
          </Card>

          {/* Audit Timestamps */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: '#64748b' }}>
              <span>Created: {new Date(company.createdAt).toLocaleString()}</span>
              <span>Last Modified: {new Date(company.updatedAt).toLocaleString()}</span>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
