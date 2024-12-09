import { Column, getTableColumns, getViewSelectedFields, is, isTable, isView, SQL } from 'drizzle-orm';
import type { Table, View } from 'drizzle-orm';
import type { PgEnum } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { columnToSchema } from './column.ts';
import type { Conditions } from './schema.types.internal.ts';
import type {
	CreateInsertSchema,
	CreateSchemaFactoryOptions,
	CreateSelectSchema,
	CreateUpdateSchema,
} from './schema.types.ts';
import { isPgEnum } from './utils.ts';

function getColumns(tableLike: Table | View) {
	return isTable(tableLike) ? getTableColumns(tableLike) : getViewSelectedFields(tableLike);
}

function handleColumns(
	columns: Record<string, any>,
	refinements: Record<string, any>,
	conditions: Conditions,
	factory?: CreateSchemaFactoryOptions,
): z.ZodTypeAny {
	const columnSchemas: Record<string, z.ZodTypeAny> = {};

	for (const [key, selected] of Object.entries(columns)) {
		if (!is(selected, Column) && !is(selected, SQL) && !is(selected, SQL.Aliased) && typeof selected === 'object') {
			const columns = isTable(selected) || isView(selected) ? getColumns(selected) : selected;
			columnSchemas[key] = handleColumns(columns, refinements[key] ?? {}, conditions, factory);
			continue;
		}

		const refinement = refinements[key];
		if (refinement !== undefined && typeof refinement !== 'function') {
			columnSchemas[key] = refinement;
			continue;
		}

		const column = is(selected, Column) ? selected : undefined;
		const schema = column ? columnToSchema(column, factory?.zodInstance ?? z) : z.any();
		const refined = typeof refinement === 'function' ? refinement(schema) : schema;

		if (conditions.never(column)) {
			continue;
		} else {
			columnSchemas[key] = refined;
		}

		if (column) {
			if (conditions.nullable(column)) {
				columnSchemas[key] = columnSchemas[key]!.nullable();
			}

			if (conditions.optional(column)) {
				columnSchemas[key] = columnSchemas[key]!.optional();
			}
		}
	}

	return z.object(columnSchemas) as any;
}

function handleEnum(enum_: PgEnum<any>, factory?: CreateSchemaFactoryOptions) {
	const zod: typeof z = factory?.zodInstance ?? z;
	return zod.enum(enum_.enumValues);
}

const selectConditions: Conditions = {
	never: () => false,
	optional: () => false,
	nullable: (column) => !column.notNull,
};

const insertConditions: Conditions = {
	never: (column) => column?.generated?.type === 'always' || column?.generatedIdentity?.type === 'always',
	optional: (column) => !column.notNull || (column.notNull && column.hasDefault),
	nullable: (column) => !column.notNull,
};

const updateConditions: Conditions = {
	never: (column) => column?.generated?.type === 'always' || column?.generatedIdentity?.type === 'always',
	optional: () => true,
	nullable: (column) => !column.notNull,
};

export const createSelectSchema: CreateSelectSchema = (
	entity: Table | View | PgEnum<[string, ...string[]]>,
	refine?: Record<string, any>,
) => {
	if (isPgEnum(entity)) {
		return handleEnum(entity);
	}
	const columns = getColumns(entity);
	return handleColumns(columns, refine ?? {}, selectConditions) as any;
};

export const createInsertSchema: CreateInsertSchema = (
	entity: Table,
	refine?: Record<string, any>,
) => {
	const columns = getColumns(entity);
	return handleColumns(columns, refine ?? {}, insertConditions) as any;
};

export const createUpdateSchema: CreateUpdateSchema = (
	entity: Table,
	refine?: Record<string, any>,
) => {
	const columns = getColumns(entity);
	return handleColumns(columns, refine ?? {}, updateConditions) as any;
};

export function createSchemaFactory(options?: CreateSchemaFactoryOptions) {
	const createSelectSchema: CreateSelectSchema = (
		entity: Table | View | PgEnum<[string, ...string[]]>,
		refine?: Record<string, any>,
	) => {
		if (isPgEnum(entity)) {
			return handleEnum(entity, options);
		}
		const columns = getColumns(entity);
		return handleColumns(columns, refine ?? {}, selectConditions, options) as any;
	};

	const createInsertSchema: CreateInsertSchema = (
		entity: Table,
		refine?: Record<string, any>,
	) => {
		const columns = getColumns(entity);
		return handleColumns(columns, refine ?? {}, insertConditions, options) as any;
	};

	const createUpdateSchema: CreateUpdateSchema = (
		entity: Table,
		refine?: Record<string, any>,
	) => {
		const columns = getColumns(entity);
		return handleColumns(columns, refine ?? {}, updateConditions, options) as any;
	};

	return { createSelectSchema, createInsertSchema, createUpdateSchema };
}
