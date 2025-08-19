// Quick script to list all records in the database
// Run with: npm run tsx src/test-list-records.ts

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Connect to the database
const dbPath = path.join(__dirname, '../data/provenance.db');
console.log('Opening database at:', dbPath);

const db = new Database(dbPath, {
  readonly: true,
  fileMustExist: true,
});

// Get all records
const stmt = db.prepare(`
  SELECT 
    sha256_hash,
    token_owner_address,
    status,
    created_at,
    verified_at
  FROM authenticity_records 
  ORDER BY created_at DESC
  LIMIT 20
`);

const records = stmt.all();

console.log('\n=== Records in Database ===');
console.log('Total records found:', records.length);
console.log('\n');

records.forEach((record: any, index: number) => {
  console.log(`Record ${index + 1}:`);
  console.log('  SHA256:', record.sha256_hash);
  console.log('  Token Owner:', record.token_owner_address);
  console.log('  Status:', record.status);
  console.log('  Created:', record.created_at);
  console.log('  Verified:', record.verified_at || 'Not verified');
  console.log('');
});

// Get summary
const summaryStmt = db.prepare(`
  SELECT 
    status,
    COUNT(*) as count
  FROM authenticity_records
  GROUP BY status
`);

const summary = summaryStmt.all();
console.log('=== Summary by Status ===');
summary.forEach((s: any) => {
  console.log(`${s.status}: ${s.count} records`);
});

db.close();