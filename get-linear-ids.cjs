const https = require("https");

const apiKey = process.argv[2];
if (!apiKey) {
  console.error("Missing API key");
  process.exit(1);
}

function query(gql) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query: gql });
    const req = https.request(
      "https://api.linear.app/graphql",
      {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(body));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log("\n=== Your user (for LINEAR_USER_ID) ===\n");
  const viewer = await query("{ viewer { id displayName } }");
  if (viewer.errors) {
    console.error("Error:", viewer.errors[0].message);
    process.exit(1);
  }
  const v = viewer.data.viewer;
  console.log(`  ${v.id}  ${v.displayName}`);

  console.log("\n=== All workspace users (for LINEAR_ALLOWED_USERS) ===\n");
  const users = await query("{ users { nodes { id displayName email } } }");
  for (const u of users.data.users.nodes) {
    console.log(`  ${u.id}  ${u.displayName}  ${u.email || ""}`);
  }
  console.log();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
