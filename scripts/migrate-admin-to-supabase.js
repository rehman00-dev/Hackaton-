const path = require('path');
const dotenv = require('dotenv');
const sqlite3 = require('sqlite3').verbose();

dotenv.config();

const {
  closeDb,
  collection,
  connectDb,
  currentTimestamp,
  withTransaction
} = require('../src/db');

function openLegacyDatabase() {
  const filename = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'hcm-lite.db');
  return new sqlite3.Database(filename, sqlite3.OPEN_READONLY);
}

function readLegacyAdmin(database) {
  return new Promise((resolve, reject) => {
    database.get("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1", (error, admin) => {
      if (error) return reject(error);
      if (!admin) return reject(new Error('No Admin account was found in the local SQLite database.'));
      database.get('SELECT * FROM companies ORDER BY id DESC LIMIT 1', (companyError, company) => {
        if (companyError) return reject(companyError);
        resolve({ admin, company });
      });
    });
  });
}

async function main() {
  await connectDb();
  const legacyDatabase = openLegacyDatabase();
  try {
    const { admin, company } = await readLegacyAdmin(legacyDatabase);
    if (await collection('users').findOne({ role: 'admin' })) {
      throw new Error('Supabase already has an Admin account. Migration stopped without changing either database.');
    }
    if (await collection('users').findOne({ email: admin.email })) {
      throw new Error('The local Admin email already exists in Supabase. Migration stopped without changing either database.');
    }

    await withTransaction(async (session) => {
      await collection('users').insertOne({
        id: admin.id,
        name: admin.name,
        email: admin.email,
        password_hash: admin.password_hash,
        role: 'admin',
        department_id: null,
        phone: admin.phone || '',
        address: admin.address || '',
        is_active: admin.is_active,
        must_change_password: admin.must_change_password,
        created_at: admin.created_at || currentTimestamp()
      }, { session });

      if (company) {
        await collection('companies').insertOne({
          id: company.id,
          singleton_key: 'primary',
          name: company.name,
          office_hours: company.office_hours || '09:00-17:00',
          grace_minutes: company.grace_minutes ?? 15,
          weekend: company.weekend || 'SAT-SUN',
          office_location: company.office_location || '',
          office_radius_meters: company.office_radius_meters || 150,
          office_latitude: company.office_latitude ?? null,
          office_longitude: company.office_longitude ?? null,
          created_at: company.created_at || currentTimestamp()
        }, { session });
      }
      await session.query(`
        SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1))
      `);
      if (company) {
        await session.query(`
          SELECT setval(pg_get_serial_sequence('companies', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM companies), 1))
        `);
      }
    });
    console.log('Admin login and company settings were copied to Supabase. No other local user or HR data was migrated.');
  } finally {
    await new Promise((resolve, reject) => legacyDatabase.close((error) => error ? reject(error) : resolve()));
  }
}

main()
  .catch((error) => {
    console.error(`Admin migration failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch((error) => {
    console.error('Could not close the Supabase database connection:', error.message);
    process.exitCode = 1;
  }));
