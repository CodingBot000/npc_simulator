#!/usr/bin/env node

function parseArgs(argv) {
  const args = {
    cdpBaseUrl: "http://127.0.0.1:9222",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--cdp" && next) {
      args.cdpBaseUrl = next;
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  try {
    const response = await fetch(`${args.cdpBaseUrl}/json/version`);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    console.log(
      JSON.stringify(
        {
          ok: true,
          cdpBaseUrl: args.cdpBaseUrl,
          browser: payload.Browser ?? null,
          webSocketDebuggerUrl: payload.webSocketDebuggerUrl ?? null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          cdpBaseUrl: args.cdpBaseUrl,
          message: error instanceof Error ? error.message : String(error),
          nextStep:
            "Run `npm run browser:cdp` in a normal macOS terminal session, then retry this check.",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

main();
