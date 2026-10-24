import {
  type TargetFieldDefinition,
  type TargetEntityDefinition,
  type TypeIncompatibilityWarning,
  CRM5_TARGET_ENTITIES,
} from '@clearshift/contracts';
import { AppError } from '@cs/kernel';

/**
 * Normalized source column profile types.
 */
export type SourceColumnType =
  | 'string'
  | 'integer'
  | 'float'
  | 'number'
  | 'numeric'
  | 'date'
  | 'datetime'
  | 'timestamp'
  | 'boolean'
  | 'uuid'
  | 'email'
  | 'phone'
  | 'enum'
  | 'json'
  | 'unknown';

export interface TypeCompatibilityResult {
  compatible: boolean;
  warning?: string;
}

export interface Crm5WizardMappingValidation {
  canProceed: boolean;
  missingRequiredFields: string[];
  typeWarnings: TypeIncompatibilityWarning[];
  errors: string[];
}

/**
 * Returns all CRM-5 target entity definitions registered with the Migration Kit.
 */
export function getCrm5TargetEntityDefinitions(): TargetEntityDefinition[] {
  return Object.values(CRM5_TARGET_ENTITIES);
}

/**
 * Look up a specific CRM-5 target entity definition by entity key.
 */
export function getCrm5TargetEntity(entityName: string): TargetEntityDefinition | undefined {
  return CRM5_TARGET_ENTITIES[entityName];
}

/**
 * Evaluates whether a source column type can be safely coerced into a target entity field data type.
 * Returns compatible: true or compatible: false with a descriptive operator warning.
 */
export function checkFieldTypeCompatibility(
  sourceType: string,
  targetDataType: string
): TypeCompatibilityResult {
  const normSource = (sourceType ?? '').toLowerCase().trim();
  const normTarget = (targetDataType ?? '').toLowerCase().trim();

  // If source type is unknown or blank, allow with neutral compatibility
  if (!normSource || normSource === 'unknown') {
    return { compatible: true };
  }

  // 1. Target String accepts any scalar type
  if (normTarget === 'string') {
    return { compatible: true };
  }

  // 2. Target Number
  if (normTarget === 'number' || normTarget === 'integer' || normTarget === 'numeric') {
    if (['number', 'integer', 'float', 'numeric'].includes(normSource)) {
      return { compatible: true };
    }
    return {
      compatible: false,
      warning: `Source type "${sourceType}" cannot be safely converted to numeric without risk of NaN or data loss.`,
    };
  }

  // 3. Target Date
  if (normTarget === 'date') {
    if (['date', 'datetime', 'timestamp'].includes(normSource)) {
      return { compatible: true };
    }
    return {
      compatible: false,
      warning: `Source type "${sourceType}" is not a recognized date/time type and may fail ISO-8601 parsing.`,
    };
  }

  // 4. Target UUID
  if (normTarget === 'uuid') {
    if (normSource === 'uuid') {
      return { compatible: true };
    }
    // Plain string might contain UUIDs, but any numeric/date/boolean is definitively incompatible
    if (['number', 'integer', 'float', 'numeric', 'boolean', 'date', 'datetime', 'timestamp'].includes(normSource)) {
      return {
        compatible: false,
        warning: `Source type "${sourceType}" cannot satisfy canonical RFC 4122 UUID formatting.`,
      };
    }
    return { compatible: true };
  }

  // 5. Target Boolean
  if (normTarget === 'boolean') {
    if (normSource === 'boolean') {
      return { compatible: true };
    }
    if (['date', 'datetime', 'timestamp', 'uuid', 'json', 'float'].includes(normSource)) {
      return {
        compatible: false,
        warning: `Source type "${sourceType}" cannot be safely coerced to a boolean state.`,
      };
    }
    return { compatible: true };
  }

  // 6. Target Email
  if (normTarget === 'email') {
    if (normSource === 'email' || normSource === 'string') {
      return { compatible: true };
    }
    return {
      compatible: false,
      warning: `Source type "${sourceType}" is not a text/email type and will fail email syntax validation.`,
    };
  }

  // 7. Target Phone
  if (normTarget === 'phone') {
    if (['phone', 'string', 'integer'].includes(normSource)) {
      return { compatible: true };
    }
    return {
      compatible: false,
      warning: `Source type "${sourceType}" cannot be safely normalized into an E.164 phone number.`,
    };
  }

  // 8. Target Enum
  if (normTarget === 'enum') {
    if (['enum', 'string'].includes(normSource)) {
      return { compatible: true };
    }
    return {
      compatible: false,
      warning: `Source type "${sourceType}" requires value conversion mapping to conform to target domain enum allowlists.`,
    };
  }

  return { compatible: true };
}

/**
 * Evaluates field-by-field type compatibility between mapped source columns and target fields.
 */
export function evaluateMappingCompatibility(
  fieldMappings: Record<string, string>,
  targetFields: TargetFieldDefinition[],
  sourceColumnTypes?: Record<string, string>
): TypeIncompatibilityWarning[] {
  if (!sourceColumnTypes) return [];

  const warnings: TypeIncompatibilityWarning[] = [];

  for (const tf of targetFields) {
    const sourceCol = fieldMappings[tf.name];
    if (!sourceCol || sourceCol.trim() === '') continue;

    const sourceType = sourceColumnTypes[sourceCol];
    if (!sourceType) continue;

    const check = checkFieldTypeCompatibility(sourceType, tf.dataType);
    if (!check.compatible && check.warning) {
      warnings.push({
        targetField: tf.name,
        targetLabel: tf.label,
        targetType: tf.dataType,
        sourceColumn: sourceCol,
        sourceType,
        warning: check.warning,
      });
    }
  }

  return warnings;
}

/**
 * Validates CRM-5 wizard mapping state.
 * Required unmapped fields strictly set canProceed = false and block downstream execution.
 */
export function validateCrm5WizardMapping(
  fieldMappings: Record<string, string>,
  targetEntity: TargetEntityDefinition,
  sourceColumnTypes?: Record<string, string>
): Crm5WizardMappingValidation {
  const missingRequiredFields: string[] = [];
  const errors: string[] = [];

  for (const tf of targetEntity.fields) {
    if (tf.required) {
      const mapped = fieldMappings[tf.name];
      if (!mapped || mapped.trim() === '') {
        missingRequiredFields.push(tf.name);
        errors.push(
          `Required target field '${tf.name}' (${tf.label}) has no source column mapped for target entity '${targetEntity.entity}'.`
        );
      }
    }
  }

  const typeWarnings = evaluateMappingCompatibility(
    fieldMappings,
    targetEntity.fields,
    sourceColumnTypes
  );

  return {
    canProceed: missingRequiredFields.length === 0,
    missingRequiredFields,
    typeWarnings,
    errors,
  };
}

/**
 * Throws AppError('MAPPING_INCOMPLETE', ...) if required fields are missing before dry-run or load.
 */
export function assertDryRunEligible(
  fieldMappings: Record<string, string>,
  targetEntity: TargetEntityDefinition
): void {
  const validation = validateCrm5WizardMapping(fieldMappings, targetEntity);
  if (!validation.canProceed) {
    throw new AppError(
      'MAPPING_INCOMPLETE',
      `Cannot proceed to dry-run or load: ${validation.missingRequiredFields.length} required field(s) unmapped for '${targetEntity.entity}'`,
      400,
      validation.missingRequiredFields.map((field) => ({
        field,
        code: 'MISSING_REQUIRED_TARGET_MAPPING',
        message: `Target field "${field}" must be mapped to a source column.`,
      }))
    );
  }
}
