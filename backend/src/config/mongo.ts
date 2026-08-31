import { MongoClient, type Db } from 'mongodb';
import { env } from './env.js';

let clientSingleton: MongoClient | null = null;

export async function getMongo(): Promise<{ client: MongoClient; db: Db }> {
  if (clientSingleton) {
    return { client: clientSingleton, db: clientSingleton.db(env.mongoDb) };
  }

  const client = new MongoClient(env.mongoUri, {
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 50,
    retryWrites: true,
  });
  await client.connect();
  clientSingleton = client;

  return { client, db: client.db(env.mongoDb) };
}

export async function closeMongo(): Promise<void> {
  if (clientSingleton) {
    await clientSingleton.close();
    clientSingleton = null;
  }
}

/** Reports whether the deployment supports change streams (needs a replica set). */
export async function detectChangeStreamSupport(client: MongoClient): Promise<boolean> {
  try {
    const hello = await client.db('admin').command({ hello: 1 });
    return Boolean(hello['setName'] || hello['msg'] === 'isdbgrid');
  } catch {
    return false;
  }
}
