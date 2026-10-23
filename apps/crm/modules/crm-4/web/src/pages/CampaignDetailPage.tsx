/**
 * CampaignDetailPage — Campaign detail view with members sub-table and add-member workflow
 *
 * Domain rules enforced:
 *   - listId is immutable after campaign creation (read-only display)
 *   - Campaign sending / outbound email/SMS delivery is strictly out of scope (V1 history only)
 *   - Member status strictly sent/opened/clicked
 *   - Unsubscribe flag visible per member
 *   - Add member validates contact UUID and checks consent state (BR-CRM4-01)
 *
 * API:
 *   - GET /api/v1/crm-marketing/campaigns/{id}
 *   - GET /api/v1/crm-marketing/campaigns/{id}/members
 *   - POST /api/v1/crm-marketing/campaigns/{id}/members
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Badge,
  Alert,
  Spinner,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Pagination,
} from '@cs/ui';
import type {
  CRM4Campaign,
  CRM4Member,
  CRM4MemberCreate,
} from '@clearshift/contracts';
import {
  getCampaignById,
  getCampaignMembers,
  createCampaignMember,
  Crm4ApiError,
} from '../api/crm-4.js';
import { CampaignMemberForm } from '../components/forms/CampaignMemberForm.js';

export interface CampaignDetailPageProps {
  campaignId: string;
  initialCampaign?: CRM4Campaign | null;
  onBackToList: () => void;
  onEditCampaign: (campaign: CRM4Campaign) => void;
  onManageConsent?: (contactId: string) => void;
}

function getMemberStatusBadge(status: 'sent' | 'opened' | 'clicked'): {
  variant: 'info' | 'stage' | 'success';
  label: string;
} {
  switch (status) {
    case 'sent':
      return { variant: 'info', label: 'Sent' };
    case 'opened':
      return { variant: 'stage', label: 'Opened' };
    case 'clicked':
      return { variant: 'success', label: 'Clicked' };
    default:
      return { variant: 'info', label: status };
  }
}

export function CampaignDetailPage({
  campaignId,
  initialCampaign,
  onBackToList,
  onEditCampaign,
  onManageConsent,
}: CampaignDetailPageProps) {
  const [campaign, setCampaign] = useState<CRM4Campaign | null>(initialCampaign ?? null);
  const [members, setMembers] = useState<CRM4Member[]>([]);
  const [totalMembers, setTotalMembers] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  const [isLoadingCampaign, setIsLoadingCampaign] = useState(!initialCampaign);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);

  // Add Member state
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [isSubmittingMember, setIsSubmittingMember] = useState(false);
  const [memberFormError, setMemberFormError] = useState<string | null>(null);
  const [memberFormFieldErrors, setMemberFormFieldErrors] = useState<Record<string, string[]> | null>(null);
  const [addMemberSuccessMessage, setAddMemberSuccessMessage] = useState<string | null>(null);

  // Load campaign
  const loadCampaign = useCallback(async () => {
    setIsCampaignLoading(true);
    setCampaignError(null);
    try {
      const data = await getCampaignById(campaignId);
      setCampaign(data);
    } catch (err) {
      setCampaignError(
        err instanceof Crm4ApiError ? err.message : 'Failed to load campaign details.'
      );
    } finally {
      setIsCampaignLoading(false);
    }
  }, [campaignId]);

  function setIsCampaignLoading(val: boolean) {
    setIsLoadingCampaign(val);
  }

  // Load campaign members
  const loadMembers = useCallback(async (targetPage: number) => {
    setIsLoadingMembers(true);
    setMembersError(null);
    try {
      const res = await getCampaignMembers(campaignId, {
        page: targetPage,
        pageSize,
      });
      setMembers(res.items);
      setTotalMembers(res.pagination.totalCount);
    } catch (err) {
      setMembersError(
        err instanceof Crm4ApiError ? err.message : 'Failed to load campaign members.'
      );
    } finally {
      setIsLoadingMembers(false);
    }
  }, [campaignId, pageSize]);

  useEffect(() => {
    if (!initialCampaign) {
      loadCampaign();
    }
  }, [campaignId, initialCampaign, loadCampaign]);

  useEffect(() => {
    loadMembers(page);
  }, [campaignId, page, loadMembers]);

  const handleAddMemberSubmit = async (data: CRM4MemberCreate) => {
    setIsSubmittingMember(true);
    setMemberFormError(null);
    setMemberFormFieldErrors(null);
    setAddMemberSuccessMessage(null);

    try {
      await createCampaignMember(data);
      setAddMemberSuccessMessage(`Member ${data.contactId} added successfully.`);
      setIsAddMemberOpen(false);
      // Reload member list
      loadMembers(1);
      setPage(1);
    } catch (err) {
      if (err instanceof Crm4ApiError) {
        if (err.details && typeof err.details === 'object') {
          setMemberFormFieldErrors(err.details as Record<string, string[]>);
          setMemberFormError('Validation failed. Please review the highlighted fields.');
        } else {
          setMemberFormError(err.message);
        }
      } else {
        setMemberFormError('Failed to add member to campaign. Please retry.');
      }
    } finally {
      setIsSubmittingMember(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalMembers / pageSize));

  // Compute breakdown metrics from members currently loaded
  const sentCount = members.filter((m) => m.status === 'sent').length;
  const openedCount = members.filter((m) => m.status === 'opened').length;
  const clickedCount = members.filter((m) => m.status === 'clicked').length;
  const unsubscribedCount = members.filter((m) => m.unsubscribed).length;

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8">
      {/* Back link */}
      <div>
        <button
          type="button"
          onClick={onBackToList}
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
          aria-label="Back to Marketing Lists"
        >
          ← Marketing Lists
        </button>
      </div>

      {/* Main Campaign Loading State */}
      {isLoadingCampaign && (
        <div className="flex justify-center py-12">
          <Spinner label="Loading campaign details..." />
        </div>
      )}

      {/* Main Campaign Error State */}
      {campaignError && !isLoadingCampaign && (
        <Alert variant="error" title="Failed to Load Campaign">
          <p className="text-sm">{campaignError}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={loadCampaign}>
              Retry
            </Button>
            <Button variant="outline" size="sm" onClick={onBackToList}>
              ← Back to Lists
            </Button>
          </div>
        </Alert>
      )}

      {/* Campaign Details View */}
      {!isLoadingCampaign && campaign && (
        <>
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                  {campaign.name}
                </h1>
                <Badge variant="stage" size="sm">
                  Campaign Record
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Campaign Date: <span className="font-medium text-slate-700">{campaign.campaignDate}</span>
                {' · '}
                Created: {new Date(campaign.createdAt).toLocaleDateString()}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEditCampaign(campaign)}
                aria-label="Edit campaign name or date"
              >
                Edit Campaign
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsAddMemberOpen(true)}
                aria-label="Add member to campaign"
              >
                + Add Member
              </Button>
            </div>
          </div>

          {/* Success banner after adding member */}
          {addMemberSuccessMessage && (
            <Alert variant="info" title="Member Recorded">
              <p className="text-sm">{addMemberSuccessMessage}</p>
            </Alert>
          )}

          {/* Overview Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="p-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
                Total Members
              </span>
              <span className="text-2xl font-bold text-slate-900 mt-1 block">
                {totalMembers}
              </span>
              <span className="text-xs text-slate-400 mt-1 block">Recorded history</span>
            </Card>

            <Card className="p-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
                Sent / Opened / Clicked
              </span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-lg font-semibold text-blue-600">{sentCount}</span>
                <span className="text-xs text-slate-400">/</span>
                <span className="text-lg font-semibold text-indigo-600">{openedCount}</span>
                <span className="text-xs text-slate-400">/</span>
                <span className="text-lg font-semibold text-emerald-600">{clickedCount}</span>
              </div>
              <span className="text-xs text-slate-400 mt-1 block">Status breakdown</span>
            </Card>

            <Card className="p-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
                Unsubscribed
              </span>
              <span className="text-2xl font-bold text-rose-600 mt-1 block">
                {unsubscribedCount}
              </span>
              <span className="text-xs text-slate-400 mt-1 block">Opted out (BR-CRM4-01)</span>
            </Card>

            <Card className="p-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
                Target List
              </span>
              <span className="text-xs font-mono text-slate-700 mt-1 block truncate" title={campaign.listId}>
                {campaign.listId}
              </span>
              <span className="text-xs text-amber-700 mt-1 block font-medium">
                🔒 Immutable
              </span>
            </Card>
          </div>

          {/* Add Member Drawer / Inline Card */}
          {isAddMemberOpen && (
            <Card className="p-6 border-indigo-200 bg-indigo-50/20 shadow-md">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-indigo-100">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Add Campaign Member</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Record a contact's participation and engagement status in this campaign.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddMemberOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded"
                  aria-label="Close add member form"
                >
                  ✕
                </button>
              </div>

              <CampaignMemberForm
                campaignId={campaign.id}
                isSubmitting={isSubmittingMember}
                serverError={memberFormError}
                serverFieldErrors={memberFormFieldErrors}
                onSubmit={handleAddMemberSubmit}
                onCancel={() => setIsAddMemberOpen(false)}
              />
            </Card>
          )}

          {/* Members Sub-table Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Campaign Members</h2>
                <p className="text-xs text-slate-500">
                  Engagement history for contacts in this campaign. Outbound messaging is out of scope (V1 history only).
                </p>
              </div>
            </div>

            {isLoadingMembers && (
              <div className="flex justify-center py-8">
                <Spinner label="Loading members..." />
              </div>
            )}

            {membersError && !isLoadingMembers && (
              <Alert variant="error" title="Failed to Load Members">
                <p className="text-sm">{membersError}</p>
                <Button variant="outline" size="sm" onClick={() => loadMembers(page)} className="mt-2">
                  Retry
                </Button>
              </Alert>
            )}

            {!isLoadingMembers && !membersError && members.length === 0 && (
              <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg bg-slate-50/50">
                <span className="text-3xl" aria-hidden="true">👥</span>
                <p className="mt-2 text-sm font-medium text-slate-700">No members recorded yet</p>
                <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                  This campaign has no recorded contact engagements. Add a member above or import membership history.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setIsAddMemberOpen(true)}
                  className="mt-4"
                >
                  + Add First Member
                </Button>
              </div>
            )}

            {!isLoadingMembers && !membersError && members.length > 0 && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contact ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Opt-Out State</TableHead>
                      <TableHead>Recorded At</TableHead>
                      {onManageConsent && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => {
                      const badge = getMemberStatusBadge(member.status);
                      return (
                        <TableRow key={member.id}>
                          <TableCell className="font-mono text-xs text-slate-800">
                            {member.contactId}
                          </TableCell>
                          <TableCell>
                            <Badge variant={badge.variant} size="sm">
                              {badge.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {member.unsubscribed ? (
                              <Badge variant="danger" size="sm">
                                Unsubscribed
                              </Badge>
                            ) : (
                              <Badge variant="neutral" size="sm">
                                Subscribed
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-slate-500">
                            {new Date(member.createdAt).toLocaleString()}
                          </TableCell>
                          {onManageConsent && (
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onManageConsent(member.contactId)}
                                aria-label={`Manage consent for contact ${member.contactId}`}
                              >
                                Consent
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex justify-between items-center pt-2">
                    <span className="text-xs text-slate-500">
                      Showing {(page - 1) * pageSize + 1} to{' '}
                      {Math.min(page * pageSize, totalMembers)} of {totalMembers} members
                    </span>
                    <Pagination
                      currentPage={page}
                      totalPages={totalPages}
                      totalCount={totalMembers}
                      pageSize={pageSize}
                      onPageChange={(p) => setPage(p)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default CampaignDetailPage;
