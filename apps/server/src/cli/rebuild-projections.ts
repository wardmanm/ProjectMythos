// Rebuilds campaigns' projections from their event logs, the single command ARCH-042 asks
// for:
//   pnpm --filter @mythos/server rebuild-projections [--data-dir <folder>] [<campaignId> …]
// With no campaign IDs it rebuilds every campaign in the data directory. Each rebuild is
// one transaction, so a campaign is never left half rebuilt. Its modules come from the
// composition root (ARCH-007, ARCH-022).
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { type ConfigOptions, openCampaignTools } from '../app';

const USAGE =
  'Usage: pnpm --filter @mythos/server rebuild-projections [--data-dir <folder>] [<campaignId> ...]';

/**
 * Runs the command and returns its exit code: 0 if every campaign was rebuilt.
 * Implements ARCH-007 and ARCH-042.
 */
export async function rebuildProjectionsCommand(
  args: readonly string[],
  where: Omit<ConfigOptions, 'dataDirFlag'>,
  print: (line: string) => void,
): Promise<number> {
  let parsed: { values: { 'data-dir'?: string | undefined }; positionals: string[] };
  try {
    parsed = parseArgs({
      // pnpm passes a leading `--` through to the script.
      args: args[0] === '--' ? args.slice(1) : [...args],
      options: { 'data-dir': { type: 'string' } },
      allowPositionals: true,
    });
  } catch (error) {
    // parseArgs throws for an unknown flag or a missing value: the message says which.
    print(error instanceof Error ? error.message : String(error));
    print(USAGE);
    return 1;
  }

  const tools = await openCampaignTools({
    ...where,
    dataDirFlag: parsed.values['data-dir'] ?? null,
  });
  try {
    const campaignIds =
      parsed.positionals.length > 0 ? parsed.positionals : await tools.campaignIds();
    if (campaignIds.length === 0) print(`There are no campaigns in ${tools.dataDir}.`);
    let failures = 0;
    for (const campaignId of campaignIds) {
      const rebuilt = tools.rebuildProjections(campaignId);
      if (rebuilt.ok) {
        print(`Rebuilt the projections of campaign ${campaignId}.`);
      } else {
        failures += 1;
        print(`Could not rebuild campaign ${campaignId}: ${rebuilt.error.message}`);
      }
    }
    return failures === 0 ? 0 : 1;
  } finally {
    tools.close();
  }
}

// Run as a script, not when a test imports the command.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await rebuildProjectionsCommand(
    process.argv.slice(2),
    { platform: process.platform, env: process.env, homedir: homedir(), cwd: process.cwd() },
    (line) => {
      console.log(line);
    },
  );
}
