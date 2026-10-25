const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const pool = databaseUrl
  ? new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DB_POOL_MAX || 5),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  })
  : null;

const collectionTables = {
  users: 'users',
  companies: 'companies',
  departments: 'departments',
  employeeProfiles: 'employee_profiles',
  attendance: 'attendance',
  leaveRequests: 'leave_requests',
  payrollRuns: 'payroll_runs',
  aiLogs: 'ai_logs',
  announcements: 'announcements',
  auditLogs: 'audit_logs',
  leaveTypes: 'leave_types',
  holidays: 'holidays',
  attendanceCorrections: 'attendance_corrections',
  notifications: 'notifications'
};

const allowedColumns = {
  users: ['id', 'name', 'email', 'password_hash', 'role', 'department_id', 'phone', 'address', 'is_active', 'must_change_password', 'created_at'],
  companies: ['id', 'singleton_key', 'name', 'office_hours', 'grace_minutes', 'weekend', 'office_location', 'office_radius_meters', 'office_latitude', 'office_longitude', 'created_at'],
  departments: ['id', 'name', 'name_folded', 'company_id', 'created_at'],
  employeeProfiles: ['id', 'user_id', 'employee_code', 'employee_code_folded', 'designation', 'join_date', 'base_salary', 'created_at'],
  attendance: ['id', 'user_id', 'check_in', 'check_out', 'date', 'status', 'late_minutes', 'created_at'],
  leaveRequests: ['id', 'user_id', 'leave_type', 'start_date', 'end_date', 'reason', 'status', 'approved_by', 'reviewer_comment', 'created_at'],
  payrollRuns: ['id', 'user_id', 'month', 'gross_salary', 'tax', 'net_salary', 'status', 'finalized_by', 'finalized_at', 'created_at'],
  aiLogs: ['id', 'user_id', 'prompt', 'response', 'created_at'],
  announcements: ['id', 'title', 'message', 'created_by', 'created_at'],
  auditLogs: ['id', 'actor_id', 'action', 'entity', 'details', 'created_at'],
  leaveTypes: ['id', 'name', 'name_folded', 'annual_quota', 'paid', 'created_at'],
  holidays: ['id', 'name', 'date', 'created_at'],
  attendanceCorrections: ['id', 'user_id', 'date', 'requested_check_in', 'requested_check_out', 'reason', 'status', 'reviewer_comment', 'reviewed_by', 'created_at'],
  notifications: ['id', 'user_id', 'title', 'message', 'read_at', 'created_at']
};

let schemaPromise;

function requirePool() {
  if (!pool) throw new Error('Supabase is not configured. Set DATABASE_URL in the server environment.');
  return pool;
}

function normalizeError(error) {
  if (error.code === '23505') error.code = '11000';
  return error;
}

async function execute(sql, values = [], session) {
  try {
    const database = requirePool();
    return session ? await session.query(sql, values) : await database.query(sql, values);
  } catch (error) {
    throw normalizeError(error);
  }
}

function quoteColumn(table, field) {
  const column = field === '_id' ? 'id' : field;
  if (!allowedColumns[table].includes(column)) throw new Error(`Unknown ${table} field: ${field}`);
  return column === 'id' ? '"id"::text' : `"${column}"`;
}

function buildFilter(table, filter = {}, values = []) {
  const clauses = [];
  for (const [field, condition] of Object.entries(filter)) {
    const column = quoteColumn(table, field);
    if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
      for (const [operator, expected] of Object.entries(condition)) {
        if (operator === '$in') {
          if (!expected.length) clauses.push('FALSE');
          else {
            const placeholders = expected.map((item) => {
              values.push(item == null ? null : String(item));
              return `$${values.length}`;
            });
            clauses.push(`${column} IN (${placeholders.join(', ')})`);
          }
        } else if (operator === '$ne') {
          values.push(expected == null ? null : String(expected));
          clauses.push(expected == null ? `${column} IS NOT NULL` : `${column} <> $${values.length}`);
        } else if (operator === '$gte' || operator === '$gt' || operator === '$lte' || operator === '$lt') {
          const sqlOperator = { $gte: '>=', $gt: '>', $lte: '<=', $lt: '<' }[operator];
          values.push(expected);
          clauses.push(`${column} ${sqlOperator} $${values.length}`);
        } else if (operator === '$regex') {
          values.push(String(expected));
          clauses.push(`${column} ~ $${values.length}`);
        } else if (operator === '$type' && expected === 'string') {
          clauses.push(`${column} IS NOT NULL`);
        } else {
          throw new Error(`Unsupported query operator: ${operator}`);
        }
      }
    } else if (condition === null) {
      clauses.push(`${column} IS NULL`);
    } else {
      values.push(field === '_id' ? String(condition) : condition);
      clauses.push(`${column} = $${values.length}`);
    }
  }
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
}

