// @ts-nocheck

type SchemaLike = any;
type SchemaPath = Array<string | number>;
type ComposerToolChip = any;
type ComposerToolFieldValueMap = Record<string, unknown>;

function getValueAtPath(root: unknown, path: SchemaPath): unknown {
    let current: any = root;
    for (const segment of path) {
      if (current == null) return undefined;
      current = current[segment as any];
    }
    return current;
  }

export function setValueAtPath(root: unknown, path: SchemaPath, value: unknown): unknown {
    const nextRoot = root && typeof root === "object" ? structuredClone(root) : {};
    let current: any = nextRoot;
    for (let index = 0; index < path.length; index += 1) {
      const segment = path[index];
      const isLeaf = index === path.length - 1;
      if (isLeaf) {
        current[segment as any] = value;
        break;
      }
      const nextSegment = path[index + 1];
      const shouldBeArray = typeof nextSegment === "number";
      const existing = current[segment as any];
      if (!existing || typeof existing !== "object") {
        current[segment as any] = shouldBeArray ? [] : {};
      }
      current = current[segment as any];
    }
    return nextRoot;
  }

function pruneEmptyValues(value: unknown): unknown {
    if (value == null) return undefined;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    }
    if (Array.isArray(value)) {
      const pruned = value.map(pruneEmptyValues).filter((entry) => entry !== undefined);
      return pruned.length === 0 ? undefined : pruned;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => [key, pruneEmptyValues(entry)] as const)
        .filter(([, entry]) => entry !== undefined);
      if (entries.length === 0) return undefined;
      return Object.fromEntries(entries);
    }
    return value;
  }

export function coerceValueBySchema(schema: SchemaLike | undefined, value: unknown): unknown {
    const cleaned = pruneEmptyValues(value);
    if (cleaned === undefined) return undefined;

    const schemaType = schema?.type;
    if (schemaType === "boolean") {
      if (cleaned === true || cleaned === false) return cleaned;
      if (typeof cleaned === "string") {
        if (cleaned === "true") return true;
        if (cleaned === "false") return false;
      }
      return undefined;
    }

    if (schemaType === "integer" || schemaType === "number") {
      if (typeof cleaned === "number") return schemaType === "integer" ? Math.trunc(cleaned) : cleaned;
      if (typeof cleaned === "string") {
        const num = schemaType === "integer" ? Number.parseInt(cleaned, 10) : Number.parseFloat(cleaned);
        return Number.isFinite(num) ? num : undefined;
      }
      return undefined;
    }

    if (schemaType === "array") {
      if (!Array.isArray(cleaned)) return undefined;
      const itemsSchema = schema?.items;
      const coerced = cleaned
        .map((entry) => coerceValueBySchema(itemsSchema, entry))
        .filter((entry) => entry !== undefined);
      return coerced.length === 0 ? undefined : coerced;
    }

    if (schemaType === "object") {
      if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) return undefined;
      const properties = schema?.properties ?? {};
      const required = new Set(Array.isArray(schema?.required) ? schema?.required : []);
      const result: Record<string, unknown> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        const coerced = coerceValueBySchema(propSchema, (cleaned as any)[key]);
        if (coerced !== undefined) result[key] = coerced;
        else if (required.has(key)) return undefined;
      }
      return Object.keys(result).length === 0 ? undefined : result;
    }

    return cleaned;
  }


function isEnumSchema(schema: SchemaLike | undefined): schema is SchemaLike & { enum: unknown[] } {
    return Array.isArray(schema?.enum) && schema!.enum!.length > 0;
  }

