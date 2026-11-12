// A small JSON Schema subset for widget configs: type, properties, required,
// additionalProperties: false, items, enum, minimum, maximum, minItems, maxItems, maxLength,
// oneOf (first match wins). Returns a list of "path: message" strings.
const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v);

export function validate(value, schema, path = 'config') {
  const errs = [];
  if (!schema) return errs;
  if (schema.oneOf) {
    const results = schema.oneOf.map((s) => validate(value, s, path));
    if (results.some((r) => !r.length)) return errs;
    return results.sort((a, b) => a.length - b.length)[0];
  }
  if (schema.type) {
    const t = typeOf(value);
    const types = [].concat(schema.type);
    const ok = types.includes(t) || (t === 'integer' && types.includes('number'));
    if (!ok) return [`${path}: expected ${types.join(' or ')}, got ${t}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: must be one of ${schema.enum.join(', ')} (got ${JSON.stringify(value)})`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: must be ≥ ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: must be ≤ ${schema.maximum}`);
  }
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) {
    errs.push(`${path}: ${value.length} characters (max ${schema.maxLength})`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path}: needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path}: at most ${schema.maxItems} item(s)`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(v, schema.items, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${path}: missing "${k}"`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errs.push(...validate(v, props[k], `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unknown field "${k}" (allowed: ${Object.keys(props).join(', ')})`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errs.push(...validate(v, schema.additionalProperties, `${path}.${k}`));
    }
  }
  return errs;
}

/**
 * Where the schema wants a string, a one-key map with a text value is that string split by YAML at ": "
 * (`- Root page: holds the keys` reads as { "Root page": "holds the keys" }). Put it back together. Returns
 * a new value; everything else is left for validate() to judge.
 */
export function coerceStrings(value, schema) {
  if (!schema || value === null || value === undefined) return value;
  const types = [].concat(schema.type || []);
  if (types.includes('string') && value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length === 1 && ['string', 'number'].includes(typeof entries[0][1])) return `${entries[0][0]}: ${entries[0][1]}`;
  }
  if (Array.isArray(value) && schema.items) return value.map((v) => coerceStrings(v, schema.items));
  if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, coerceStrings(v, schema.properties[k])]));
  }
  return value;
}