function normalizeRow(table, row) {
  const { id, ...fields } = row;
  const document = { ...fields, _id: String(id) };
  if (table === 'leaveTypes' && document.name_folded === undefined) document.name_folded = document.name.toLowerCase();
  if (table === 'departments' && document.name_folded === undefined) document.name_folded = document.name.toLowerCase();
  return document;
}

function applyProjection(document, projection) {
  if (!projection) return document;
  const included = Object.entries(projection).filter(([, value]) => value === 1).map(([key]) => key);
  const excluded = Object.entries(projection).filter(([, value]) => value === 0).map(([key]) => key);
  if (included.length) {
    const result = {};
    for (const key of included) if (document[key] !== undefined) result[key] = document[key];
    if (projection._id !== 0 && document._id !== undefined) result._id = document._id;
    return result;
  }
  const result = { ...document };
  for (const key of excluded) delete result[key];
  return result;
}

function createCursor(table, filter, options = {}, session) {
  let sort = options.sort || null;
  let limit = null;
  return {
    sort(value) {
      sort = value;
      return this;
    },
    limit(value) {
      limit = value;
      return this;
    },
    async toArray() {
      const values = [];
      let sql = `SELECT * FROM "${collectionTables[table]}"${buildFilter(table, filter, values)}`;
      if (sort) {
        const order = Object.entries(sort).map(([field, direction]) =>
          `${quoteColumn(table, field).replace('::text', '')} ${direction < 0 ? 'DESC' : 'ASC'}`
        );
        sql += ` ORDER BY ${order.join(', ')}`;
      }
      if (limit !== null) {
        values.push(limit);
        sql += ` LIMIT $${values.length}`;
      }
      const result = await execute(sql, values, session);
      return result.rows.map((row) => applyProjection(normalizeRow(table, row), options.projection));
    }
  };
}

function expressionValue(expression, row) {
  if (typeof expression === 'string' && expression.startsWith('$')) {
    const field = expression.slice(1);
    return field === '_id' ? row._id : row[field];
  }
  if (Array.isArray(expression)) return expression.map((value) => expressionValue(value, row));
  return expression;
}

function applyGroup(rows, specification) {
  const groups = new Map();
  for (const row of rows) {
    const id = expressionValue(specification._id, row);
    const key = JSON.stringify(id);
    if (!groups.has(key)) {
      const initial = { _id: id };
      for (const [field, operation] of Object.entries(specification)) {
        if (field !== '_id' && operation?.$sum !== undefined) initial[field] = 0;
      }
      groups.set(key, initial);
    }
    const group = groups.get(key);
    for (const [field, operation] of Object.entries(specification)) {
      if (field === '_id' || operation?.$sum === undefined) continue;
      group[field] += operation.$sum === 1 ? 1 : Number(expressionValue(operation.$sum, row)) || 0;
    }
  }
  return [...groups.values()];
}

function applyAggregateProjection(rows, specification) {
  return rows.map((row) => {
    const output = {};
    for (const [field, expression] of Object.entries(specification)) {
      if (expression === 0) continue;
      if (expression === 1) {
        if (row[field] !== undefined) output[field] = row[field];
      } else if (expression?.$round) {
        const [valueExpression, places = 0] = expression.$round;
        const factor = 10 ** places;
        output[field] = Math.round((Number(expressionValue(valueExpression, row)) + Number.EPSILON) * factor) / factor;
      } else {
        output[field] = expressionValue(expression, row);
      }
    }
    return output;
  });
}

function matchesFilter(document, filter) {
  return Object.entries(filter).every(([field, condition]) => {
    const actual = field === '_id' ? document._id : document[field];
    if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
      return Object.entries(condition).every(([operator, expected]) => {
        if (operator === '$in') return expected.some((value) => String(actual) === String(value));
        if (operator === '$ne') return actual !== expected;
        if (operator === '$gte') return actual >= expected;
        if (operator === '$gt') return actual > expected;
        if (operator === '$lte') return actual <= expected;
        if (operator === '$lt') return actual < expected;
        if (operator === '$regex') return new RegExp(expected).test(String(actual || ''));
        if (operator === '$type' && expected === 'string') return typeof actual === 'string';
        throw new Error(`Unsupported query operator: ${operator}`);
      });
    }
    return condition === null ? actual == null : String(actual) === String(condition);
  });
}

