import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { db, pool } from './db.js';

await migrate(db, { migrationsFolder: './drizzle' });

await pool.end();
