export function splitSqlStatements(sql) {
  const statements = [];
  let buffer = "";
  let mode = "normal";
  let dollarTag = "";
  let blockCommentDepth = 0;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1] ?? "";
    buffer += character;

    if (mode === "line-comment") {
      if (character === "\n") mode = "normal";
      continue;
    }

    if (mode === "block-comment") {
      if (character === "/" && next === "*") {
        buffer += next;
        index += 1;
        blockCommentDepth += 1;
      } else if (character === "*" && next === "/") {
        buffer += next;
        index += 1;
        blockCommentDepth -= 1;
        if (blockCommentDepth === 0) mode = "normal";
      }
      continue;
    }

    if (mode === "single-quote") {
      if (character === "'" && next === "'") {
        buffer += next;
        index += 1;
      } else if (character === "'") {
        mode = "normal";
      }
      continue;
    }

    if (mode === "double-quote") {
      if (character === '"' && next === '"') {
        buffer += next;
        index += 1;
      } else if (character === '"') {
        mode = "normal";
      }
      continue;
    }

    if (mode === "dollar-quote") {
      if (sql.startsWith(dollarTag, index)) {
        buffer += dollarTag.slice(1);
        index += dollarTag.length - 1;
        mode = "normal";
        dollarTag = "";
      }
      continue;
    }

    if (character === "-" && next === "-") {
      buffer += next;
      index += 1;
      mode = "line-comment";
      continue;
    }
    if (character === "/" && next === "*") {
      buffer += next;
      index += 1;
      mode = "block-comment";
      blockCommentDepth = 1;
      continue;
    }
    if (character === "'") {
      mode = "single-quote";
      continue;
    }
    if (character === '"') {
      mode = "double-quote";
      continue;
    }
    if (character === "$") {
      const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u);
      if (match) {
        dollarTag = match[0];
        buffer += dollarTag.slice(1);
        index += dollarTag.length - 1;
        mode = "dollar-quote";
        continue;
      }
    }
    if (character === ";") {
      const statement = buffer.trim();
      if (statement.length > 0) statements.push(statement);
      buffer = "";
    }
  }

  if (mode !== "normal" && mode !== "line-comment") {
    throw new TypeError(`Unterminated SQL ${mode}`);
  }
  const remainder = buffer.trim();
  if (remainder.length > 0) statements.push(remainder);
  return statements;
}

export async function executeSqlStatements(client, sql) {
  const statements = splitSqlStatements(sql);
  let transactionOpen = false;
  try {
    for (const statement of statements) {
      const normalized = statement.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/u, "").trim();
      if (/^BEGIN(?:\s+TRANSACTION)?\s*;?$/iu.test(normalized)) transactionOpen = true;
      await client.query(statement);
      if (/^(?:COMMIT|ROLLBACK)\s*;?$/iu.test(normalized)) transactionOpen = false;
    }
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
