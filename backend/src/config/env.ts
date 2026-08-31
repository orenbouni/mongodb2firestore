import 'dotenv/config';
import type { DataSourceKind } from '../domain/types.js';

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export const env = {
  port: Number(str('PORT', '8080')),
  defaultSource: str('DEFAULT_DATA_SOURCE', 'firestore') as DataSourceKind,

  gcpProjectId: process.env['GCP_PROJECT_ID'] ?? process.env['GOOGLE_CLOUD_PROJECT'] ?? '',
  firestoreDatabaseId: str('FIRESTORE_DATABASE_ID', '(default)'),
  firestoreEmulatorHost: process.env['FIRESTORE_EMULATOR_HOST'] ?? '',

  mongoUri: str('MONGODB_URI', 'mongodb://127.0.0.1:27018/?directConnection=true'),
  mongoDb: str('MONGODB_DB', 'aegis_legends'),
  mongoHostLabel: str('MONGODB_HOST_LABEL', 'MongoDB on Compute Engine'),
  mongoInternalIp: str('MONGODB_VM_INTERNAL_IP', ''),
  mongoExternalIp: str('MONGODB_VM_EXTERNAL_IP', ''),
} as const;

/** Strips any user:password segment before a connection string reaches the UI. */
export function redactUri(uri: string): string {
  return uri.replace(/\/\/([^@/]+)@/, '//***:***@');
}
