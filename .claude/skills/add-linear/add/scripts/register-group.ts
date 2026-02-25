import { setRegisteredGroup } from '../src/db.js';

const args = process.argv.slice(2);

if (args.length < 3) {
  console.error(
    'Usage: tsx scripts/register-group.ts <jid> <name> <folder> [trigger] [--no-trigger-required]',
  );
  console.error(
    'Example: tsx scripts/register-group.ts "linear:__channel__" "Linear Issues" linear "@Andy" --no-trigger-required',
  );
  process.exit(1);
}

const [jid, name, folder] = args;
const trigger = args[3] && !args[3].startsWith('--') ? args[3] : '';
const requiresTrigger = !args.includes('--no-trigger-required');

setRegisteredGroup(jid, {
  name,
  folder,
  trigger,
  added_at: new Date().toISOString(),
  requiresTrigger,
});

console.log(`Registered group: ${jid} → ${folder}/ (requiresTrigger=${requiresTrigger})`);
