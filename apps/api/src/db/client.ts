import { Pool } from 'pg';

export const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'huldah',
  password: process.env.DB_PASSWORD || 'huldah',
  database: process.env.DB_NAME || 'huldah'
});


