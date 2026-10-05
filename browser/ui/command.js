// The UI runs the installed command over the ordinary device exec channel.
export async function browserCall(connection, name, args = {}) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error("Invalid browser command");
  const out = await connection.execCall(`mcp call browser ${name} --input - --json`, { stdin: JSON.stringify(args) });
  if (!out.content) throw new Error(out.attrs?.stderr || "Browser command returned no result");
  const result = JSON.parse(out.content);
  if (result.isError || out.attrs?.exit_code !== "0") throw new Error(result.content?.filter(c => c.type === "text").map(c => c.text).join("\n") || out.attrs?.stderr || "Browser command failed");
  return result;
}
