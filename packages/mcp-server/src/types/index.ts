export interface DrizzleColumn {
  name: string;
  type: string;
  isNullable: boolean;
  hasDefault: boolean;
  isPrimaryKey: boolean;
  references?: string;
}

export interface DrizzleIndex {
  name: string;
  columns: string[];
  isUnique: boolean;
}

export interface DrizzleTable {
  name: string;
  variableName: string;
  dialect: 'postgresql' | 'sqlite' | 'mysql';
  columns: DrizzleColumn[];
  indexes: DrizzleIndex[];
  primaryKeys: string[];
}

export interface SchemaInspectionResult {
  filePath: string;
  dialect: string;
  tables: DrizzleTable[];
  totalTables: number;
  totalColumns: number;
  unindexedForeignKeys: string[];
}