export function createSchemaFieldRenderer(ctx: any) {
  const { handleComposerToolFieldChange, handleComposerToolFieldChangePath } = ctx;

function renderSchemaField(options: {
    tool: ComposerToolChip;
    path: SchemaPath;
    fieldKey: string;
    schema: SchemaLike;
    required: boolean;
  }) {
    const { tool, path, fieldKey, schema, required } = options;
    const fieldLabel = schema.title || fieldKey;
    const placeholder = schema.description || `濉啓 ${fieldLabel}`;
    const currentValue = getValueAtPath(tool.fieldValues ?? {}, path);

    if (isEnumSchema(schema)) {
      return (
        <label key={path.join(".")} className="composer-tool-field">
          <span>
            {fieldLabel}
            {required ? " *" : ""}
          </span>
          <select
            value={typeof currentValue === "string" || typeof currentValue === "number" ? String(currentValue) : ""}
            onChange={(event) => handleComposerToolFieldChangePath(tool.id, path, event.target.value)}
          >
            <option value="">鏈缃?</option>
            {schema.enum.map((entry) => (
              <option key={String(entry)} value={String(entry)}>
                {String(entry)}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (schema.type === "boolean") {
      return (
        <label key={path.join(".")} className="composer-tool-field">
          <span>
            {fieldLabel}
            {required ? " *" : ""}
          </span>
          <select
            value={
              typeof currentValue === "boolean"
                ? currentValue
                  ? "true"
                  : "false"
                : typeof currentValue === "string"
                  ? currentValue
                  : ""
            }
            onChange={(event) => handleComposerToolFieldChangePath(tool.id, path, event.target.value)}
          >
            <option value="">鏈缃?</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>
      );
    }

    if (schema.type === "number" || schema.type === "integer") {
      return (
        <label key={path.join(".")} className="composer-tool-field">
          <span>
            {fieldLabel}
            {required ? " *" : ""}
          </span>
          <input
            type="number"
            value={
              typeof currentValue === "number" ? String(currentValue) : typeof currentValue === "string" ? currentValue : ""
            }
            onChange={(event) => handleComposerToolFieldChangePath(tool.id, path, event.target.value)}
            placeholder={placeholder}
          />
        </label>
      );
    }

    if (schema.type === "array") {
      const itemsSchema = schema.items;
      const arrayValue = Array.isArray(currentValue) ? currentValue : [];
      const itemsAreObjects = itemsSchema?.type === "object";

      if (itemsAreObjects) {
        const properties = itemsSchema && typeof itemsSchema.properties === "object" ? itemsSchema.properties : {};
        const requiredFields = new Set(Array.isArray(itemsSchema?.required) ? itemsSchema!.required! : []);

        return (
          <div key={path.join(".")} className="composer-tool-field">
            <div className="composer-tool-field-array-header">
              <span>
                {fieldLabel}
                {required ? " *" : ""}
              </span>
              <button type="button" onClick={() => handleComposerToolFieldChangePath(tool.id, path, [...arrayValue, {}])}>
                + Add
              </button>
            </div>
            <div className="composer-tool-field-array-items">
              {arrayValue.map((entry, index) => (
                <div key={`${path.join(".")}.${index}`} className="composer-tool-field-array-item">
                  <div className="composer-tool-field-array-item-header">
                    <span>{`${fieldLabel} #${index + 1}`}</span>
                    <button
                      type="button"
                      onClick={() =>
                        handleComposerToolFieldChangePath(
                          tool.id,
                          path,
                          arrayValue.filter((_, itemIndex) => itemIndex !== index)
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                  {Object.entries(properties).map(([nestedKey, nestedSchema]) =>
                    renderSchemaField({
                      tool,
                      path: [...path, index, nestedKey],
                      fieldKey: nestedKey,
                      schema: nestedSchema,
                      required: requiredFields.has(nestedKey)
                    })
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      }

      const lines =
        Array.isArray(currentValue) && currentValue.length > 0 ? (currentValue as unknown[]).map((entry) => String(entry)).join("\n") : "";

      return (
        <label key={path.join(".")} className="composer-tool-field">
          <span>
            {fieldLabel}
            {required ? " *" : ""}
          </span>
          <textarea
            value={typeof currentValue === "string" ? currentValue : lines}
            onChange={(event) =>
              handleComposerToolFieldChangePath(
                tool.id,
                path,
                event.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line !== "")
              )
            }
            placeholder={`${placeholder}\\n(一行一个值)`}
          />
        </label>
      );
    }

    if (schema.type === "object") {
      const properties = schema && typeof schema.properties === "object" ? schema.properties : {};
      const requiredFields = new Set(Array.isArray(schema?.required) ? schema.required : []);
      const entries = Object.entries(properties);

      if (entries.length === 0) {
        return null;
      }

      return (
        <div key={path.join(".")} className="composer-tool-field composer-tool-field-object">
          <div className="composer-tool-field-object-header">
            <span>
              {fieldLabel}
              {required ? " *" : ""}
            </span>
          </div>
          <div className="composer-tool-field-object-body">
            {entries.map(([nestedKey, nestedSchema]) =>
              renderSchemaField({
                tool,
                path: [...path, nestedKey],
                fieldKey: nestedKey,
                schema: nestedSchema,
                required: requiredFields.has(nestedKey)
              })
            )}
          </div>
        </div>
      );
    }

    return (
      <label key={path.join(".")} className="composer-tool-field">
        <span>
          {fieldLabel}
          {required ? " *" : ""}
        </span>
        <input
          value={typeof currentValue === "string" ? currentValue : currentValue == null ? "" : String(currentValue)}
          onChange={(event) => handleComposerToolFieldChangePath(tool.id, path, event.target.value)}
          placeholder={placeholder}
        />
      </label>
    );
  }

function renderComposerToolFields(tool: ComposerToolChip) {
    const schema = tool.inputSchema;
    const properties =
      schema && typeof schema.properties === "object"
        ? (schema.properties as Record<string, SchemaLike>)
        : {};
    const requiredFields = Array.isArray(schema?.required) ? new Set(schema.required as string[]) : new Set<string>();
    const entries = Object.entries(properties);

    if (entries.length === 0) {
      return null;
    }

    return (
      <div className="composer-tool-fields">
        {entries.map(([fieldKey, fieldSchema]) =>
          renderSchemaField({
            tool,
            path: [fieldKey],
            fieldKey,
            schema: fieldSchema as SchemaLike,
            required: requiredFields.has(fieldKey)
          })
        )}
      </div>
    );

    return (
      <div className="composer-tool-fields">
        {entries.map(([fieldKey, fieldSchema]) => {
          const fieldLabel = fieldSchema.title || fieldKey;
          const placeholder = fieldSchema.description || `填写 ${fieldLabel}`;
          const rawValue = tool.fieldValues?.[fieldKey];
          const value = typeof rawValue === "string" ? rawValue : rawValue == null ? "" : String(rawValue);

          if (fieldSchema.type === "boolean") {
            return (
              <label key={fieldKey} className="composer-tool-field">
                <span>{fieldLabel}{requiredFields.has(fieldKey) ? " *" : ""}</span>
                <select
                  value={value}
                  onChange={(event) => handleComposerToolFieldChange(tool.id, fieldKey, event.target.value)}
                >
                  <option value="">未设置</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </label>
            );
          }

          return (
            <label key={fieldKey} className="composer-tool-field">
              <span>{fieldLabel}{requiredFields.has(fieldKey) ? " *" : ""}</span>
              <input
                value={value}
                onChange={(event) => handleComposerToolFieldChange(tool.id, fieldKey, event.target.value)}
                placeholder={placeholder}
              />
            </label>
          );
        })}
      </div>
    );
  }

  return { renderComposerToolFields };
}
