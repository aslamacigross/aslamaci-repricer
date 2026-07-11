const SECRET_KEYS = /secret|password|authorization|api[_-]?key|token|private[_-]?key/i;

function redact(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? "[REDACTED]" : redact(item)])
  );
}

function write(level, message, data = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...redact(data) };
  const output = JSON.stringify(entry);
  if (level === "error") console.error(output);
  else console.log(output);
}

module.exports = {
  info: (message, data) => write("info", message, data),
  warn: (message, data) => write("warn", message, data),
  error: (message, data) => write("error", message, data),
  redact
};
