import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Spinner,
} from '@clearshift/ui';
import {
  type CRM1ContactRead,
  type CRM1ContactCreate,
  type CRM1ContactPatch,
} from '@clearshift/contracts';
import {
  getContactById,
  createContact,
  updateContact,
  Crm1ApiError,
} from '../api/crm-1.js';
import { ContactForm } from '../components/forms/ContactForm.js';

export interface ContactFormPageProps {
  contactId?: string | null | undefined;
  initialContact?: CRM1ContactRead | null | undefined;
  onBackToList: () => void;
  onSuccess: (contact: CRM1ContactRead) => void;
}

export function ContactFormPage({
  contactId,
  initialContact: passedContact,
  onBackToList,
  onSuccess,
}: ContactFormPageProps) {
  const isEditing = Boolean(contactId);

  const [contact, setContact] = useState<CRM1ContactRead | null>(passedContact ?? null);
  const [isLoading, setIsLoading] = useState(isEditing && !passedContact);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string[]> | null>(null);

  useEffect(() => {
    let isSubscribed = true;

    if (contactId && !passedContact) {
      setIsLoading(true);
      getContactById(contactId)
        .then((res) => {
          if (isSubscribed) setContact(res);
        })
        .catch((err: any) => {
          if (isSubscribed) {
            setServerError(err.message || 'Failed to load contact record.');
          }
        })
        .finally(() => {
          if (isSubscribed) setIsLoading(false);
        });
    }

    return () => {
      isSubscribed = false;
    };
  }, [contactId, passedContact]);

  const handleSubmit = async (formData: CRM1ContactCreate | CRM1ContactPatch) => {
    setIsSubmitting(true);
    setServerError(null);
    setServerFieldErrors(null);

    try {
      let saved: CRM1ContactRead;
      if (isEditing && contactId) {
        saved = await updateContact(contactId, formData as CRM1ContactPatch);
      } else {
        saved = await createContact(formData as CRM1ContactCreate);
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
            aria-label="Back to contacts list"
            style={{ marginBottom: '12px' }}
          >
            ← Back to Contacts
          </Button>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            {isEditing ? 'Edit Contact' : 'Create New Contact'}
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '4px' }}>
            {isEditing
              ? 'Update contact details, company association, and lead progression.'
              : 'Add a new contact to the directory. Exact keys will be evaluated for golden ID matching.'}
          </p>
        </div>
      </div>

      <Card>
        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px' }}>
            <Spinner size="lg" />
            <p style={{ marginTop: '16px', fontSize: '0.875rem', color: '#64748b' }}>
              Loading contact record...
            </p>
          </div>
        ) : (
          <ContactForm
            initialContact={contact}
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
