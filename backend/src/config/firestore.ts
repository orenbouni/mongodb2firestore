import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth } from 'google-auth-library';
import { env } from './env.js';

export interface FirestoreIdentity {
  projectId: string;
  databaseId: string;
  /** 'emulator' | 'adc-user' | 'adc-service-account' | 'metadata-server' */
  credentialType: string;
  principal: string;
  usingEmulator: boolean;
}

let clientSingleton: Firestore | null = null;
let identitySingleton: FirestoreIdentity | null = null;

/**
 * Resolves the ambient Google credential without assuming a key file exists.
 * Order is the standard ADC chain: GOOGLE_APPLICATION_CREDENTIALS, then the
 * gcloud user credential, then the GCE/GKE metadata server (Workload Identity).
 */
async function resolveIdentity(): Promise<FirestoreIdentity> {
  const usingEmulator = env.firestoreEmulatorHost !== '';

  if (usingEmulator) {
    return {
      projectId: env.gcpProjectId || 'demo-emulator',
      databaseId: env.firestoreDatabaseId,
      credentialType: 'emulator',
      principal: `emulator@${env.firestoreEmulatorHost}`,
      usingEmulator: true,
    };
  }

  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
  const projectId = env.gcpProjectId || (await auth.getProjectId());
  const client = await auth.getClient();

  let credentialType = 'adc-unknown';
  let principal = 'unknown';

  const anyClient = client as unknown as { email?: string; _clientId?: string; constructor: { name: string } };
  if (anyClient.email) {
    credentialType = 'adc-service-account';
    principal = anyClient.email;
  } else if (anyClient.constructor?.name === 'Compute') {
    credentialType = 'metadata-server';
    principal = 'attached-service-account';
  } else {
    credentialType = 'adc-user';
    principal = 'gcloud application-default user credential';
  }

  return { projectId, databaseId: env.firestoreDatabaseId, credentialType, principal, usingEmulator: false };
}

export async function getFirestore(): Promise<{ db: Firestore; identity: FirestoreIdentity }> {
  if (clientSingleton && identitySingleton) {
    return { db: clientSingleton, identity: identitySingleton };
  }

  const identity = await resolveIdentity();

  clientSingleton = new Firestore({
    projectId: identity.projectId,
    databaseId: identity.databaseId,
    ignoreUndefinedProperties: true,
  });
  identitySingleton = identity;

  return { db: clientSingleton, identity };
}

export function firestoreEndpoint(identity: FirestoreIdentity): string {
  return identity.usingEmulator
    ? `http://${env.firestoreEmulatorHost}`
    : 'firestore.googleapis.com:443 (TLS)';
}
