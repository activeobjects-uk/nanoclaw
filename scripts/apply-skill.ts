import { applySkill } from '../skills-engine/apply.js';
import { initSkillsSystem } from '../skills-engine/migrate.js';

const arg = process.argv[2];

if (arg === '--init') {
  initSkillsSystem();
  process.exit(0);
}

if (!arg) {
  console.error('Usage: tsx scripts/apply-skill.ts <skill-dir> | --init');
  process.exit(1);
}

const result = await applySkill(arg);
console.log(JSON.stringify(result, null, 2));

if (!result.success) {
  process.exit(1);
}
