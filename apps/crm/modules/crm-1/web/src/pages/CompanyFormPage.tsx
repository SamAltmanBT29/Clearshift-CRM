import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Spinner,
} from '@clearshift/ui';
import {
  type CRM1Company,
  type CRM1CompanyCreate,
  type CRM1CompanyPatch,
} from '@clearshift/contracts';
import {
  getCompanyById,
  createCompany,
  updateCompany,
  Crm1ApiError,
} from '../api/crm-1.js';
import { CompanyForm } from '../components/forms/CompanyForm.js';

export interface CompanyFormPageProps {
  companyId?: string | null | undefined;
  initialCompany?: CRM1Company | null | undefined;
  onBackToList: () => void;
  onSuccess: (company: CRM1Company) => void;
}

export function CompanyFormPage({
  companyId,
  initialCompany: passedCompany,
  onBackToList,
  onSuccess,
}: CompanyFormPageProps) {
  const isEditing = Boolean(companyId);

  const [company, setCompany] = useState<CRM1Company | null>(passedCompany ?? null);
  const [isLoading, setIsLoading] = useState(isEditing && !passedCompany);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string[]> | null>(null);

  useEffect(() => {
    let isSubscribed = true;

    if (companyId && !passedCompany) {
      setIsLoading(true);
      getCompanyById(companyId)
        .then((res) => {
          if (isSubscribed) setCompany(res);
        })
        .catch((err: any) => {
          if (isSubscribed) {
            setServerError(err.message || 'Failed to load company record.');
          }
        })
        .finally(() => {
          if (isSubscribed) setIsLoading(false);
        });
    }

    return () => {
      isSubscribed = false;
    };
  }, [companyId, passedCompany]);

  const handleSubmit = async (formData: CRM1CompanyCreate | CRM1CompanyPatch) => {
    setIsSubmitting(true);
    setServerError(null);
    setServerFieldErrors(null);

    try {
      let saved: CRM1Company;
      if (isEditing && companyId) {
        saved = await updateCompany(companyId, formData as CRM1CompanyPatch);
      } else {
        saved = await createCompany(formData as CRM1CompanyCreate);
      }
      onSuccess(saved);
    } catch (err: any) {
      if (err instanceof Crm1ApiError) {
        setServerError(err.message);
        if (err.details && typeof err.details === 'object') {
          const det = err.details as any;
          if (Array.isArray(det)) {
            const fieldMap: Record<string, string[]> = {};
            for (const item of det) {
              const fieldName = item.path?.[0] || item.field || 'general';
              if (!fieldMap[fieldName]) fieldMap[fieldName] = [];
              fieldMap[fieldName].push(item.message || 'Validation error');
            }
            setServerFieldErrors(fieldMap);
          } else if (det.fieldErrors) {
            setServerFieldErrors(det.fieldErrors);
          }
        }
      } else {
        setServerError(err.message || 'An unexpected error occurred while saving.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

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
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            {isEditing ? 'Edit Company' : 'Create New Company'}
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '4px' }}>
            {isEditing
              ? 'Update corporate information, tax identification, and headquarters location.'
              : 'Register a flat corporate entity. Tax numbers are normalized for exact matching.'}
          </p>
        </div>
      </div>

      <Card>
        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px' }}>
            <Spinner size="lg" />
            <p style={{ marginTop: '16px', fontSize: '0.875rem', color: '#64748b' }}>
              Loading company record...
            </p>
          </div>
        ) : (
          <CompanyForm
            initialCompany={company}
            isSubmitting={isSubmitting}
            serverError={serverError}
            serverFieldErrors={serverFieldErrors}
            onSubmit={handleSubmit}
            onCancel={onBackToList}
          />
        )}
      </Card>
    </div>
  );
}
