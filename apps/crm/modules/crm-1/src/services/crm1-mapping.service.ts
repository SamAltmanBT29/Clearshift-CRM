import {
  type MappingTemplate,
  type MappingResult,
  type MappingError,
  type Crm1TargetEntity,
  MAPPING_TEMPLATES,
  ENUMS,
  getTemplate,
  listTemplates,
  templateChecksum,
  assertDryRunReady,
  validateTemplate,
  mapRow,
} from '../kit/mapping-defaults.js';
import { AppError } from '@cs/kernel';

export interface BatchMapResult {
  readonly templateId: string;
  readonly templateVersion: number;
  readonly entity: Crm1TargetEntity;
  readonly checksum: string;
  readonly totalRows: number;
  readonly successfulCount: number;
  readonly failedCount: number;
  readonly rows: readonly Record<string, unknown>[];
  readonly failures: readonly {
    readonly sourceRow: number;
    readonly errors: readonly MappingError[];
  }[];
}

export class Crm1MappingService {
  /**
   * List all available versioned templates, optionally filtered by target entity.
   */
  public listTemplates(entity?: Crm1TargetEntity): readonly MappingTemplate[] {
    return listTemplates(entity);
  }

  /**
   * Retrieve a specific template and its cryptographic checksum.
   */
  public getTemplate(
    id: string,
    version?: number | undefined
  ): { readonly template: MappingTemplate; readonly checksum: string } {
    const template = getTemplate(id, version);
    if (!template) {
      throw new AppError(
        'TEMPLATE_NOT_FOUND',
        `Mapping template '${id}'${version ? `@v${version}` : ''} not found`,
        404
      );
    }
    return {
      template,
      checksum: templateChecksum(template),
    };
  }

  /**
   * Retrieve enum allowlists and translation dictionaries.
   */
  public getEnumDictionaries(): typeof ENUMS {
    return ENUMS;
  }

  /**
   * Assert dry-run readiness for a template against source headers.
   * Blocks dry-run execution if any required target schema fields are unmapped.
   */
  public validateDryRun(
    templateId: string,
    sourceColumns: readonly string[],
    version?: number | undefined
  ): {
    readonly ready: boolean;
    readonly templateId: string;
    readonly version: number;
    readonly checksum: string;
    readonly mappedFieldsCount: number;
  } {
    const { template, checksum } = this.getTemplate(templateId, version);
    assertDryRunReady(template, sourceColumns);

    return {
      ready: true,
      templateId: template.id,
      version: template.version,
      checksum,
      mappedFieldsCount: template.fields.length,
    };
  }

  /**
   * Map a batch of source rows using a versioned mapping template.
   * Pure and deterministic: does not mutate source rows.
   */
  public processBatchMapping(
    templateId: string,
    rows: readonly Record<string, unknown>[],
    options?: {
      readonly version?: number | undefined;
      readonly sourceColumns?: readonly string[] | undefined;
    } | undefined
  ): BatchMapResult {
    const { template, checksum } = this.getTemplate(templateId, options?.version);

    if (options?.sourceColumns && options.sourceColumns.length > 0) {
      assertDryRunReady(template, options.sourceColumns);
    }

    const mappedRows: Record<string, unknown>[] = [];
    const failures: { sourceRow: number; errors: readonly MappingError[] }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const sourceRow = rows[i]!;
      const result = mapRow(sourceRow, template);

      if (result.ok) {
        mappedRows.push(result.value);
      } else {
        failures.push({
          sourceRow: i + 1,
          errors: result.errors,
        });
      }
    }

    return {
      templateId: template.id,
      templateVersion: template.version,
      entity: template.entity,
      checksum,
      totalRows: rows.length,
      successfulCount: mappedRows.length,
      failedCount: failures.length,
      rows: mappedRows,
      failures,
    };
  }
}

export const crm1MappingService = new Crm1MappingService();