function collection(name) {
  const table = collectionTables[name];
  if (!table) throw new Error(`Unknown database table: ${name}`);
  return {
    find(filter = {}, options = {}) {
      return createCursor(name, filter, options, options.session);
    },
    async findOne(filter = {}, options = {}) {
      const rows = await createCursor(name, filter, options, options.session).limit(1).toArray();
      return rows[0] || null;
    },
    async countDocuments(filter = {}, options = {}) {
      const values = [];
      const result = await execute(
        `SELECT COUNT(*)::int AS count FROM "${table}"${buildFilter(name, filter, values)}`,
        values,
        options.session
      );
      return result.rows[0].count;
    },
    async insertOne(document, options = {}) {
      const fields = Object.keys(document);
      for (const field of fields) quoteColumn(name, field);
      const values = fields.map((field) => document[field]);
      const columns = fields.map((field) => `"${field}"`).join(', ');
      const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');
      const result = await execute(
        `INSERT INTO "${table}" (${columns}) VALUES (${placeholders}) RETURNING id`,
        values,
        options.session
      );
      return { insertedId: String(result.rows[0].id) };
    },
    async insertMany(documents, options = {}) {
      const insertedIds = [];
      for (const document of documents) {
        const result = await this.insertOne(document, options);
        insertedIds.push(result.insertedId);
      }
      return { insertedIds };
    },
    async updateOne(filter, update, options = {}) {
      const existing = await this.findOne(filter, { session: options.session });
      if (!existing) {
        if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 };
        const fields = {};
        for (const [field, value] of Object.entries(filter)) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) fields[field] = value;
        }
        Object.assign(fields, update.$setOnInsert || {}, update.$set || {});
        delete fields._id;
        try {
          await this.insertOne(fields, options);
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        } catch (error) {
          if (error.code !== '11000') throw error;
          return this.updateOne(filter, update, { ...options, upsert: false });
        }
      }
      const assignments = Object.entries(update.$set || {});
      if (!assignments.length) return { matchedCount: 1, modifiedCount: 0 };
      const values = assignments.map(([, value]) => value);
      const setSql = assignments.map(([field], index) => `${quoteColumn(name, field).replace('::text', '')} = $${index + 1}`).join(', ');
      const where = buildFilter(name, filter, values);
      const result = await execute(`UPDATE "${table}" SET ${setSql}${where}`, values, options.session);
      return { matchedCount: result.rowCount, modifiedCount: result.rowCount };
    },
    async updateMany(filter, update, options = {}) {
      const assignments = Object.entries(update.$set || {});
      if (!assignments.length) return { matchedCount: 0, modifiedCount: 0 };
      const values = assignments.map(([, value]) => value);
      const setSql = assignments.map(([field], index) => `${quoteColumn(name, field).replace('::text', '')} = $${index + 1}`).join(', ');
      const where = buildFilter(name, filter, values);
      const result = await execute(`UPDATE "${table}" SET ${setSql}${where}`, values, options.session);
      return { matchedCount: result.rowCount, modifiedCount: result.rowCount };
    },
    async deleteOne(filter, options = {}) {
      const values = [];
      const where = buildFilter(name, filter, values);
      const result = await execute(
        `DELETE FROM "${table}" WHERE ctid IN (SELECT ctid FROM "${table}"${where} LIMIT 1)`,
        values,
        options.session
      );
      return { deletedCount: result.rowCount };
    },
    async deleteMany(filter, options = {}) {
      const values = [];
      const where = buildFilter(name, filter, values);
      const result = await execute(`DELETE FROM "${table}"${where}`, values, options.session);
      return { deletedCount: result.rowCount };
    },
    aggregate(pipeline = []) {
      return {
        async toArray() {
          const firstStageHasMatch = Boolean(pipeline[0] && Object.hasOwn(pipeline[0], '$match'));
          const firstMatch = firstStageHasMatch ? pipeline[0].$match : {};
          const groupIndex = pipeline.findIndex((stage) => stage.$group);
          const group = groupIndex >= 0 ? pipeline[groupIndex].$group : null;
          const groupIsImmediatelyAfterMatch = groupIndex === (firstStageHasMatch ? 1 : 0);
          const groupKey = group?._id === null
            ? 'NULL'
            : typeof group?._id === 'string' && group._id.startsWith('$')
              ? quoteColumn(name, group._id.slice(1))
              : null;
          const sumFields = group
            ? Object.entries(group).filter(([field]) => field !== '_id')
            : [];
          const canAggregateInDatabase = Boolean(
            groupIsImmediatelyAfterMatch &&
            groupKey &&
            sumFields.every(([field, operation]) =>
              /^[A-Za-z_][A-Za-z0-9_]*$/.test(field) &&
              operation?.$sum !== undefined &&
              (operation.$sum === 1 || (typeof operation.$sum === 'string' && operation.$sum.startsWith('$') &&
                allowedColumns[name].includes(operation.$sum.slice(1))))
            )
          );
          let rows;
          let stages;
          if (canAggregateInDatabase) {
            const values = [];
            const where = buildFilter(name, firstMatch, values);
            const selectedFields = [
              `${groupKey} AS "_id"`,
              ...sumFields.map(([field, operation]) => {
                const value = operation.$sum === 1
                  ? 'COUNT(*)'
                  : `COALESCE(SUM(${quoteColumn(name, operation.$sum.slice(1))}), 0)`;
                return `${value} AS "${field}"`;
              })
            ];
            const groupBy = group._id === null ? '' : ` GROUP BY ${groupKey}`;
            const having = group._id === null ? ' HAVING COUNT(*) > 0' : '';
            const result = await execute(
              `SELECT ${selectedFields.join(', ')} FROM "${collectionTables[name]}"${where}${groupBy}${having}`,
              values
            );
            rows = result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([field, value]) => [
              field,
              field === '_id' ? value : Number(value)
            ])));
            stages = pipeline.slice(groupIndex + 1);
          } else {
            rows = await createCursor(name, firstMatch).toArray();
            stages = firstStageHasMatch ? pipeline.slice(1) : pipeline;
          }
          for (const stage of stages) {
            if (stage.$match) {
              rows = rows.filter((row) => matchesFilter(row, stage.$match));
            } else if (stage.$group) {
              rows = applyGroup(rows, stage.$group);
            } else if (stage.$project) {
              rows = applyAggregateProjection(rows, stage.$project);
            } else if (stage.$sort) {
              const entries = Object.entries(stage.$sort);
              rows.sort((a, b) => {
                for (const [field, direction] of entries) {
                  if (a[field] === b[field]) continue;
                  return (a[field] < b[field] ? -1 : 1) * (direction < 0 ? -1 : 1);
                }
                return 0;
              });
            } else if (stage.$limit !== undefined) {
              rows = rows.slice(0, stage.$limit);
            } else {
              throw new Error('Unsupported aggregate operation');
            }
          }
          return rows;
        }
      };
    }
  };
}

