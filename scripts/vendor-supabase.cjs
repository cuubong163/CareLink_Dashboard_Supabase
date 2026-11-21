const fs = require("node:fs");
const path = require("node:path");
const source = path.dirname(
  require.resolve("@supabase/supabase-js/package.json"),
);
const destination = path.join(__dirname, "../dist/vendor");
fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(
  path.join(source, "dist/umd/supabase.js"),
  path.join(destination, "supabase.js"),
);
fs.copyFileSync(
  path.join(source, "LICENSE"),
  path.join(destination, "supabase-LICENSE.txt"),
);
console.log("Vendored @supabase/supabase-js 2.119.2");

fs.copyFileSync(
  path.join(__dirname, "../supabase/schema.sql"),
  path.join(__dirname, "../dist/supabase-setup.sql"),
);
