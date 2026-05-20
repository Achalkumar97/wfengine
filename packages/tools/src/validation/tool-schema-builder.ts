import { z } from 'zod';
import type { ZodSchema } from 'zod';

/**
 * Tool schema builder that derives strict tool schemas from node config schemas.
 * Replaces the permissive `additionalProperties: true` with strict validation.
 */

export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
  schema?: ZodSchema<any>;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: ToolParameter[];
  validationSchema: ZodSchema<any>;
}

/**
 * Converts a Zod schema to an OpenAI-compatible function parameter schema.
 */
export function zodToOpenAIParameter(zodSchema: ZodSchema<any>, description: string): any {
  const shape = zodSchema instanceof z.ZodObject ? zodSchema.shape : {};
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const def = (value as any)._def;
    const param: any = {
      description: description || `Parameter ${key}`,
    };

    if (def.typeName === 'ZodString') {
      param.type = 'string';
    } else if (def.typeName === 'ZodNumber') {
      param.type = 'number';
    } else if (def.typeName === 'ZodBoolean') {
      param.type = 'boolean';
    } else if (def.typeName === 'ZodArray') {
      param.type = 'array';
      param.items = { type: 'string' };
    } else if (def.typeName === 'ZodObject') {
      param.type = 'object';
      param.properties = {};
      const nestedShape = def.shape();
      for (const [nestedKey, nestedValue] of Object.entries(nestedShape)) {
        const nestedParam = zodToOpenAIParameter(nestedValue as ZodSchema<any>, '');
        param.properties[nestedKey] = nestedParam;
      }
    } else {
      param.type = 'string';
    }

    // Check if the field is optional
    const isOptional = def.typeName?.includes('ZodOptional') || def.typeName?.includes('ZodDefault');
    if (!isOptional) {
      required.push(key);
    }

    properties[key] = param;
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: false, // STRICT VALIDATION - no extra properties allowed
  };
}

/**
 * Builds a tool schema from a Zod schema.
 */
export function buildToolSchema(
  name: string,
  description: string,
  zodSchema: ZodSchema<any>
): ToolSchema {
  const parameters: ToolParameter[] = [];
  
  if (zodSchema instanceof z.ZodObject) {
    const shape = zodSchema.shape;
    for (const [key, value] of Object.entries(shape)) {
      const def = (value as any)._def;
      const isOptional = def.typeName?.includes('ZodOptional') || def.typeName?.includes('ZodDefault');
      
      let type = 'string';
      if (def.typeName === 'ZodNumber') type = 'number';
      else if (def.typeName === 'ZodBoolean') type = 'boolean';
      else if (def.typeName === 'ZodArray') type = 'array';
      else if (def.typeName === 'ZodObject') type = 'object';

      parameters.push({
        name: key,
        type,
        description: `Parameter ${key}`,
        required: !isOptional,
        schema: value as ZodSchema<any>,
      });
    }
  }

  return {
    name,
    description,
    parameters,
    validationSchema: zodSchema,
  };
}

/**
 * Converts a ToolSchema to OpenAI function format.
 */
export function toolSchemaToOpenAI(toolSchema: ToolSchema): any {
  const openAIParams = zodToOpenAIParameter(toolSchema.validationSchema, toolSchema.description);
  
  return {
    type: 'function',
    function: {
      name: toolSchema.name,
      description: toolSchema.description,
      parameters: openAIParams,
    },
  };
}