async function connectDb() {
  const database = requirePool();
  if (!schemaPromise) {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    schemaPromise = (async () => {
      await database.query(schema);
      await database.query(`
        INSERT INTO leave_types (name, name_folded, annual_quota, paid)
        VALUES
          ('Annual', 'annual', 14, 1),
          ('Sick', 'sick', 8, 1),
          ('Casual', 'casual', 10, 1),
          ('Unpaid', 'unpaid', NULL, 0)
        ON CONFLICT (name_folded) DO NOTHING
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return database;
}

async function closeDb() {
  if (pool) await pool.end();
}

async function withTransaction(callback) {
  const client = await requirePool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw normalizeError(error);
  } finally {
    client.release();
  }
}

function objectId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)) {
    throw new Error('Invalid record identifier');
  }
  return value;
}

function apiDocument(document) {
  if (!document) return document;
  const { _id, ...fields } = document;
  return { ...fields, id: String(_id) };
}

function currentTimestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function ensureAdminExists() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) return;
  const bcrypt = require('bcryptjs');
  const users = collection('users');
  if (await users.findOne({ role: 'admin' })) return;
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await withTransaction(async (session) => {
    if (await users.findOne({ role: 'admin' }, { session })) return;
    const now = currentTimestamp();
    await users.insertOne({
      name: 'System Admin',
      email: adminEmail,
      password_hash: passwordHash,
      role: 'admin',
      department_id: null,
      phone: '',
      address: '',
      is_active: 1,
      must_change_password: 0,
      created_at: now
    }, { session });
    await collection('companies').insertOne({
      singleton_key: 'primary',
      name: 'HCM Lite',
      office_hours: '09:00-17:00',
      grace_minutes: 15,
      weekend: 'SAT-SUN',
      office_location: '',
      office_radius_meters: 150,
      office_latitude: null,
      office_longitude: null,
      created_at: now
    }, { session });
  });
}

module.exports = {
  apiDocument,
  closeDb,
  collection,
  connectDb,
  currentTimestamp,
  ensureAdminExists,
  objectId,
  withTransaction
};
