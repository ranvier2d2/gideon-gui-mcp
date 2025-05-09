import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const connectionString = process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error('POSTGRES_URL environment variable is not set');
}

// Initialize the postgres client
const client = postgres(connectionString, { prepare: false });

// Initialize Drizzle
export const db = drizzle(client);
