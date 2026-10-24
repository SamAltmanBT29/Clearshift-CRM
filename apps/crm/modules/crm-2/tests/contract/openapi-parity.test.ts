import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { crm2Routes } from '../../src/routes/crm2.routes.js';
import { CRM2_STAGES, CRM2_API_PREFIX } from '@clearshift/contracts';

const OPENAPI_PATH = path.join(process.cwd(), 'packages/contracts/openapi/crm-2.yaml');

describe('[CT-01] CRM-2 V1 OpenAPI Contract Parity', () => {
  it('packages/contracts/openapi/crm-2.yaml exists and defines OpenAPI 3.1 specification', () => {
    expect(fs.existsSync(OPENAPI_PATH)).toBe(true);
    const content = fs.readFileSync(OPENAPI_PATH, 'utf-8');

    expect(content).toContain('openapi: 3.1.0');
    expect(content).toContain('ClearShift CRM-2 Deals, Pipeline and Quotes API');
    expect(content).toContain('paths:');
  });

  it('declares all mandatory V1 endpoints in the OpenAPI contract', () => {
    const content = fs.readFileSync(OPENAPI_PATH, 'utf-8');

    // V1 Endpoints required by SDS FR-CRM2-01..05 & contract baseline
    expect(content).toContain('/stages:');
    expect(content).toContain('/deals:');
    expect(content).toContain('/deals/{id}:');
    expect(content).toContain('/quotes:');
    expect(content).toContain('/quotes/{id}:');

    // Method checks
    expect(content).toContain('operationId: listStages');
    expect(content).toContain('operationId: listDeals');
    expect(content).toContain('operationId: createDeal');
    expect(content).toContain('operationId: getDealById');
    expect(content).toContain('operationId: updateDeal');
    expect(content).toContain('operationId: listQuotes');
    expect(content).toContain('operationId: createQuote');
    expect(content).toContain('operationId: getQuoteById');
    expect(content).toContain('operationId: updateQuote');
  });

  it('restricts /stages in OpenAPI contract to GET only (no POST, PUT, PATCH, DELETE)', () => {
    const content = fs.readFileSync(OPENAPI_PATH, 'utf-8');
    const stagesSection = content.split('/stages:')[1]?.split(/\n\s\s\//)[0] || '';

    expect(stagesSection).toContain('get:');
    expect(stagesSection).not.toContain('post:');
    expect(stagesSection).not.toContain('patch:');
    expect(stagesSection).not.toContain('delete:');
    expect(stagesSection).not.toContain('put:');
  });

  it('declares the 6 fixed stages in the StageName / StagesListResponse schema', () => {
    const content = fs.readFileSync(OPENAPI_PATH, 'utf-8');

    CRM2_STAGES.forEach((stage) => {
      expect(content).toContain(`- ${stage}`);
    });
  });

  it('Fastify route table exposes all V1 endpoints matching OpenAPI paths', async () => {
    const app = Fastify({ logger: false });
    await app.register(crm2Routes, { prefix: CRM2_API_PREFIX, authEnabled: false });
    await app.ready();

    // Verify route table matches OpenAPI definitions
    const routeTable = app.printRoutes();

    expect(routeTable).toContain('stages (GET');
    expect(routeTable).toContain('quotes (GET');
    expect(routeTable).toContain(':id (GET');

    // Verify mutating /stages verbs are rejected at HTTP router level
    const postRes = await app.inject({ method: 'POST', url: `${CRM2_API_PREFIX}/stages` });
    expect(postRes.statusCode).toBe(404);

    const patchRes = await app.inject({ method: 'PATCH', url: `${CRM2_API_PREFIX}/stages/00000000-0000-4000-8000-000000000001` });
    expect(patchRes.statusCode).toBe(404);

    const deleteRes = await app.inject({ method: 'DELETE', url: `${CRM2_API_PREFIX}/stages/00000000-0000-4000-8000-000000000001` });
    expect(deleteRes.statusCode).toBe(404);
  });
});
