const readline = require('readline');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

dotenv.config();

const { closeDb, collection, connectDb, currentTimestamp, objectId, withTransaction } = require('../src/db');

function ask(question) {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => terminal.question(question, (answer) => {
    terminal.close();
    resolve(answer.trim());
  }));
}

function askHidden(question) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command directly in an interactive terminal.'));
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
    };
    const onData = (buffer) => {
      const key = buffer.toString();
      if (key === '\u0003') {
        cleanup();
        reject(new Error('Password reset cancelled.'));
        return;
      }
      if (key === '\r' || key === '\n') {
        cleanup();
        resolve(value);
        return;
      }
      if (key === '\u007f' || key === '\b') {
        if (value.length) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      if (key >= ' ' && key !== '\u007f') {
        value += key;
        process.stdout.write('*');
      }
    };

    process.stdout.write(question);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function main() {
  await connectDb();
  const admins = await collection('users')
    .find({ role: 'admin' })
    .sort({ email: 1 })
    .toArray();
  if (!admins.length) {
    throw new Error('No Admin account exists in the configured database. Start the app and complete first-run setup.');
  }

  console.log('Admin accounts in the configured database:');
  for (const admin of admins) {
    console.log(`- ${admin.email}${admin.is_active ? '' : ' (inactive)'}`);
  }

  const email = (await ask('Admin email to reset: ')).toLowerCase();
  const admin = admins.find((item) => item.email.toLowerCase() === email);
  if (!admin) throw new Error('That email is not an Admin account in this database.');
  if (!admin.is_active) throw new Error('That Admin account is inactive. Contact your system administrator.');

  const password = await askHidden('New password (minimum 12 characters; input hidden): ');
  if (password.length < 12) throw new Error('Password must be at least 12 characters.');
  const confirmation = await askHidden('Confirm new password: ');
  if (password !== confirmation) throw new Error('Passwords do not match; no changes were made.');

  const passwordHash = await bcrypt.hash(password, 12);
  await withTransaction(async (session) => {
    const result = await collection('users').updateOne(
      { _id: admin._id, role: 'admin', is_active: 1 },
      { $set: { password_hash: passwordHash, must_change_password: 0 } },
      { session }
    );
    if (result.matchedCount !== 1) {
      throw new Error('The Admin account changed while resetting its password. No changes were made.');
    }
    await collection('auditLogs').insertOne({
      actor_id: String(admin._id),
      action: 'admin.password_reset',
      entity: 'user',
      details: JSON.stringify({ userId: String(admin._id) }),
      created_at: currentTimestamp()
    }, { session });
  });

  console.log(`Password reset complete for ${admin.email}. Sign in to your HCM Lite deployment.`);
}

main()
  .catch((error) => {
    console.error(`Admin password reset failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch((error) => {
    console.error('Could not close the database connection:', error.message);
    process.exitCode = 1;
  }));
