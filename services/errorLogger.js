const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const logsDir = path.resolve(__dirname, '..', 'logs');

/**
 * Generates a clean 6-character uppercase reference ID (e.g. 'A1B2C3')
 */
function generateReferenceId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

/**
 * Logs SQL/import errors to server log files and returns the reference ID.
 */
function logSqlError({ context = 'General', error = {}, query = null, params = null, referenceId = null }) {
  const refId = referenceId || generateReferenceId();

  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const failingQuery = query || error.sql || 'N/A';
    const failingParams = params || error.params || null;

    const entry = [
      '================================================================================',
      `[${timestamp}] [Reference ID: ${refId}] [Context: ${context}]`,
      `Message: ${error.message || 'Unknown error'}`,
      `Code: ${error.code || 'N/A'} | SQLState: ${error.sqlState || 'N/A'} | ErrNo: ${error.errno || 'N/A'}`,
      `Failing Query:\n${failingQuery}`,
      `Query Parameters:\n${failingParams ? JSON.stringify(failingParams, null, 2) : 'None / N/A'}`,
      `Stack Trace:\n${error.stack || 'No stack trace available'}`,
      '================================================================================\n'
    ].join('\n');

    // Always log to sql-errors.log
    fs.appendFileSync(path.join(logsDir, 'sql-errors.log'), entry, 'utf8');

    // If context relates to bulk import, also log to import-errors.log
    if (String(context).toLowerCase().includes('import')) {
      fs.appendFileSync(path.join(logsDir, 'import-errors.log'), entry, 'utf8');
    }
  } catch (fsErr) {
    console.error('[ErrorLogger Fallback] Failed to write error log to disk:', fsErr.message);
  }

  return refId;
}

module.exports = {
  generateReferenceId,
  logSqlError
};
