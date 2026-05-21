/**
 * Tool Validator - Phase 1 Task 3
 * 
 * Provides tool validation logic extracted from the tool loop.
 * This ensures consistent validation across the system.
 */

import { z } from 'zod';
import type { ZodSchema } from 'zod';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  data?: any;
}

export class ToolValidator {
  /**
   * Validate tool parameters against a Zod schema
   */
  static validateParameters(parameters: any, schema: ZodSchema<any>): ValidationResult {
    try {
      const validated = schema.parse(parameters);
      
      return {
        valid: true,
        errors: [],
        data: validated,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(err => 
          `${err.path.join('.')}: ${err.message}`
        );
        
        return {
          valid: false,
          errors,
        };
      }
      
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Validate tool result against expected schema
   */
  static validateResult(result: any, schema?: ZodSchema<any>): ValidationResult {
    if (!schema) {
      // If no schema provided, just check that result is not null/undefined
      return {
        valid: result !== null && result !== undefined,
        errors: result === null || result === undefined ? ['Result is null or undefined'] : [],
        data: result,
      };
    }

    try {
      const validated = schema.parse(result);
      
      return {
        valid: true,
        errors: [],
        data: validated,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(err => 
          `${err.path.join('.')}: ${err.message}`
        );
        
        return {
          valid: false,
          errors,
        };
      }
      
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Validate required parameters are present
   */
  static validateRequiredParameters(parameters: any, requiredParams: string[]): ValidationResult {
    const errors: string[] = [];
    
    for (const param of requiredParams) {
      if (parameters[param] === undefined || parameters[param] === null) {
        errors.push(`Required parameter '${param}' is missing`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      data: parameters,
    };
  }

  /**
   * Validate parameter types
   */
  static validateParameterTypes(parameters: any, typeDefinitions: Record<string, string>): ValidationResult {
    const errors: string[] = [];
    
    for (const [key, expectedType] of Object.entries(typeDefinitions)) {
      const value = parameters[key];
      
      if (value === undefined || value === null) {
        continue; // Skip validation for missing values (handled by required validation)
      }
      
      let isValid = false;
      
      switch (expectedType) {
        case 'string':
          isValid = typeof value === 'string';
          break;
        case 'number':
          isValid = typeof value === 'number' && !isNaN(value);
          break;
        case 'boolean':
          isValid = typeof value === 'boolean';
          break;
        case 'array':
          isValid = Array.isArray(value);
          break;
        case 'object':
          isValid = typeof value === 'object' && !Array.isArray(value);
          break;
        default:
          isValid = true; // Unknown type, skip validation
      }
      
      if (!isValid) {
        errors.push(`Parameter '${key}' should be of type ${expectedType}, got ${typeof value}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      data: parameters,
    };
  }

  /**
   * Sanitize parameters by removing unknown fields
   */
  static sanitizeParameters(parameters: any, allowedFields: string[]): any {
    const sanitized: any = {};
    
    for (const field of allowedFields) {
      if (parameters[field] !== undefined) {
        sanitized[field] = parameters[field];
      }
    }
    
    return sanitized;
  }

  /**
   * Validate tool configuration
   */
  static validateToolConfig(config: any): ValidationResult {
    const errors: string[] = [];
    
    if (!config.name || typeof config.name !== 'string') {
      errors.push('Tool name is required and must be a string');
    }
    
    if (!config.description || typeof config.description !== 'string') {
      errors.push('Tool description is required and must be a string');
    }
    
    if (!config.parameters || typeof config.parameters !== 'object') {
      errors.push('Tool parameters are required and must be an object');
    }
    
    return {
      valid: errors.length === 0,
      errors,
      data: config,
    };
  }
}
